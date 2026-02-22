const Post = require('../models/Post');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Like = require('../models/Like');
const UserBehavior = require('../models/UserBehavior');
const UserEngagement = require('../models/UserEngagement');
const Notification = require('../models/Notification');
const DNAMatchAlgo = require('../Algorithms/DNAMatchAlgo');
const PulseScore = require('../models/PulseScore');

// Helper function to mask anonymous posts
const maskAnonymousPost = (post) => {
  const postObj = typeof post.toObject === 'function' ? post.toObject() : post;

  if (postObj.isAnonymous) {
    postObj.author = {
      _id: null,
      username: 'anonymous',
      name: 'Anonymous',
      avatar: null,
      profile: { avatar: null }, // Ensure profile exists even for anon
      isVerified: false
    };
  }

  return postObj;
};

// Create post
exports.createPost = async (req, res) => {
  try {
    const { text, media, location, visibility, allowComments, isAnonymous } = req.body;

    const post = new Post({
      author: req.user.userId,
      content: { text, media: media || [] },
      location,
      visibility: visibility || 'public',
      allowComments: allowComments !== undefined ? allowComments : true,
      isAnonymous: isAnonymous || false
    });

    await post.save();

    // Update user post count
    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { 'stats.posts': 1 }
    });

    // 🧬 Record Social DNA signal (non-blocking)
    DNAMatchAlgo.recordInteraction(req.user.userId, post, 'post').catch(() => { });

    // 📊 Record Pulse Score signal (non-blocking)
    PulseScore.getOrCreate(req.user.userId).then(ps => {
      ps.recordAction('post');
      if (post.image || post.media?.length > 0) ps.recordAction('media_post');
      ps.save().catch(() => { });
    }).catch(() => { });

    // ✅ FIX: Added 'profile'
    await post.populate('author', 'username name avatar profile isVerified');

    // Mask if anonymous before sending response
    const maskedPost = maskAnonymousPost(post);

    res.status(201).json({
      success: true,
      data: maskedPost
    });
  } catch (error) {
    console.error('Create post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single post
exports.getPost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId)
      // ✅ FIX: Added 'profile'
      .populate('author', 'username name avatar profile isVerified')
      .populate('originalPost');

    if (!post || !post.isActive) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Increment view count
    post.stats.views += 1;
    await post.save();

    const postObj = maskAnonymousPost(post);

    // Use Like model for consistency with feed
    const isLiked = await Like.isLikedBy(req.user.userId, 'post', postId);
    const likeCount = await Like.getLikeCount('post', postId);

    res.json({
      success: true,
      data: { ...postObj, isLiked, likesCount: likeCount }
    });
  } catch (error) {
    console.error('Get post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get user posts
exports.getUserPosts = async (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const currentUserId = req.user?.userId;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if viewing own profile
    const isOwnProfile = currentUserId && user._id.toString() === currentUserId.toString();

    // Build query
    const query = {
      author: user._id,
      isActive: true
    };

    // ✅ FIX: Only hide anonymous posts from OTHER users, owner can see their own
    if (!isOwnProfile) {
      query.isAnonymous = false;
    }

    const posts = await Post.find(query)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('author', 'username name avatar profile isVerified');

    res.json({
      success: true,
      data: posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get user posts error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get My Posts (For the Manage Screen)
exports.getMyPosts = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // ✅ FIX: Owner can see ALL their posts including anonymous ones
    const posts = await Post.find({
      author: req.user.userId,
      isActive: true
      // Removed isAnonymous: false - owner should see their own anonymous posts
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('author', 'username name avatar profile isVerified');

    res.json({
      success: true,
      data: posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get my posts error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Like/Unlike post - Uses Like model for consistency with feed
exports.toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.userId;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Use Like model for atomic toggle (same source as feed)
    const { liked, likeCount } = await Like.toggleLike(userId, 'post', postId);

    // Sync the cached stats.likes count on the post document
    post.stats.likes = likeCount;
    await post.save();

    // Track behavior for personalization (non-blocking)
    if (liked) {
      const authorId = (post.author._id || post.author).toString();
      UserBehavior.recordLike(userId, post).catch(() => { });
      UserEngagement.recordSignal(userId, authorId, 'likes', 1).catch(() => { });

      // 🧬 Record Social DNA signal (non-blocking)
      DNAMatchAlgo.recordInteraction(userId, post, 'like').catch(() => { });

      // 📊 Record Pulse Score signals (non-blocking)
      PulseScore.getOrCreate(userId).then(ps => { ps.recordAction('like_given'); ps.save().catch(() => { }); }).catch(() => { });
      PulseScore.getOrCreate(authorId).then(ps => { ps.recordAction('like_received'); ps.save().catch(() => { }); }).catch(() => { });

      // Create notification for post author
      Notification.createNotification({
        recipient: authorId,
        sender: userId,
        type: 'like',
        post: postId,
        message: 'liked your post'
      }).catch(err => console.error('Notification error:', err));
    }

    res.json({
      success: true,
      data: {
        isLiked: liked,
        likeCount: likeCount
      }
    });
  } catch (error) {
    console.error('Toggle like error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add comment
exports.addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, parentCommentId, gif } = req.body;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (!post.allowComments) {
      return res.status(403).json({ success: false, message: 'Comments disabled' });
    }

    if (!content?.trim() && !gif?.url) {
      return res.status(400).json({
        success: false,
        message: 'Comment must have text or GIF'
      });
    }

    const comment = new Comment({
      post: postId,
      author: req.user.userId,
      content: content?.trim() || '',
      gif: gif || null,
      parentComment: parentCommentId || null
    });

    await comment.save();

    post.stats.comments += 1;
    await post.save();

    if (parentCommentId) {
      await Comment.findByIdAndUpdate(parentCommentId, {
        $push: { replies: comment._id }
      });
    }

    // ✅ FIX: Added 'profile' so comments show avatar immediately
    const populatedComment = await Comment.findById(comment._id)
      .populate('author', 'username name avatar profile isVerified')
      .lean();

    // Create notification for post author (if not self-comment)
    const authorId = (post.author._id || post.author).toString();
    if (authorId !== req.user.userId) {
      Notification.createNotification({
        recipient: authorId,
        sender: req.user.userId,
        type: 'comment',
        post: postId,
        comment: comment._id,
        message: 'commented on your post'
      }).catch(err => console.error('Notification error:', err));
    }

    res.status(201).json({
      success: true,
      data: populatedComment
    });
  } catch (error) {
    console.error('Add comment error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get comments
exports.getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20, sort = 'recent' } = req.query;
    const userId = req.user?.userId;

    const comments = await Comment.find({
      post: postId,
      parentComment: null,
      isActive: true
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      // ✅ FIX: Added 'profile'
      .populate('author', 'username name avatar profile isVerified')
      .populate({
        path: 'replies',
        populate: {
          path: 'author',
          // ✅ FIX: Added 'profile' for replies too
          select: 'username name avatar profile isVerified'
        }
      })
      .lean();

    // Recursively populate nested replies
    const populateNestedReplies = async (comments) => {
      for (let comment of comments) {
        if (comment.replies && comment.replies.length > 0) {
          for (let reply of comment.replies) {
            if (reply.replies && reply.replies.length > 0) {
              await Comment.populate(reply, {
                path: 'replies',
                populate: {
                  path: 'author',
                  // ✅ FIX: Added 'profile' here
                  select: 'username name avatar profile isVerified'
                }
              });
              await populateNestedReplies(reply.replies);
            }
          }
        }
      }
      return comments;
    };

    const populatedComments = await populateNestedReplies(comments);

    // Add isLikedByMe flag and likesCount for each comment (including replies)
    const addLikeInfo = (commentsList) => {
      for (const comment of commentsList) {
        comment.likesCount = comment.likes?.length || 0;
        comment.isLikedByMe = userId ? (comment.likes || []).some(id => id.toString() === userId.toString()) : false;
        if (comment.replies && comment.replies.length > 0) {
          addLikeInfo(comment.replies);
        }
      }
    };
    addLikeInfo(populatedComments);

    // Sort by likes count if sort=top
    if (sort === 'top') {
      populatedComments.sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0));
    }

    res.json({
      success: true,
      data: populatedComments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get comments error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Toggle like on a comment
exports.toggleCommentLike = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.userId;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const likeIndex = comment.likes.findIndex(id => id.toString() === userId.toString());
    if (likeIndex === -1) {
      comment.likes.push(userId);
    } else {
      comment.likes.splice(likeIndex, 1);
    }
    await comment.save();

    res.json({
      success: true,
      data: {
        isLiked: likeIndex === -1,
        likesCount: comment.likes.length
      }
    });
  } catch (error) {
    console.error('Toggle comment like error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete post
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const postAuthorId = (post.author._id || post.author).toString();
    const currentUserId = req.user.userId.toString();

    if (postAuthorId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own posts'
      });
    }

    post.isActive = false;
    await post.save();

    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { 'stats.posts': -1 }
    });

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
};

// Update post
exports.updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text, visibility, allowComments } = req.body;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.author.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (text !== undefined) post.content.text = text;
    if (visibility) post.visibility = visibility;
    if (allowComments !== undefined) post.allowComments = allowComments;

    post.isEdited = true;
    post.editedAt = new Date();

    await post.save();

    const maskedPost = maskAnonymousPost(post);

    res.json({
      success: true,
      data: maskedPost
    });
  } catch (error) {
    console.error('Update post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// SEARCH POSTS
// ==========================================
exports.searchPosts = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json({ success: true, data: [] });
    }

    const searchQuery = q.trim();

    // Search by text content or hashtags
    const posts = await Post.find({
      isActive: true,
      isAnonymous: false,
      visibility: 'public',
      $or: [
        { 'content.text': { $regex: searchQuery, $options: 'i' } },
        { 'content.hashtags': { $regex: searchQuery.replace('#', ''), $options: 'i' } }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('author', 'username name avatar profile isVerified')
      .lean();

    res.json({
      success: true,
      data: posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Search posts error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// GET TRENDING HASHTAGS
// ==========================================
exports.getTrendingHashtags = async (req, res) => {
  try {
    const timeAgo = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

    const trending = await Post.aggregate([
      { $match: { isActive: true, visibility: 'public', createdAt: { $gte: timeAgo } } },
      { $unwind: '$content.hashtags' },
      { $group: { _id: '$content.hashtags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: trending.map(t => ({ tag: t._id, count: t.count }))
    });
  } catch (error) {
    console.error('Get trending error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};