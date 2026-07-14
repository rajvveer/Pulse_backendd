const Post = require('../models/Post');
const User = require('../models/User');
const Follow = require('../models/Follow');
const Like = require('../models/Like');
const UserBehavior = require('../models/UserBehavior');
const UserEngagement = require('../models/UserEngagement');
const SocialDNA = require('../models/SocialDNA');
const feedAlgo = require('../Algorithms/feedAlgo');
const cacheService = require('../services/cacheService');
const userVectorService = require('../services/userVectorService');
const vectorRetrievalService = require('../services/vectorRetrievalService');

// Models bundle for userVectorService (kept here so the service stays DB-agnostic).
const VECTOR_DEPS = { Like, Post, SocialDNA, UserBehavior };
const RETRIEVE_LIMIT = parseInt(process.env.FEED_RETRIEVE_LIMIT) || 200;

// ── Cache TTLs (seconds) — tunable via env ──
const CANDIDATE_TTL = parseInt(process.env.FEED_CANDIDATE_TTL_SEC) || 30; // shared global candidate set
const FOLLOW_GRAPH_TTL = parseInt(process.env.FOLLOW_GRAPH_TTL_SEC) || 60; // per-user follow graph
const PAGE_TTL = parseInt(process.env.FEED_PAGE_TTL_SEC) || 20; // per-user ranked page

// Hard caps so a client can never force an unbounded scan / deep skip.
const MAX_PAGE = 50;
const clampPage = (p) => Math.min(Math.max(parseInt(p) || 1, 1), MAX_PAGE);
const clampLimit = (l) => Math.min(Math.max(parseInt(l) || 20, 1), 50);

// Follow graph from the Follow collection, CACHED. The legacy
// User.following / User.followers arrays are no longer read here.
const getFollowGraph = async (userId) => {
    return cacheService.getOrSet(
        `followgraph:${userId}`,
        async () => {
            const [followingIds, followerIds] = await Promise.all([
                Follow.getFollowingIds(userId),
                Follow.getFollowerIds(userId)
            ]);
            const followersSet = new Set(followerIds.map(String));
            // Friends = mutual follows (used for social proof)
            const friendIds = followingIds
                .map(String)
                .filter(id => followersSet.has(id));
            return { followingIds: followingIds.map(String), friendIds };
        },
        FOLLOW_GRAPH_TTL
    );
};

// Process posts: attach the caller's like status + mask anonymous.
//
// SCALE FIX (B2): we no longer re-aggregate the Like collection per render to
// recompute counts — `post.stats.likes` is maintained atomically on every
// like/unlike (see postController.toggleLike) and is authoritative for display.
// We only fetch the SMALL per-user "did I like these?" set for the page slice.
const processPosts = async (posts, userId) => {
    if (!posts || posts.length === 0) return [];

    const postIds = posts.map(p => (p._id || p).toString());
    const likedSet = userId
        ? await Like.getLikedIds(userId, 'post', postIds)
        : new Set();

    return posts.map(post => {
        const postObj = typeof post.toObject === 'function' ? post.toObject() : { ...post };

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
        if (!postObj.stats) postObj.stats = {};
        // Trust the maintained counter; never recompute via aggregation here.
        postObj.stats.likes = postObj.stats.likes || 0;

        return {
            ...postObj,
            isLiked: likedSet.has(postId),
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
 */
exports.getHomeFeed = async (req, res) => {
    try {
        const page = clampPage(req.query.page);
        const limit = clampLimit(req.query.limit);
        const vibe = req.query.vibe || 'auto';
        const userId = req.user.userId;

        const { followingIds, friendIds } = await getFollowGraph(userId);

        // Bounded candidate fetch — newest eligible posts only.
        const fetchLimit = Math.min(limit * 5, 100);
        const posts = await Post.find({
            isActive: true,
            $or: [
                { visibility: 'public' },
                { visibility: 'followers', author: { $in: [...followingIds, userId] } }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(fetchLimit)
            .populate('author', 'username name avatar profile isVerified stats')
            .lean();

        const rankedPosts = await feedAlgo.rankPostsWithVibe(posts, userId, {
            followingIds,
            friendIds,
            includeVelocity: true,
            vibe
        });

        const startIndex = (page - 1) * limit;
        const paginatedPosts = rankedPosts.slice(startIndex, startIndex + limit);
        const postsWithLikes = await processPosts(paginatedPosts, userId);

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page,
                limit,
                hasMore: startIndex + limit < rankedPosts.length
            },
            vibe
        });
    } catch (error) {
        console.error('Get home feed error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
};


/**
 * @desc    Get Following feed (chronological posts from followed users)
 * @route   GET /api/v1/feed/following
 * @access  Private
 */
exports.getFollowingFeed = async (req, res) => {
    try {
        const page = clampPage(req.query.page);
        const limit = clampLimit(req.query.limit);
        const userId = req.user.userId;

        const { followingIds } = await getFollowGraph(userId);

        if (followingIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                pagination: { page: 1, limit, hasMore: false, feedType: 'following' }
            });
        }

        // Keyset pagination on createdAt — avoids skip() walking & discarding
        // every prior document on deep pages.
        const before = req.query.before ? new Date(req.query.before) : null;
        const query = {
            author: { $in: followingIds },
            isActive: true,
            visibility: { $in: ['public', 'followers'] }
        };
        if (before && !isNaN(before.getTime())) {
            query.createdAt = { $lt: before };
        }

        const posts = await Post.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1) // one extra to compute hasMore
            .populate('author', 'username name avatar profile isVerified stats')
            .lean();

        const hasMore = posts.length > limit;
        const paginatedPosts = hasMore ? posts.slice(0, limit) : posts;
        const postsWithLikes = await processPosts(paginatedPosts, userId);
        const nextCursor = paginatedPosts.length
            ? paginatedPosts[paginatedPosts.length - 1].createdAt
            : null;

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page,
                limit,
                hasMore,
                nextCursor,
                feedType: 'following'
            }
        });
    } catch (error) {
        console.error('Get following feed error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
};

/**
 * @desc    Get "For You" discovery feed (personalized discovery)
 * @route   GET /api/v1/feed/foryou
 * @access  Private
 *
 * SCALE FIX (B1/B4): the candidate set (newest public posts) is IDENTICAL for
 * every user, so it is fetched ONCE and shared via Redis for CANDIDATE_TTL
 * seconds. Per request we only apply the user's cheap personal ranking overlay.
 * This turns ~100K identical 200-doc scans/interval into ONE.
 */
exports.getForYouFeed = async (req, res) => {
    try {
        const page = clampPage(req.query.page);
        const limit = clampLimit(req.query.limit);
        const userId = req.user.userId;

        const { followingIds } = await getFollowGraph(userId);

        // ── Candidate generation: retrieve-then-rank ──
        // If we can build a taste vector for this user, RETRIEVE a semantically
        // relevant candidate pool (vector similarity) and blend it with the
        // shared fresh set (for novelty/recency); otherwise use the shared set
        // alone. Eval-proven: this lifts nDCG/recall/coverage substantially.
        const posts = await getForYouCandidates(userId);

        const rankedPosts = await feedAlgo.getForYouFeed(userId, posts, {
            followingIds,
            includeVelocity: true
        });

        const startIndex = (page - 1) * limit;
        const paginatedPosts = rankedPosts.slice(startIndex, startIndex + limit);
        const postsWithLikes = await processPosts(paginatedPosts, userId);

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page,
                limit,
                hasMore: startIndex + limit < rankedPosts.length,
                feedType: 'foryou'
            }
        });
    } catch (error) {
        console.error('Get for you feed error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
};

/**
 * @desc    Get all public posts (Global Feed, chronological with light ranking)
 * @route   GET /api/v1/feed/global
 * @access  Private
 */
exports.getGlobalFeed = async (req, res) => {
    try {
        const page = clampPage(req.query.page);
        const limit = clampLimit(req.query.limit);
        const userId = req.user.userId;

        const { followingIds, friendIds } = await getFollowGraph(userId);

        // Shared candidate set (same for everyone) — fetched once per interval.
        const posts = await getCandidateSet('global');

        const rankedPosts = await feedAlgo.rankPosts(posts, userId, {
            followingIds,
            friendIds,
            includeVelocity: true
        });

        const startIndex = (page - 1) * limit;
        const paginatedPosts = rankedPosts.slice(startIndex, startIndex + limit);
        const postsWithLikes = await processPosts(paginatedPosts, userId);

        res.json({
            success: true,
            data: postsWithLikes,
            pagination: {
                page,
                limit,
                hasMore: startIndex + limit < rankedPosts.length
            }
        });
    } catch (error) {
        console.error('Get global feed error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
};

/**
 * @desc    Get posts based on velocity and recency (TRENDING)
 * @route   GET /api/v1/feed/trending
 * @access  Private
 */
exports.getTrendingPosts = async (req, res) => {
    try {
        const limit = clampLimit(req.query.limit);
        const timeRange = Math.min(Math.max(parseInt(req.query.timeRange) || 6, 1), 168);
        const userId = req.user.userId;

        // Trending candidate set is shared across users → cache it.
        const posts = await cacheService.getOrSet(
            `feed:candidate:trending:${timeRange}`,
            async () => {
                const cutoff = new Date(Date.now() - timeRange * 60 * 60 * 1000);
                return Post.find({
                    isActive: true,
                    visibility: 'public',
                    createdAt: { $gte: cutoff }
                })
                    .sort({ 'stats.likes': -1 })
                    .limit(100)
                    .populate('author', 'username name avatar profile isVerified')
                    .lean();
            },
            CANDIDATE_TTL
        );

        const trendingPosts = await feedAlgo.getTrendingPosts(posts, {
            timeRange,
            limit
        });

        const postsWithLikes = await processPosts(trendingPosts, userId);

        res.json({ success: true, data: postsWithLikes });
    } catch (error) {
        console.error('Get trending posts error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
};

/**
 * @desc    Get posts near the user's location
 * @route   GET /api/v1/feed/nearby
 * @access  Private
 */
exports.getNearbyPosts = async (req, res) => {
    try {
        const { longitude, latitude, maxDistance = 1000 } = req.query;
        const limit = clampLimit(req.query.limit);

        if (!longitude || !latitude) {
            return res.status(400).json({ success: false, message: 'Location required' });
        }

        const userId = req.user.userId;

        const posts = await Post.getNearbyPosts(
            [parseFloat(longitude), parseFloat(latitude)],
            Math.min(parseInt(maxDistance) || 1000, 50000),
            { limit }
        );

        const postsWithLikes = await processPosts(posts, userId);

        res.json({ success: true, data: postsWithLikes });
    } catch (error) {
        console.error('Get nearby posts error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
};

// Shared candidate set for the discovery feeds (For-You / Global). The newest
// ~200 public active posts are the same for every user, so we compute them
// once per CANDIDATE_TTL and serve them from Redis with single-flight (one DB
// scan even under a stampede). Per-user ranking is applied AFTER this.
async function getCandidateSet(kind) {
    return cacheService.getOrSet(
        `feed:candidate:${kind}`,
        async () => Post.find({
            isActive: true,
            visibility: 'public'
        })
            .sort({ createdAt: -1 })
            .limit(200)
            .populate('author', 'username name avatar profile isVerified stats')
            .lean(),
        CANDIDATE_TTL
    );
}

// Personalized candidate generation for the For-You feed: retrieve a
// vector-similar pool for this user, blended with the shared fresh set so the
// feed stays novel and never starves if the user has no taste vector yet.
// Degrades safely to the shared set on any error (retrieval is best-effort).
async function getForYouCandidates(userId) {
    const fresh = await getCandidateSet('foryou'); // shared, cached
    try {
        const userVec = await userVectorService.getUserVector(userId, VECTOR_DEPS);
        if (!userVec) return fresh; // brand-new user → recency pool (ranker cold-starts)

        const retrieved = await vectorRetrievalService.retrieveCandidates({
            Post,
            userVec,
            filter: { author: { $ne: userId } },
            limit: RETRIEVE_LIMIT,
        });
        if (!retrieved || retrieved.length === 0) return fresh;

        // Merge retrieved (relevance) + fresh (novelty/recency), de-duped.
        const seen = new Set();
        const merged = [];
        for (const p of retrieved) { const id = p._id.toString(); if (!seen.has(id)) { seen.add(id); merged.push(p); } }
        for (const p of fresh) { const id = p._id.toString(); if (!seen.has(id)) { seen.add(id); merged.push(p); } }
        return merged;
    } catch (err) {
        console.warn('[feed] retrieval failed, using shared candidate set:', err.message);
        return fresh;
    }
}
