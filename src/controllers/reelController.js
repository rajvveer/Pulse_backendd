const Reel = require('../models/Reel');
const ReelComment = require('../models/ReelComment');
const Like = require('../models/Like');
const Follow = require('../models/Follow');
const Post = require('../models/Post');
const SocialDNA = require('../models/SocialDNA');
const UserBehavior = require('../models/UserBehavior');
const UserEngagement = require('../models/UserEngagement');
const ReelAlgo = require('../Algorithms/ReelAlgo');
const CommentsAlgo = require('../Algorithms/CommentsAlgo');
const Notification = require('../models/Notification');
const cacheService = require('../services/cacheService');
const embeddingService = require('../services/embeddingService');
const userVectorService = require('../services/userVectorService');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const config = require('../config');

const REEL_CANDIDATE_TTL = parseInt(process.env.REEL_CANDIDATE_TTL_SEC) || 30;
// Models bundle for userVectorService (taste vector is cross-content).
const VECTOR_DEPS = { Like, Post, SocialDNA, UserBehavior };

cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

// Cached following-ids lookup (shared key with feedController's follow graph
// is avoided to keep shapes simple; this is the reel-specific list cache).
const getCachedFollowing = (userId) =>
  cacheService.getOrSet(
    `reel:following:${userId}`,
    async () => (await Follow.getFollowingIds(userId)).map(String),
    parseInt(process.env.FOLLOW_GRAPH_TTL_SEC) || 60
  );

// ✅ HELPER: Optimize Cloudinary URL
const getOptimizedVideoUrl = (url) => {
  if (!url || !url.includes('cloudinary')) return url;
  const splitUrl = url.split('/upload/');
  return `${splitUrl[0]}/upload/f_auto,q_auto,w_720/${splitUrl[1]}`;
};

// ✅ HELPER: Normalize User Object
const BROKEN_DEFAULT_AVATAR = '/defaults/avatar.png';

const normalizeUser = (user) => {
  if (!user) return null;

  // Helper to check if a URL is the broken Cloudinary default (not a real user avatar)
  const isValidAvatar = (url) => url && !url.includes(BROKEN_DEFAULT_AVATAR);

  let cleanAvatarUrl = null;

  // 1. Check profile.avatar (skip if it's the schema default placeholder)
  if (isValidAvatar(user.profile?.avatar)) {
    cleanAvatarUrl = user.profile.avatar;
  }
  // 2. Check direct avatar field
  else if (isValidAvatar(user.avatar)) {
    cleanAvatarUrl = user.avatar;
  }
  // 3. Check authMethods for OAuth avatars (Google profile picture etc.)
  else if (user.authMethods?.length > 0) {
    for (const method of user.authMethods) {
      if (isValidAvatar(method.profile?.avatar)) {
        cleanAvatarUrl = method.profile.avatar;
        break;
      }
    }
  }

  // null means "no real avatar" — frontend will show the initial letter fallback
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

  try {
    const page = Math.min(Math.max(parseInt(req.query.page) || 1, 1), 50);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const feedType = req.query.type || 'foryou';
    const userId = req.user ? req.user.userId : null;

    // Shared candidate set: the newest reels are identical for every user, so
    // fetch them ONCE per interval via Redis (single-flight) instead of a fresh
    // DB scan on every request. Per-user ranking is applied afterward.
    const reels = await cacheService.getOrSet(
      'reel:candidate:foryou',
      async () => Reel.find({ isActive: { $ne: false } })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate({
          path: 'user',
          select: '+authMethods username profile avatar isVerified stats'
        })
        .lean(),
      REEL_CANDIDATE_TTL
    );

    if (!reels || reels.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page, limit, hasMore: false, feedType }
      });
    }

    // Following list from the indexed Follow collection (the legacy embedded
    // User.following array is being phased out and is unbounded).
    let followingIds = [];
    if (userId) {
      try {
        followingIds = await getCachedFollowing(userId);
      } catch (e) {
        console.warn('Could not get following:', e.message);
      }
    }

    // Per-user "did I like these?" set only. Counts come from the maintained
    // reel.stats.likes / likesCount — we do NOT re-aggregate the Like
    // collection on every feed render.
    const reelIds = reels.map(r => r._id.toString());
    let likedSet = new Set();
    try {
      likedSet = userId
        ? await Like.getLikedIds(userId, 'reel', reelIds)
        : new Set();
    } catch (e) {
      console.warn('Like lookup failed:', e.message);
    }

    // ── Personalized candidate generation (For-You only) ──
    // Re-order the candidate pool by cosine similarity to the user's taste
    // vector BEFORE ranking, so the ranker sees the most relevant reels first.
    // Best-effort: any failure leaves the recency pool untouched.
    let candidateReels = reels;
    if (feedType !== 'following' && userId) {
      try {
        const userVec = await userVectorService.getUserVector(userId, VECTOR_DEPS);
        if (userVec) {
          candidateReels = [...reels]
            .map(r => ({ r, s: embeddingService.cosine(userVec, embeddingService.reelVector(r)) }))
            .sort((a, b) => b.s - a.s)
            .map(x => x.r);
        }
      } catch (e) {
        console.warn('[reels] retrieval failed, using recency pool:', e.message);
      }
    }

    // Apply ranking algorithm with fallback
    let rankedReels;
    try {
      if (feedType === 'following') {
        rankedReels = await ReelAlgo.getFollowingFeed(userId, reels, followingIds);
      } else {
        rankedReels = await ReelAlgo.getForYouFeed(userId, candidateReels, { followingIds });
      }
    } catch (algoError) {
      console.error('❌ [getReelsFeed] Ranking algorithm failed:', algoError.message);
      rankedReels = reels; // Fallback to chronological order
    }

    if (!rankedReels || rankedReels.length === 0) {
      rankedReels = reels;
    }

    // Paginate after ranking
    const startIndex = (page - 1) * limit;
    const paginatedReels = rankedReels.slice(startIndex, startIndex + limit);

    // Process for response. Like count comes from the maintained counter
    // (stats.likes / likesCount), not a per-request aggregation.
    const processedReels = paginatedReels.map(reel => ({
      ...reel,
      videoUrl: getOptimizedVideoUrl(reel.videoUrl),
      isLiked: likedSet.has(reel._id.toString()),
      likesCount: reel.stats?.likes ?? reel.likesCount ?? 0,
      user: normalizeUser(reel.user),
      // Remove internal scoring fields
      _score: undefined,
      _personalBoost: undefined,
      isDiversity: undefined
    }));

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

    const reel = await Reel.findById(reelId).select('user');
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    // Normalize the client's watch percentage to the 0..1 fraction that
    // ReelAlgo's completion thresholds expect (accept either 0..1 or 0..100).
    let frac = null;
    if (watchPercentage !== undefined && watchPercentage !== null) {
      const n = Number(watchPercentage);
      if (!Number.isNaN(n)) frac = Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
    }

    // Atomically bump views AND maintain a running average watch completion.
    // newAvg = (oldAvg * oldViews + frac) / (oldViews + 1) — computed in an
    // aggregation-pipeline update so it's correct under concurrent views and
    // never re-reads then writes. avgWatchPercentage was previously NEVER
    // written, so ReelAlgo's heaviest signal (completion) was dead at 0.
    const inc = { $inc: { 'stats.views': 1 } };
    if (frac !== null) {
      await Reel.updateOne({ _id: reelId }, [
        {
          $set: {
            'stats.avgWatchPercentage': {
              $let: {
                vars: {
                  v: { $ifNull: ['$stats.views', 0] },
                  a: { $ifNull: ['$stats.avgWatchPercentage', 0] },
                },
                in: { $divide: [{ $add: [{ $multiply: ['$$a', '$$v'] }, frac] }, { $add: ['$$v', 1] }] },
              },
            },
            'stats.views': { $add: [{ $ifNull: ['$stats.views', 0] }, 1] },
          },
        },
      ]);
    } else {
      await Reel.updateOne({ _id: reelId }, inc);
    }

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
    // Paginate + cap. Without a limit, a viral reel loaded ALL top-level
    // comments (plus populated replies) and ran dozens of regexes each through
    // CommentsAlgo synchronously on the event loop. Bound it.
    const page = Math.min(Math.max(parseInt(req.query.page) || 1, 1), 100);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 50);

    const comments = await ReelComment.find({ reel: reelId, parentComment: null })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'author',
        select: 'username profile avatar isVerified'
      })
      .populate({
        path: 'replies',
        options: { sort: { createdAt: 1 }, limit: 30 },
        populate: {
          path: 'author',
          select: 'username profile avatar isVerified'
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
//  7. TOGGLE COMMENT LIKE
// =========================================================
exports.toggleCommentLike = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;

    const comment = await ReelComment.findById(commentId).select('_id').lean();
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    // Atomic toggle via the Like collection (targetType 'comment') — avoids the
    // read-modify-write lost-update race on the embedded `likes[]` array.
    const { liked, likeCount } = await Like.toggleLike(userId, 'comment', commentId);

    res.status(200).json({
      success: true,
      data: { isLiked: liked, likesCount: likeCount }
    });

  } catch (error) {
    console.error('Toggle Comment Like Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// =========================================================
//  8. SHARE REEL - Track for algorithm
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
