/**
 * ReelAlgo.test.js - Unit tests for Reel Feed Ranking Algorithm
 */

// Mock dependencies before requiring the module
jest.mock('../../src/models/UserEngagement', () => ({
    getBatchAffinities: jest.fn().mockResolvedValue(new Map())
}));

jest.mock('../../src/models/Like', () => ({
    getLikeVelocity: jest.fn().mockResolvedValue(0)
}));

const ReelAlgo = require('../../src/Algorithms/ReelAlgo');

describe('ReelAlgo', () => {

    describe('calculateEngagementScore', () => {
        it('should return 0 for reel with no engagement', () => {
            const reel = { stats: {}, likes: [], commentsCount: 0 };
            const score = ReelAlgo.calculateEngagementScore(reel);
            expect(score).toBe(0);
        });

        it('should calculate weighted score for likes', () => {
            const reel = { stats: { likes: 100 }, likes: [] };
            const score = ReelAlgo.calculateEngagementScore(reel);
            expect(score).toBe(100 * ReelAlgo.CONFIG.WEIGHTS.likes);
        });

        it('should weight comments higher than likes', () => {
            const reelWithLikes = { stats: { likes: 10 } };
            const reelWithComments = { stats: { comments: 10 } };

            const likeScore = ReelAlgo.calculateEngagementScore(reelWithLikes);
            const commentScore = ReelAlgo.calculateEngagementScore(reelWithComments);

            expect(commentScore).toBeGreaterThan(likeScore);
        });

        it('should weight shares highest', () => {
            const reelWithShares = { stats: { shares: 10 } };
            const reelWithComments = { stats: { comments: 10 } };

            const shareScore = ReelAlgo.calculateEngagementScore(reelWithShares);
            const commentScore = ReelAlgo.calculateEngagementScore(reelWithComments);

            expect(shareScore).toBeGreaterThan(commentScore);
        });

        it('should handle legacy likes array', () => {
            const reel = { likes: [1, 2, 3, 4, 5], stats: {} };
            const score = ReelAlgo.calculateEngagementScore(reel);
            expect(score).toBe(5 * ReelAlgo.CONFIG.WEIGHTS.likes);
        });
    });

    describe('applyTimeDecay', () => {
        it('should return full score for brand new content', () => {
            const score = 100;
            const now = new Date();
            const decayed = ReelAlgo.applyTimeDecay(score, now);
            expect(decayed).toBeCloseTo(100, 1);
        });

        it('should halve score at half-life', () => {
            const score = 100;
            const halfLifeAgo = new Date(Date.now() - ReelAlgo.CONFIG.HALF_LIFE_HOURS * 60 * 60 * 1000);
            const decayed = ReelAlgo.applyTimeDecay(score, halfLifeAgo);
            expect(decayed).toBeCloseTo(50, 1);
        });

        it('should quarter score at 2x half-life', () => {
            const score = 100;
            const twoHalfLivesAgo = new Date(Date.now() - 2 * ReelAlgo.CONFIG.HALF_LIFE_HOURS * 60 * 60 * 1000);
            const decayed = ReelAlgo.applyTimeDecay(score, twoHalfLivesAgo);
            expect(decayed).toBeCloseTo(25, 1);
        });

        it('should return minimal score for very old content', () => {
            const score = 100;
            const veryOld = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days
            const decayed = ReelAlgo.applyTimeDecay(score, veryOld);
            expect(decayed).toBeLessThan(5);
        });
    });

    describe('getFreshnessBoost', () => {
        it('should give 2x boost for content < 1 hour old', () => {
            const now = new Date();
            const boost = ReelAlgo.getFreshnessBoost(now);
            expect(boost).toBe(2.0);
        });

        it('should give 1.5x boost for content 2 hours old', () => {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const boost = ReelAlgo.getFreshnessBoost(twoHoursAgo);
            expect(boost).toBe(1.5);
        });

        it('should give no boost for content > 24 hours old', () => {
            const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
            const boost = ReelAlgo.getFreshnessBoost(twoDaysAgo);
            expect(boost).toBe(1.0);
        });
    });

    describe('getPersonalizationBoost', () => {
        it('should return 0 for no user', () => {
            const boost = ReelAlgo.getPersonalizationBoost(null, 'author123', null, null);
            expect(boost).toBe(0);
        });

        it('should return 0 for no author', () => {
            const boost = ReelAlgo.getPersonalizationBoost('user123', null, null, null);
            expect(boost).toBe(0);
        });

        it('should return affinity-based boost from cache', () => {
            const affinityCache = new Map([['author123', 10]]);
            const boost = ReelAlgo.getPersonalizationBoost('user', 'author123', affinityCache, new Set());
            expect(boost).toBeGreaterThan(0);
        });

        it('should multiply by follow boost when following', () => {
            const affinityCache = new Map([['author123', 10]]);
            const followingSet = new Set(['author123']);

            const boostWithFollow = ReelAlgo.getPersonalizationBoost('user', 'author123', affinityCache, followingSet);
            const boostWithoutFollow = ReelAlgo.getPersonalizationBoost('user', 'author123', affinityCache, new Set());

            expect(boostWithFollow).toBeGreaterThan(boostWithoutFollow);
        });
    });

    describe('getCreatorScore', () => {
        it('should return 0 for null author', () => {
            const score = ReelAlgo.getCreatorScore(null);
            expect(score).toBe(0);
        });

        it('should give boost for verified creators', () => {
            const verified = { isVerified: true };
            const unverified = { isVerified: false };

            const verifiedScore = ReelAlgo.getCreatorScore(verified);
            const unverifiedScore = ReelAlgo.getCreatorScore(unverified);

            expect(verifiedScore).toBeGreaterThan(unverifiedScore);
        });

        it('should give logarithmic boost for follower count', () => {
            const smallCreator = { stats: { followers: 100 } };
            const bigCreator = { stats: { followers: 1000000 } };

            const smallScore = ReelAlgo.getCreatorScore(smallCreator);
            const bigScore = ReelAlgo.getCreatorScore(bigCreator);

            // Big creator should score higher but not 10000x higher
            expect(bigScore).toBeGreaterThan(smallScore);
            expect(bigScore / smallScore).toBeLessThan(10);
        });
    });

    describe('rankReels', () => {
        it('should return empty array for empty input', async () => {
            const result = await ReelAlgo.rankReels([], 'user123');
            expect(result).toEqual([]);
        });

        it('should sort reels by score descending', async () => {
            const reels = [
                { _id: '1', stats: { likes: 10 }, createdAt: new Date(), user: 'a' },
                { _id: '2', stats: { likes: 100 }, createdAt: new Date(), user: 'b' },
                { _id: '3', stats: { likes: 50 }, createdAt: new Date(), user: 'c' }
            ];

            const ranked = await ReelAlgo.rankReels(reels, null, { includeVelocity: false });

            expect(ranked[0]._id).toBe('2'); // Highest engagement first
            expect(ranked[1]._id).toBe('3');
            expect(ranked[2]._id).toBe('1');
        });

        it('should add _score property to each reel', async () => {
            const reels = [
                { _id: '1', stats: { likes: 10 }, createdAt: new Date(), user: 'a' }
            ];

            const ranked = await ReelAlgo.rankReels(reels, null, { includeVelocity: false });

            expect(ranked[0]).toHaveProperty('_score');
            expect(typeof ranked[0]._score).toBe('number');
        });
    });

    describe('injectDiversity', () => {
        it('should return original array if too small', () => {
            const reels = [{ _id: '1' }, { _id: '2' }];
            const result = ReelAlgo.injectDiversity(reels, []);
            expect(result).toEqual(reels);
        });

        it('should inject items after top 3', () => {
            const ranked = Array(10).fill(null).map((_, i) => ({ _id: `r${i}` }));
            const all = [...ranked, { _id: 'diversity1' }, { _id: 'diversity2' }];

            const result = ReelAlgo.injectDiversity(ranked, all);

            // Top 3 should remain in place
            expect(result[0]._id).toBe('r0');
            expect(result[1]._id).toBe('r1');
            expect(result[2]._id).toBe('r2');
        });
    });
});
