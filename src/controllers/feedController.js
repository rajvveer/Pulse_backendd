const Post = require('../models/Post');
const User = require('../models/User');
const Like = require('../models/Like');
const UserBehavior = require('../models/UserBehavior');
const UserEngagement = require('../models/UserEngagement');
const feedAlgo = require('../Algorithms/feedAlgo');

// Helper function to process posts and attach like status + mask anonymous
const processPosts = async (posts, userId) => {
    if (!posts || posts.length === 0) return [];

    // Get like status in batch
    const postIds = posts.map(p => (p._id || p).toString());
    const likedSet = userId
        ? await Like.getLikedIds(userId, 'post', postIds)
        : new Set();

    // Get like counts in batch
    const likeCounts = await Like.getBatchLikeCounts('post', postIds);

    return posts.map(post => {
        const postObj = typeof post.toObject === 'function' ? post.toObject() : { ...post };

        // Mask author if anonymous
        if (postObj.isAnonymous) {
            postObj.author = {
                _id: null,
                username: 'anonymous',
                name: 'Anonymous',
                avatar: 'https://res.cloudinary.com/pulse/image/upload/v1/defaults/anonymous-avatar.png',
                isVerified: false
            };
        }

        const postId = (postObj._id || post._id).toString();
        const likeCount = likeCounts.get(postId) || 0;

        // Ensure stats object exists and set likes from Like model
        if (!postObj.stats) postObj.stats = {};
        postObj.stats.likes = likeCount;

        return {
            ...postObj,
            isLiked: likedSet.has(postId),
            // Remove internal scoring fields
            _score: undefined,
            _velocity: undefined,
            _engagementScore: undefined
        };
    });
};

/**
 * @desc    Get the personalized home feed (Ranked by algorithm)
 * @route   GET /api/v1/feed/home
 * @access  Private
 * @query   vibe - Optional vibe filter (chill, hype, sad, funny, creative, auto)
 */
exports.getHomeFeed = async (req, res) => {
    try {
        const { page = 1, limit = 20, vibe = 'auto' } = req.query;
        const userId = req.user.userId;

        const user = await User.findById(userId).select('following followers').lean();
        const followingIds = user?.following || [];

        // Get mutual follows for social proof (friends = mutual follows)
        const followersSet = new Set((user?.followers || []).map(id => id.toString()));
        const friendIds = followingIds.filter(id => followersSet.has(id.toString()));

        // Fetch more posts for ranking
        const fetchLimit = Math.min(parseInt(limit) * 5, 100);

        const posts = await Post.find({
            isActive: true,
            visibility: { $in: ['public', 'followers'] }
        })
            .sort({ createdAt: -1 })
            .limit(fetchLimit)
            .populate('author', 'username name avatar profile isVerified stats')
            .lean();

        // Apply ranking algorithm with vibe filtering (Vibe Check feature)
        const rankedPosts = await feedAlgo.rankPostsWithVibe(posts, userId, {
            followingIds,
            friendIds,  // For social proof
            includeVelocity: true,
            vibe  // Pass vibe filter from query
        });

        // Paginate after ranking
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const paginatedPosts = rankedPosts.slice(startIndex, startIndex + parseInt(limit));

        const postsWithLikes = await processPosts(paginatedPosts, userId);

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                hasMore: startIndex + parseInt(limit) < rankedPosts.length
            },
            vibe  // Return current vibe filter
        });
    } catch (error) {
        console.error('Get home feed error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * @desc    Get "For You" discovery feed (personalized discovery)
 * @route   GET /api/v1/feed/foryou
 * @access  Private
 */
exports.getForYouFeed = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user.userId;

        const user = await User.findById(userId).select('following').lean();
        const followingIds = user?.following || [];

        // Fetch diverse posts for discovery
        const posts = await Post.find({
            isActive: true,
            visibility: 'public'
        })
            .sort({ createdAt: -1 })
            .limit(200)
            .populate('author', 'username name avatar profile isVerified stats')
            .lean();

        // Apply For You algorithm (excludes own content, prioritizes discovery)
        const rankedPosts = await feedAlgo.getForYouFeed(userId, posts, {
            followingIds,
            includeVelocity: true
        });

        // Paginate
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const paginatedPosts = rankedPosts.slice(startIndex, startIndex + parseInt(limit));

        const postsWithLikes = await processPosts(paginatedPosts, userId);

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                hasMore: startIndex + parseInt(limit) < rankedPosts.length,
                feedType: 'foryou'
            }
        });
    } catch (error) {
        console.error('Get for you feed error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get all public posts (Global Feed, chronological with light ranking)
 * @route   GET /api/v1/feed/global
 * @access  Private
 */
exports.getGlobalFeed = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user.userId;

        // Get user's friends for social proof
        const user = await User.findById(userId).select('following followers').lean();
        const followingIds = user?.following || [];
        const followersSet = new Set((user?.followers || []).map(id => id.toString()));
        const friendIds = followingIds.filter(id => followersSet.has(id.toString()));

        const posts = await Post.find({
            isActive: true,
            visibility: 'public'
        })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit) * 3)
            .skip((parseInt(page) - 1) * parseInt(limit))
            .populate('author', 'username name avatar profile isVerified')
            .lean();

        // Apply full ranking with addiction mechanics
        const rankedPosts = await feedAlgo.rankPosts(posts, userId, {
            followingIds,
            friendIds,
            includeVelocity: true  // Enable velocity for better ranking
        });

        const postsWithLikes = await processPosts(rankedPosts.slice(0, parseInt(limit)), userId);

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                hasMore: posts.length === parseInt(limit) * 3
            }
        });
    } catch (error) {
        console.error('Get global feed error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get posts based on velocity and recency (TRENDING)
 * @route   GET /api/v1/feed/trending
 * @access  Private
 */
exports.getTrendingPosts = async (req, res) => {
    try {
        const { limit = 20, timeRange = 6 } = req.query;
        const userId = req.user.userId;

        // Fetch recent posts
        const cutoff = new Date(Date.now() - parseInt(timeRange) * 60 * 60 * 1000);

        const posts = await Post.find({
            isActive: true,
            visibility: 'public',
            createdAt: { $gte: cutoff }
        })
            .sort({ 'stats.likes': -1 })
            .limit(100) // Fetch more for velocity calculation
            .populate('author', 'username name avatar profile isVerified')
            .lean();

        // Apply trending algorithm (pure velocity)
        const trendingPosts = await feedAlgo.getTrendingPosts(posts, {
            timeRange: parseInt(timeRange),
            limit: parseInt(limit)
        });

        const postsWithLikes = await processPosts(trendingPosts, userId);

        res.json({
            success: true,
            data: postsWithLikes
        });
    } catch (error) {
        console.error('Get trending posts error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get posts near the user's location
 * @route   GET /api/v1/feed/nearby
 * @access  Private
 */
exports.getNearbyPosts = async (req, res) => {
    try {
        const { longitude, latitude, maxDistance = 1000, limit = 20 } = req.query;

        if (!longitude || !latitude) {
            return res.status(400).json({ success: false, message: 'Location required' });
        }

        const userId = req.user.userId;

        const posts = await Post.getNearbyPosts(
            [parseFloat(longitude), parseFloat(latitude)],
            parseInt(maxDistance),
            { limit: parseInt(limit) }
        );

        const postsWithLikes = await processPosts(posts, userId);

        res.json({
            success: true,
            data: postsWithLikes
        });
    } catch (error) {
        console.error('Get nearby posts error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};
