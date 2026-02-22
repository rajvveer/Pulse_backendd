/**
 * UserAlgo.test.js - Unit tests for User Relevance Algorithm v2.0
 */

jest.mock('../../src/models/UserEngagement', () => ({
    getAffinity: jest.fn().mockResolvedValue(0),
    getBatchAffinities: jest.fn().mockResolvedValue(new Map())
}));

const UserAlgo = require('../../src/Algorithms/UserAlgo');

describe('UserAlgo', () => {

    describe('calculateCreatorScore', () => {
        it('should return 0 for null user', () => {
            expect(UserAlgo.calculateCreatorScore(null)).toBe(0);
        });

        it('should return 0 for user with no stats', () => {
            expect(UserAlgo.calculateCreatorScore({})).toBe(0);
        });

        it('should give logarithmic boost for followers', () => {
            const small = UserAlgo.calculateCreatorScore({ stats: { followers: 100 } });
            const medium = UserAlgo.calculateCreatorScore({ stats: { followers: 10000 } });
            const large = UserAlgo.calculateCreatorScore({ stats: { followers: 1000000 } });
            expect(medium).toBeGreaterThan(small);
            expect(large).toBeGreaterThan(medium);
            expect(large / small).toBeLessThan(100);
        });

        it('should boost verified creators', () => {
            const u = { stats: { followers: 1000 }, isVerified: false };
            const v = { stats: { followers: 1000 }, isVerified: true };
            expect(UserAlgo.calculateCreatorScore(v)).toBeGreaterThan(UserAlgo.calculateCreatorScore(u));
        });

        it('should factor in content quality', () => {
            const low = { stats: { posts: 100, totalLikes: 100 } };
            const high = { stats: { posts: 100, totalLikes: 10000 } };
            expect(UserAlgo.calculateCreatorScore(high)).toBeGreaterThan(UserAlgo.calculateCreatorScore(low));
        });

        it('should reward consistency', () => {
            const inconsistent = { stats: { postsPerWeek: 0 } };
            const consistent = { stats: { postsPerWeek: 5 } };
            expect(UserAlgo.calculateCreatorScore(consistent)).toBeGreaterThan(UserAlgo.calculateCreatorScore(inconsistent));
        });
    });

    describe('calculateEngagementRate', () => {
        it('should return 0 for no followers', () => {
            expect(UserAlgo.calculateEngagementRate({ stats: { followers: 0 } })).toBe(0);
        });

        it('should calculate rate based on recent engagement', () => {
            const user = { stats: { followers: 1000, recentLikes: 100, recentComments: 50, recentPosts: 10 } };
            expect(UserAlgo.calculateEngagementRate(user)).toBeGreaterThan(0);
        });

        it('should handle the fixed operator precedence correctly', () => {
            const user = { stats: { followers: 1000, recentLikes: 0, recentComments: 10, recentPosts: 1 } };
            const rate = UserAlgo.calculateEngagementRate(user);
            // Comments should contribute: 10 * 2 = 20, / 1 post / 1000 followers = 0.02
            expect(rate).toBe(0.02);
        });
    });

    describe('isNicheCreator (v2.0)', () => {
        it('should identify niche creators', () => {
            const niche = { stats: { followers: 500, recentLikes: 100, recentComments: 50, recentPosts: 5 } };
            expect(UserAlgo.isNicheCreator(niche)).toBe(true);
        });

        it('should not flag large creators as niche', () => {
            const big = { stats: { followers: 100000, recentLikes: 100, recentComments: 50, recentPosts: 5 } };
            expect(UserAlgo.isNicheCreator(big)).toBe(false);
        });
    });

    describe('calculateContentSimilarity', () => {
        it('should return 0 for users with no interests', () => {
            expect(UserAlgo.calculateContentSimilarity({}, {})).toBe(0);
        });

        it('should return 1 for identical interests', () => {
            const user = { interests: ['music', 'art', 'travel'] };
            expect(UserAlgo.calculateContentSimilarity(user, user)).toBe(1);
        });

        it('should return 0 for no overlap', () => {
            expect(UserAlgo.calculateContentSimilarity(
                { interests: ['music', 'art'] },
                { interests: ['sports', 'gaming'] }
            )).toBe(0);
        });

        it('should return partial for partial overlap', () => {
            const sim = UserAlgo.calculateContentSimilarity(
                { interests: ['music', 'art', 'travel'] },
                { interests: ['music', 'sports'] }
            );
            expect(sim).toBeGreaterThan(0);
            expect(sim).toBeLessThan(1);
        });

        it('should add vibe bonus for matching vibes (v2.0)', () => {
            const sim1 = UserAlgo.calculateContentSimilarity(
                { interests: ['music'], dominantVibe: 'chill' },
                { interests: ['music'], dominantVibe: 'chill' }
            );
            const sim2 = UserAlgo.calculateContentSimilarity(
                { interests: ['music'], dominantVibe: 'chill' },
                { interests: ['music'], dominantVibe: 'hype' }
            );
            expect(sim1).toBeGreaterThan(sim2);
        });
    });

    describe('calculateGraphProximity (v2.0)', () => {
        it('should score candidates followed by mutual connections', () => {
            const scores = UserAlgo.calculateGraphProximity(
                'me', [{ _id: 'candidate1' }],
                ['friend1', 'friend2'],
                { friend1: ['candidate1'], friend2: ['candidate1'] }
            );
            expect(scores.get('candidate1')).toBeGreaterThan(0);
        });

        it('should exclude self and already following', () => {
            const scores = UserAlgo.calculateGraphProximity(
                'me', [{ _id: 'me' }, { _id: 'friend1' }],
                ['friend1'], {}
            );
            expect(scores.size).toBe(0);
        });
    });

    describe('getSuggestedUsers', () => {
        it('should return empty for empty candidates', async () => {
            expect(await UserAlgo.getSuggestedUsers('u1', [])).toEqual([]);
        });

        it('should exclude self from suggestions', async () => {
            const result = await UserAlgo.getSuggestedUsers('u1', [{ _id: 'u1' }, { _id: 'u2' }]);
            expect(result.find(u => u._id === 'u1')).toBeUndefined();
        });

        it('should exclude already following', async () => {
            const result = await UserAlgo.getSuggestedUsers('u1', [{ _id: 'u2' }, { _id: 'u3' }], { followingIds: ['u2'] });
            expect(result.find(u => u._id === 'u2')).toBeUndefined();
        });

        it('should add _recommendScore', async () => {
            const result = await UserAlgo.getSuggestedUsers('u1', [{ _id: 'u2', stats: { followers: 1000 } }]);
            expect(result[0]).toHaveProperty('_recommendScore');
        });

        it('should respect limit', async () => {
            const candidates = Array(50).fill(null).map((_, i) => ({ _id: `u${i}`, stats: { followers: i * 100 } }));
            const result = await UserAlgo.getSuggestedUsers('u1', candidates, { limit: 10 });
            expect(result.length).toBe(10);
        });
    });

    describe('getSimilarUsers', () => {
        it('should exclude target user', async () => {
            const target = { _id: 't', interests: ['music'] };
            const result = await UserAlgo.getSimilarUsers(target, [{ _id: 't', interests: ['music'] }, { _id: 'o', interests: ['music'] }]);
            expect(result.find(u => u._id === 't')).toBeUndefined();
        });

        it('should rank by similarity', async () => {
            const target = { _id: 't', interests: ['music', 'art'] };
            const result = await UserAlgo.getSimilarUsers(target, [
                { _id: 'sim', interests: ['music', 'art'] },
                { _id: 'diff', interests: ['sports'] }
            ]);
            expect(result[0]._id).toBe('sim');
        });
    });

    describe('getTrendingCreators', () => {
        it('should filter by minimum followers', () => {
            const users = [{ _id: 's', stats: { followers: 50 } }, { _id: 'b', stats: { followers: 5000 } }];
            const trending = UserAlgo.getTrendingCreators(users, { minFollowers: 100 });
            expect(trending.length).toBe(1);
            expect(trending[0]._id).toBe('b');
        });

        it('should add _trendScore', () => {
            const trending = UserAlgo.getTrendingCreators([{ _id: 'u1', stats: { followers: 1000, followerGrowthRate: 0.1 } }]);
            expect(trending[0]).toHaveProperty('_trendScore');
        });

        it('should respect limit', () => {
            const users = Array(50).fill(null).map((_, i) => ({ _id: `u${i}`, stats: { followers: 1000 + i } }));
            expect(UserAlgo.getTrendingCreators(users, { limit: 5 }).length).toBe(5);
        });
    });

    describe('injectDiversity', () => {
        it('should return original if small list', () => {
            const users = [{ _id: 'u1' }, { _id: 'u2' }];
            expect(UserAlgo.injectDiversity(users, 10)).toEqual(users);
        });
    });
});
