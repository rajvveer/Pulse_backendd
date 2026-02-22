/**
 * ReelAlgo.test.js - Unit tests for Reel Feed Ranking Algorithm v2.0
 */

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
            expect(ReelAlgo.calculateEngagementScore({ stats: {}, likes: [], commentsCount: 0 })).toBe(0);
        });

        it('should calculate weighted score for likes', () => {
            expect(ReelAlgo.calculateEngagementScore({ stats: { likes: 100 } }))
                .toBe(100 * ReelAlgo.CONFIG.WEIGHTS.likes);
        });

        it('should weight comments higher than likes', () => {
            expect(ReelAlgo.calculateEngagementScore({ stats: { comments: 10 } }))
                .toBeGreaterThan(ReelAlgo.calculateEngagementScore({ stats: { likes: 10 } }));
        });

        it('should weight shares highest', () => {
            expect(ReelAlgo.calculateEngagementScore({ stats: { shares: 10 } }))
                .toBeGreaterThan(ReelAlgo.calculateEngagementScore({ stats: { comments: 10 } }));
        });

        it('should handle legacy likes array', () => {
            expect(ReelAlgo.calculateEngagementScore({ likes: [1, 2, 3, 4, 5], stats: {} }))
                .toBe(5 * ReelAlgo.CONFIG.WEIGHTS.likes);
        });

        it('should bonus excellent watch completion (v2.0)', () => {
            const highCompletion = { stats: { avgWatchPercentage: 0.9, likes: 10 } };
            const lowCompletion = { stats: { avgWatchPercentage: 0.1, likes: 10 } };
            expect(ReelAlgo.calculateEngagementScore(highCompletion))
                .toBeGreaterThan(ReelAlgo.calculateEngagementScore(lowCompletion));
        });

        it('should bonus re-watched reels (v2.0)', () => {
            const rewatched = { stats: { likes: 10, avgLoops: 2.5 } };
            const normal = { stats: { likes: 10, avgLoops: 0 } };
            expect(ReelAlgo.calculateEngagementScore(rewatched))
                .toBeGreaterThan(ReelAlgo.calculateEngagementScore(normal));
        });
    });

    describe('applyTimeDecay', () => {
        it('should return full score for new content', () => {
            expect(ReelAlgo.applyTimeDecay(100, new Date())).toBeCloseTo(100, 1);
        });
        it('should halve score at half-life', () => {
            const halfLifeAgo = new Date(Date.now() - ReelAlgo.CONFIG.HALF_LIFE_HOURS * 3600000);
            expect(ReelAlgo.applyTimeDecay(100, halfLifeAgo)).toBeCloseTo(50, 1);
        });
        it('should quarter score at 2x half-life', () => {
            const twoHL = new Date(Date.now() - 2 * ReelAlgo.CONFIG.HALF_LIFE_HOURS * 3600000);
            expect(ReelAlgo.applyTimeDecay(100, twoHL)).toBeCloseTo(25, 1);
        });
        it('should return minimal score for very old content', () => {
            const veryOld = new Date(Date.now() - 10 * 24 * 3600000);
            expect(ReelAlgo.applyTimeDecay(100, veryOld)).toBeLessThan(5);
        });
    });

    describe('getFreshnessBoost', () => {
        it('should give 2x boost for <1h old', () => {
            expect(ReelAlgo.getFreshnessBoost(new Date())).toBe(2.0);
        });
        it('should give 1.5x boost for 2h old', () => {
            expect(ReelAlgo.getFreshnessBoost(new Date(Date.now() - 2 * 3600000))).toBe(1.5);
        });
        it('should give no boost for >24h old', () => {
            expect(ReelAlgo.getFreshnessBoost(new Date(Date.now() - 48 * 3600000))).toBe(1.0);
        });
    });

    describe('getPersonalizationBoost', () => {
        it('should return 0 for no user', () => {
            expect(ReelAlgo.getPersonalizationBoost(null, 'a', null, null)).toBe(0);
        });
        it('should return 0 for no author', () => {
            expect(ReelAlgo.getPersonalizationBoost('u', null, null, null)).toBe(0);
        });
        it('should return affinity-based boost', () => {
            expect(ReelAlgo.getPersonalizationBoost('u', 'a', new Map([['a', 10]]), new Set())).toBeGreaterThan(0);
        });
        it('should multiply by follow boost', () => {
            const withFollow = ReelAlgo.getPersonalizationBoost('u', 'a', new Map([['a', 10]]), new Set(['a']));
            const without = ReelAlgo.getPersonalizationBoost('u', 'a', new Map([['a', 10]]), new Set());
            expect(withFollow).toBeGreaterThan(without);
        });
    });

    describe('getCreatorScore', () => {
        it('should return 0 for null', () => {
            expect(ReelAlgo.getCreatorScore(null)).toBe(0);
        });
        it('should boost verified', () => {
            expect(ReelAlgo.getCreatorScore({ isVerified: true }))
                .toBeGreaterThan(ReelAlgo.getCreatorScore({ isVerified: false }));
        });
    });

    describe('getAudioBoost (v2.0)', () => {
        it('should return 0 for no audio', () => {
            expect(ReelAlgo.getAudioBoost({}, {})).toBe(0);
        });
        it('should boost trending audio', () => {
            expect(ReelAlgo.getAudioBoost({ audio: { id: 'a1', isTrending: true } }, {})).toBeGreaterThan(0);
        });
    });

    describe('getCreatorColdStartBoost (v2.0)', () => {
        it('should return 0 for null', () => {
            expect(ReelAlgo.getCreatorColdStartBoost(null)).toBe(0);
        });
        it('should boost new creators with quality', () => {
            expect(ReelAlgo.getCreatorColdStartBoost({ stats: { posts: 2, engagementRate: 0.5 } })).toBeGreaterThan(0);
        });
        it('should not boost established creators', () => {
            expect(ReelAlgo.getCreatorColdStartBoost({ stats: { posts: 100 } })).toBe(0);
        });
    });

    describe('enforceCategoryDiversity (v2.0)', () => {
        it('should prevent 3+ same-category in a row', () => {
            const reels = [
                { category: 'dance' }, { category: 'dance' }, { category: 'dance' },
                { category: 'comedy' }
            ];
            const result = ReelAlgo.enforceCategoryDiversity(reels);
            const cats = result.map(r => r.category);
            for (let i = 2; i < cats.length; i++) {
                if (cats[i] === cats[i - 1] && cats[i] === cats[i - 2]) {
                    fail('Three consecutive same-category reels found');
                }
            }
        });
    });

    describe('rankReels', () => {
        it('should return empty for empty input', async () => {
            expect(await ReelAlgo.rankReels([], 'u')).toEqual([]);
        });
        it('should sort by score descending', async () => {
            const reels = [
                { _id: '1', stats: { likes: 10 }, createdAt: new Date(), user: 'a' },
                { _id: '2', stats: { likes: 100 }, createdAt: new Date(), user: 'b' },
                { _id: '3', stats: { likes: 50 }, createdAt: new Date(), user: 'c' }
            ];
            const ranked = await ReelAlgo.rankReels(reels, null, { includeVelocity: false });
            expect(ranked[0]._id).toBe('2');
        });
        it('should add _score property', async () => {
            const ranked = await ReelAlgo.rankReels(
                [{ _id: '1', stats: { likes: 10 }, createdAt: new Date(), user: 'a' }],
                null, { includeVelocity: false }
            );
            expect(ranked[0]).toHaveProperty('_score');
        });
    });

    describe('injectDiversity', () => {
        it('should return original for empty allReels', () => {
            expect(ReelAlgo.injectDiversity([{ _id: '1' }], [])).toEqual([{ _id: '1' }]);
        });
    });
});
