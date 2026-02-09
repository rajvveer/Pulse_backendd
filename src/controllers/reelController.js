const Reel = require('../models/Reel');
const ReelComment = require('../models/ReelComment');
const Like = require('../models/Like');
const User = require('../models/User');
const UserEngagement = require('../models/UserEngagement');
const ReelAlgo = require('../Algorithms/ReelAlgo');
const CommentsAlgo = require('../Algorithms/CommentsAlgo');
const Notification = require('../models/Notification');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const config = require('../config');

cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

// ✅ HELPER: Optimize Cloudinary URL
const getOptimizedVideoUrl = (url) => {
  if (!url || !url.includes('cloudinary')) return url;
  const splitUrl = url.split('/upload/');
  return `${splitUrl[0]}/upload/f_auto,q_auto,w_720/${splitUrl[1]}`;
};

// ✅ HELPER: Normalize User Object
const normalizeUser = (user) => {
  if (!user) return null;

  // Extract avatar from all possible locations
  let cleanAvatarUrl = null;

  // Check profile.avatar first (main location)
  if (user.profile && user.profile.avatar) {
    cleanAvatarUrl = user.profile.avatar;
  }
  // Check authMethods for OAuth avatars
  else if (user.authMethods && user.authMethods.length > 0 && user.authMethods[0].profile?.avatar) {
    cleanAvatarUrl = user.authMethods[0].profile.avatar;
  }
  // Check direct avatar field
  else if (user.avatar) {
    cleanAvatarUrl = user.avatar;
  }
  // Default fallback
  else {
    cleanAvatarUrl = 'https://res.cloudinary.com/pulse/image/upload/v1/defaults/avatar.png';
  }

  return {
    _id: user._id,
    username: user.username,
    isVerified: user.isVerified,
    avatar: cleanAvatarUrl,
    stats: user.stats
  };
};

// =========================================================
//  1. CREATE REEL
// =========================================================
exports.createReel = async (req, res) => {
  console.log('\n--- 🚀 START: Create Reel Request ---');
  const userId = req.user ? req.user.userId : null;

  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No video file provided' });

    console.log(`📂 Video Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: config.get('media.cloudinary.folder') + '/reels',
        resource_type: 'video',
        eager: [{ width: 720, crop: 'limit', quality: 'auto:good' }],
        eager_async: true,
      },
      async (error, result) => {
        if (error) {
          console.error('❌ Cloudinary Error:', error);
          return res.status(500).json({ success: false, message: 'Cloudinary upload failed' });
        }

        try {
          const newReel = await Reel.create({
            user: userId,
            videoUrl: result.secure_url,
            publicId: result.public_id,
            caption: req.body.caption || '',
            stats: { likes: 0, comments: 0, shares: 0, views: 0 }
          });

          console.log('--- ✅ END: Reel Created ---\n');
          res.status(201).json({ success: true, data: newReel });

        } catch (dbError) {
          console.error('❌ Database Save Error:', dbError);
          res.status(500).json({ success: false, message: 'Database error' });
        }
      }
    );

    Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    console.error('❌ General Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// =========================================================
//  2. GET REELS FEED - RANKED (Instagram/X Style)
// =========================================================
exports.getReelsFeed = async (req, res) => {
  // ✅ Prevent caching to always get fresh like counts
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  console.log('\n🎬 [getReelsFeed] Starting...');
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const feedType = req.query.type || 'foryou';
    const userId = req.user ? req.user.userId : null;

    console.log('🎬 [getReelsFeed] Params:', { page, limit, feedType, userId });

    // Fetch more reels than needed for ranking
    const fetchLimit = Math.min(limit * 5, 100);

    const reels = await Reel.find()
      .sort({ createdAt: -1 })
      .limit(fetchLimit)
      .populate({
        path: 'user',
        select: '+authMethods username profile avatar isVerified stats'
      })
      .lean();

    console.log('🎬 [getReelsFeed] Fetched reels from DB:', reels.length);
    if (reels.length > 0) {
      console.log('🎬 [getReelsFeed] First reel sample:', {
        id: reels[0]._id,
        hasUser: !!reels[0].user,
        hasVideoUrl: !!reels[0].videoUrl
      });
    }

    if (!reels || reels.length === 0) {
      console.log('🎬 [getReelsFeed] No reels found, returning empty');
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page, limit, hasMore: false, feedType }
      });
    }

    // Get user's following list for personalization
    let followingIds = [];
    if (userId) {
      try {
        const user = await User.findById(userId).select('following').lean();
        followingIds = user?.following || [];
        console.log('🎬 [getReelsFeed] Following count:', followingIds.length);
      } catch (e) {
        console.warn('Could not get following:', e.message);
      }
    }

    // Get like status in batch (O(1) per item) - with fallback
    const reelIds = reels.map(r => r._id.toString());
    let likedSet = new Set();
    let likeCounts = new Map();

    try {
      likedSet = userId
        ? await Like.getLikedIds(userId, 'reel', reelIds)
        : new Set();
      likeCounts = await Like.getBatchLikeCounts('reel', reelIds);
      console.log('🎬 [getReelsFeed] Like data fetched');
    } catch (e) {
      console.warn('Like batch fetch failed, using fallback:', e.message);
      reelIds.forEach(id => likeCounts.set(id, 0));
    }

    // Apply ranking algorithm with fallback
    let rankedReels;
    try {
      console.log('🎬 [getReelsFeed] Calling algorithm...');
      if (feedType === 'following') {
        rankedReels = await ReelAlgo.getFollowingFeed(userId, reels, followingIds);
      } else {
        rankedReels = await ReelAlgo.getForYouFeed(userId, reels, { followingIds });
      }
      console.log('🎬 [getReelsFeed] Algorithm returned:', rankedReels?.length || 0, 'reels');
    } catch (algoError) {
      console.error('❌ [getReelsFeed] Ranking algorithm failed:', algoError.message);
      console.error(algoError.stack);
      // Fallback to chronological order
      rankedReels = reels;
    }

    // Safety check
    if (!rankedReels || rankedReels.length === 0) {
      console.log('🎬 [getReelsFeed] Algorithm returned empty, using original reels');
      rankedReels = reels;
    }

    // Paginate after ranking
    const startIndex = (page - 1) * limit;
    const paginatedReels = rankedReels.slice(startIndex, startIndex + limit);
    console.log('🎬 [getReelsFeed] After pagination:', paginatedReels.length, 'reels');

    // Process for response
    const processedReels = paginatedReels.map(reel => ({
      ...reel,
      videoUrl: getOptimizedVideoUrl(reel.videoUrl),
      isLiked: likedSet.has(reel._id.toString()),
      likesCount: likeCounts.get(reel._id.toString()) || reel.likes?.length || 0,
      user: normalizeUser(reel.user),
      // Remove internal scoring fields
      _score: undefined,
      _personalBoost: undefined,
      isDiversity: undefined
    }));

    console.log('🎬 [getReelsFeed] Final response:', processedReels.length, 'reels');

    res.status(200).json({
      success: true,
      data: processedReels,
      pagination: {
        page,
        limit,
        hasMore: startIndex + limit < rankedReels.length,
        feedType
      }
    });

  } catch (error) {
    console.error('Get Reels Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reels' });
  }
};


// =========================================================
//  3. TOGGLE REEL LIKE - Using Like Collection
// =========================================================
exports.toggleLike = async (req, res) => {
  try {
    const { reelId } = req.params;
    const userId = req.user.userId;

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    // Use atomic Like collection operation
    const { liked, likeCount } = await Like.toggleLike(userId, 'reel', reelId);

    // Track engagement for personalization
    const authorId = reel.user;
    if (liked && authorId) {
      await UserEngagement.recordSignal(userId, authorId, 'likes', 1);

      // Create notification for reel author
      Notification.createNotification({
        recipient: authorId,
        sender: userId,
        type: 'reel_like',
        reel: reelId,
        message: 'liked your reel'
      }).catch(err => console.error('Notification error:', err));
    }

    res.status(200).json({
      success: true,
      data: { isLiked: liked, likesCount: likeCount }
    });

  } catch (error) {
    console.error('Like Reel Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// =========================================================
//  4. TRACK VIEW / WATCH TIME (for algorithm)
// =========================================================
exports.trackView = async (req, res) => {
  try {
    const { reelId } = req.params;
    const { watchTimeSeconds, watchPercentage } = req.body;
    const userId = req.user?.userId;

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    // Update view stats
    await Reel.findByIdAndUpdate(reelId, {
      $inc: { 'stats.views': 1 }
    });

    // Track engagement for personalization
    if (userId && reel.user) {
      await UserEngagement.recordSignal(userId, reel.user, 'views', 1);

      if (watchTimeSeconds) {
        await UserEngagement.recordSignal(userId, reel.user, 'totalWatchTimeSeconds', watchTimeSeconds);
      }
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Track View Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// =========================================================
//  5. ADD COMMENT
// =========================================================
exports.addComment = async (req, res) => {
  try {
    const { reelId } = req.params;
    const { content, type, parentCommentId } = req.body;
    const userId = req.user.userId;

    if (!content) return res.status(400).json({ success: false, message: 'Content required' });

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    const newComment = await ReelComment.create({
      reel: reelId,
      author: userId,
      content,
      type: type || 'text',
      parentComment: parentCommentId || null
    });

    await newComment.populate({
      path: 'author',
      select: '+authMethods username profile avatar isVerified'
    });

    const responseData = newComment.toObject();
    responseData.author = normalizeUser(newComment.author);

    // Update comment count
    await Reel.findByIdAndUpdate(reelId, { $inc: { commentsCount: 1 } });

    // Track engagement for personalization
    if (reel.user) {
      await UserEngagement.recordSignal(userId, reel.user, 'comments', 1);
    }

    res.status(201).json({ success: true, data: responseData });

  } catch (error) {
    console.error('Add Comment Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// =========================================================
//  6. GET COMMENTS - RANKED
// =========================================================
exports.getComments = async (req, res) => {
  try {
    const { reelId } = req.params;
    const sortMode = req.query.sort || 'best'; // 'best' | 'top' | 'new'

    const comments = await ReelComment.find({ reel: reelId, parentComment: null })
      .sort({ createdAt: -1 })
      .populate({
        path: 'author',
        select: '+authMethods username profile avatar isVerified'
      })
      .populate({
        path: 'replies',
        populate: {
          path: 'author',
          select: '+authMethods username profile avatar isVerified'
        }
      })
      .lean({ virtuals: true });

    // Get reel author for OP boost
    const reel = await Reel.findById(reelId).select('user').lean();
    const opId = reel?.user;

    // Apply ranking algorithm
    const rankedComments = await CommentsAlgo.rankComments(comments, {
      mode: sortMode,
      opId,
      includeReplies: true
    });

    // Process for response
    const processedComments = rankedComments.map(comment => ({
      ...comment,
      author: normalizeUser(comment.author),
      replies: comment.replies ? comment.replies.map(reply => ({
        ...reply,
        author: normalizeUser(reply.author),
        _score: undefined
      })) : [],
      _score: undefined
    }));

    res.status(200).json({ success: true, data: processedComments });

  } catch (error) {
    console.error('Get Comments Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// =========================================================
//  7. SHARE REEL - Track for algorithm
// =========================================================
exports.shareReel = async (req, res) => {
  try {
    const { reelId } = req.params;
    const userId = req.user?.userId;

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    // Update share stats
    await Reel.findByIdAndUpdate(reelId, {
      $inc: { 'stats.shares': 1 }
    });

    // Track engagement
    if (userId && reel.user) {
      await UserEngagement.recordSignal(userId, reel.user, 'shares', 1);
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Share Reel Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
