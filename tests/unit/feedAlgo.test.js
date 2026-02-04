/**
 * feedAlgo.test.js - Unit tests for Post Feed Ranking Algorithm
 */

// Mock dependencies
jest.mock('../../src/models/UserEngagement', () => ({
    getBatchAffinities: jest.fn().mockResolvedValue(new Map())
}));

jest.mock('../../src/models/Like', () => ({
    getLikeVelocity: jest.fn().mockResolvedValue(0)
}));

const feedAlgo = require('../../src/Algorithms/feedAlgo');

describe('feedAlgo', () => {

    describe('calculatePostScore', () => {
        it('should return 0 for post with no engagement', () => {
            const post = { stats: {}, likes: [], content: {} };
            const score = feedAlgo.calculatePostScore(post);
            expect(score).toBe(0);
        });

        it('should calculate weighted score for likes', () => {
            const post = { stats: { likes: 50 }, content: {} };
            const score = feedAlgo.calculatePostScore(post);
            expect(score).toBe(50 * feedAlgo.CONFIG.WEIGHTS.likes);
        });

        it('should weight comments higher than likes', () => {
            const postWithLikes = { stats: { likes: 10 }, content: {} };
            const postWithComments = { stats: { comments: 10 }, content: {} };

            const likeScore = feedAlgo.calculatePostScore(postWithLikes);
            const commentScore = feedAlgo.calculatePostScore(postWithComments);

            expect(commentScore).toBeGreaterThan(likeScore);
        });

        it('should apply media type boost for video', () => {
            const videoPost = { stats: { likes: 10 }, content: { media: [{ type: 'video' }] } };
            const textPost = { stats: { likes: 10 }, content: {} };

            const videoScore = feedAlgo.calculatePostScore(videoPost);
            const textScore = feedAlgo.calculatePostScore(textPost);

            expect(videoScore).toBeGreaterThan(textScore);
        });
    });

    describe('getMediaType', () => {
        it('should return text_only for no media', () => {
            const post = { content: {} };
            expect(feedAlgo.getMediaType(post)).toBe('text_only');
        });

        it('should return video if video is present', () => {
            const post = { content: { media: [{ type: 'image' }, { type: 'video' }] } };
            expect(feedAlgo.getMediaType(post)).toBe('video');
        });

        it('should return image if only image', () => {
            const post = { content: { media: [{ type: 'image' }] } };
            expect(feedAlgo.getMediaType(post)).toBe('image');
        });

        it('should return gif if only gif', () => {
            const post = { content: { media: [{ type: 'gif' }] } };
            expect(feedAlgo.getMediaType(post)).toBe('gif');
        });
    });

    describe('applyTimeDecay', () => {
        it('should return full score for brand new content', () => {
            const score = 100;
            const now = new Date();
            const decayed = feedAlgo.applyTimeDecay(score, now);
            expect(decayed).toBeCloseTo(100, 1);
        });

        it('should halve score at half-life (12 hours for posts)', () => {
            const score = 100;
            const halfLifeAgo = new Date(Date.now() - feedAlgo.CONFIG.HALF_LIFE_HOURS * 60 * 60 * 1000);
            const decayed = feedAlgo.applyTimeDecay(score, halfLifeAgo);
            expect(decayed).toBeCloseTo(50, 1);
        });

        it('should decay faster than reels (12hr vs 24hr half-life)', () => {
            expect(feedAlgo.CONFIG.HALF_LIFE_HOURS).toBeLessThan(24);
        });
    });

    describe('getHashtagBoost', () => {
        it('should return 0 for no hashtags', () => {
            const post = { content: {} };
            const boost = feedAlgo.getHashtagBoost(post, ['trending']);
            expect(boost).toBe(0);
        });

        it('should return 0 for no trending hashtags', () => {
            const post = { content: { hashtags: ['random'] } };
            const boost = feedAlgo.getHashtagBoost(post, []);
            expect(boost).toBe(0);
        });

        it('should boost for matching trending hashtags', () => {
            const post = { content: { hashtags: ['trending', 'viral'] } };
            const trendingHashtags = ['trending', 'hot'];
            const boost = feedAlgo.getHashtagBoost(post, trendingHashtags);
            expect(boost).toBe(feedAlgo.CONFIG.TRENDING_HASHTAG_BOOST);
        });

        it('should be case insensitive', () => {
            const post = { content: { hashtags: ['TRENDING'] } };
            const trendingHashtags = ['trending'];
            const boost = feedAlgo.getHashtagBoost(post, trendingHashtags);
            expect(boost).toBeGreaterThan(0);
        });
    });

    describe('rankPosts', () => {
        it('should return empty array for empty input', async () => {
            const result = await feedAlgo.rankPosts([], 'user123');
            expect(result).toEqual([]);
        });

        it('should sort posts by score descending', async () => {
            const posts = [
                { _id: '1', stats: { likes: 10 }, createdAt: new Date(), author: 'a', content: {} },
                { _id: '2', stats: { likes: 100 }, createdAt: new Date(), author: 'b', content: {} },
                { _id: '3', stats: { likes: 50 }, createdAt: new Date(), author: 'c', content: {} }
            ];

            const ranked = await feedAlgo.rankPosts(posts, null, { includeVelocity: false });

            expect(ranked[0]._id).toBe('2');
            expect(ranked[1]._id).toBe('3');
            expect(ranked[2]._id).toBe('1');
        });
    });

    describe('getTrendingPosts', () => {
        it('should filter to recent posts only', async () => {
            const oldPost = {
                _id: 'old',
                stats: { likes: 1000 },
                createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
            };
            const newPost = {
                _id: 'new',
                stats: { likes: 10 },
                createdAt: new Date()
            };

            const trending = await feedAlgo.getTrendingPosts([oldPost, newPost], { timeRange: 6 });

            expect(trending.length).toBe(1);
            expect(trending[0]._id).toBe('new');
        });
    });
});
