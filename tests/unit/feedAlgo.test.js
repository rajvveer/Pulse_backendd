/**
 * feedAlgo.test.js - Unit tests for Post Feed Ranking Algorithm v2.0
 */

jest.mock('../../src/models/UserEngagement', () => ({
    getBatchAffinities: jest.fn().mockResolvedValue(new Map())
}));
jest.mock('../../src/models/Like', () => ({
    getLikeVelocity: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) })
}));
jest.mock('../../src/models/UserBehavior', () => ({
    getPreferences: jest.fn().mockResolvedValue({ sessionDepth: 0, totalInteractions: 50 }),
    getSeenPostIds: jest.fn().mockResolvedValue(new Set())
}));
jest.mock('../../src/Algorithms/InterestProfiler', () => ({
    getRelevanceScore: jest.fn().mockResolvedValue(5),
    extractTopics: jest.fn().mockReturnValue([])
}));
jest.mock('../../src/Algorithms/VibeClassifier', () => ({
    classify: jest.fn().mockReturnValue({ vibe: 'chill', vibeScore: {}, confidence: 0.8 }),
    boostByVibe: jest.fn(posts => posts)
}));

const feedAlgo = require('../../src/Algorithms/feedAlgo');

describe('feedAlgo', () => {

    describe('calculatePostScore', () => {
        it('should return 0 for post with no engagement', () => {
            expect(feedAlgo.calculatePostScore({ stats: {}, likes: [], content: {} })).toBe(0);
        });

        it('should calculate weighted score for likes', () => {
            expect(feedAlgo.calculatePostScore({ stats: { likes: 50 }, content: {} }))
                .toBe(50 * feedAlgo.CONFIG.WEIGHTS.likes);
        });

        it('should weight comments higher than likes', () => {
            const likes = feedAlgo.calculatePostScore({ stats: { likes: 10 }, content: {} });
            const comments = feedAlgo.calculatePostScore({ stats: { comments: 10 }, content: {} });
            expect(comments).toBeGreaterThan(likes);
        });

        it('should apply media type boost for video', () => {
            const video = feedAlgo.calculatePostScore({ stats: { likes: 10 }, content: { media: [{ type: 'video' }] } });
            const text = feedAlgo.calculatePostScore({ stats: { likes: 10 }, content: {} });
            expect(video).toBeGreaterThan(text);
        });
    });

    describe('getMediaType', () => {
        it('should return text_only for no media', () => {
            expect(feedAlgo.getMediaType({ content: {} })).toBe('text_only');
        });
        it('should return video if video present', () => {
            expect(feedAlgo.getMediaType({ content: { media: [{ type: 'image' }, { type: 'video' }] } })).toBe('video');
        });
        it('should return image if only image', () => {
            expect(feedAlgo.getMediaType({ content: { media: [{ type: 'image' }] } })).toBe('image');
        });
        it('should return gif if only gif', () => {
            expect(feedAlgo.getMediaType({ content: { media: [{ type: 'gif' }] } })).toBe('gif');
        });
    });

    describe('applyTimeDecay', () => {
        it('should return full score for new content', () => {
            expect(feedAlgo.applyTimeDecay(100, new Date())).toBeCloseTo(100, 1);
        });
        it('should halve score at half-life', () => {
            const halfLifeAgo = new Date(Date.now() - feedAlgo.CONFIG.HALF_LIFE_HOURS * 3600000);
            expect(feedAlgo.applyTimeDecay(100, halfLifeAgo)).toBeCloseTo(50, 1);
        });
    });

    describe('getHashtagBoost', () => {
        it('should return 0 for no hashtags', () => {
            expect(feedAlgo.getHashtagBoost({ content: {} }, ['trending'])).toBe(0);
        });
        it('should boost for matching trending hashtags', () => {
            expect(feedAlgo.getHashtagBoost({ content: { hashtags: ['trending', 'viral'] } }, ['trending', 'hot']))
                .toBe(feedAlgo.CONFIG.TRENDING_HASHTAG_BOOST);
        });
        it('should be case insensitive', () => {
            expect(feedAlgo.getHashtagBoost({ content: { hashtags: ['TRENDING'] } }, ['trending']))
                .toBeGreaterThan(0);
        });
    });

    describe('applyQualityGate (v2.0)', () => {
        it('should keep new posts regardless of engagement', () => {
            const posts = [{ createdAt: new Date(), stats: { likes: 0, comments: 0, shares: 0 } }];
            expect(feedAlgo.applyQualityGate(posts).length).toBe(1);
        });

        it('should filter old posts with low engagement', () => {
            const oldDate = new Date(Date.now() - 48 * 3600000);
            const posts = [{ createdAt: oldDate, stats: { likes: 0, comments: 0, shares: 0 } }];
            expect(feedAlgo.applyQualityGate(posts).length).toBe(0);
        });

        it('should keep old posts with enough engagement', () => {
            const oldDate = new Date(Date.now() - 48 * 3600000);
            const posts = [{ createdAt: oldDate, stats: { likes: 5, comments: 0, shares: 0 } }];
            expect(feedAlgo.applyQualityGate(posts).length).toBe(1);
        });
    });

    describe('applyContentFatigue (v2.0)', () => {
        it('should return posts unchanged for small batches', () => {
            const posts = [{ author: { _id: 'a1' }, _score: 10 }];
            const result = feedAlgo.applyContentFatigue(posts);
            expect(result[0]._score).toBe(10);
        });

        it('should penalize author saturation', () => {
            const posts = Array(6).fill(null).map((_, i) => ({
                author: { _id: 'same_author' }, _score: 10
            }));
            const result = feedAlgo.applyContentFatigue(posts);
            const penalized = result.filter(p => p._fatiguePenalty !== null);
            expect(penalized.length).toBeGreaterThan(0);
        });
    });

    describe('enforceAuthorDiversity (v2.0)', () => {
        it('should prevent 3+ consecutive same-author posts', () => {
            const posts = [
                { author: { _id: 'a' } }, { author: { _id: 'a' } }, { author: { _id: 'a' } },
                { author: { _id: 'b' } }
            ];
            const result = feedAlgo.enforceAuthorDiversity(posts);
            // Third 'a' should not be consecutive with first two
            const authorIds = result.map(p => p.author._id);
            for (let i = 2; i < authorIds.length; i++) {
                if (authorIds[i] === authorIds[i - 1] && authorIds[i] === authorIds[i - 2]) {
                    fail('Three consecutive posts from same author found');
                }
            }
        });
    });

    describe('applyNegativeSignals (v2.0)', () => {
        it('should return posts unchanged with no signals', () => {
            const posts = [{ _score: 10, author: { _id: 'a1' } }];
            expect(feedAlgo.applyNegativeSignals(posts)[0]._score).toBe(10);
        });

        it('should penalize unfollowed authors', () => {
            const posts = [{ _score: 10, author: { _id: 'a1' } }];
            const result = feedAlgo.applyNegativeSignals(posts, { unfollowedAuthors: ['a1'] });
            expect(result[0]._score).toBeLessThan(10);
        });
    });

    describe('applyEngagementFeedback (v2.0)', () => {
        it('should return posts unchanged with no feedback', () => {
            const posts = [{ _score: 10 }];
            expect(feedAlgo.applyEngagementFeedback(posts)[0]._score).toBe(10);
        });
    });

    describe('rankPosts', () => {
        it('should return empty array for empty input', async () => {
            expect(await feedAlgo.rankPosts([], 'user123')).toEqual([]);
        });

        it('should sort posts by score descending', async () => {
            const posts = [
                { _id: '1', stats: { likes: 10 }, createdAt: new Date(), author: 'a', content: {} },
                { _id: '2', stats: { likes: 100 }, createdAt: new Date(), author: 'b', content: {} },
                { _id: '3', stats: { likes: 50 }, createdAt: new Date(), author: 'c', content: {} }
            ];
            const ranked = await feedAlgo.rankPosts(posts, null, { includeVelocity: false });
            expect(ranked[0]._id).toBe('2');
        });
    });

    describe('getTrendingPosts', () => {
        it('should filter to recent posts only', async () => {
            const old = { _id: 'old', stats: { likes: 1000 }, createdAt: new Date(Date.now() - 24 * 3600000) };
            const recent = { _id: 'new', stats: { likes: 10 }, createdAt: new Date() };
            const trending = await feedAlgo.getTrendingPosts([old, recent], { timeRange: 6 });
            expect(trending.length).toBe(1);
            expect(trending[0]._id).toBe('new');
        });
    });
});
