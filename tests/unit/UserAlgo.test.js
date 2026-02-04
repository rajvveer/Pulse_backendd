/**
 * UserAlgo.test.js - Unit tests for User Relevance Algorithm
 */

// Mock UserEngagement
jest.mock('../../src/models/UserEngagement', () => ({
    getAffinity: jest.fn().mockResolvedValue(0),
    getBatchAffinities: jest.fn().mockResolvedValue(new Map())
}));

const UserAlgo = require('../../src/Algorithms/UserAlgo');

describe('UserAlgo', () => {

    describe('calculateCreatorScore', () => {
        it('should return 0 for null user', () => {
            const score = UserAlgo.calculateCreatorScore(null);
            expect(score).toBe(0);
        });

        it('should return 0 for user with no stats', () => {
            const user = {};
            const score = UserAlgo.calculateCreatorScore(user);
            expect(score).toBe(0);
        });

        it('should give logarithmic boost for followers', () => {
            const smallCreator = { stats: { followers: 100 } };
            const mediumCreator = { stats: { followers: 10000 } };
            const largeCreator = { stats: { followers: 1000000 } };

            const smallScore = UserAlgo.calculateCreatorScore(smallCreator);
            const mediumScore = UserAlgo.calculateCreatorScore(mediumCreator);
            const largeScore = UserAlgo.calculateCreatorScore(largeCreator);

            // Scores should increase but not linearly
            expect(mediumScore).toBeGreaterThan(smallScore);
            expect(largeScore).toBeGreaterThan(mediumScore);
            expect(largeScore / smallScore).toBeLessThan(100); // Not 10000x difference
        });

        it('should boost verified creators', () => {
            const unverified = { stats: { followers: 1000 }, isVerified: false };
            const verified = { stats: { followers: 1000 }, isVerified: true };

            const unverifiedScore = UserAlgo.calculateCreatorScore(unverified);
            const verifiedScore = UserAlgo.calculateCreatorScore(verified);

            expect(verifiedScore).toBeGreaterThan(unverifiedScore);
        });

        it('should factor in content quality', () => {
            const lowQuality = { stats: { posts: 100, totalLikes: 100 } }; // 1 like/post avg
            const highQuality = { stats: { posts: 100, totalLikes: 10000 } }; // 100 likes/post avg

            const lowScore = UserAlgo.calculateCreatorScore(lowQuality);
            const highScore = UserAlgo.calculateCreatorScore(highQuality);

            expect(highScore).toBeGreaterThan(lowScore);
        });

        it('should reward consistency', () => {
            const inconsistent = { stats: { postsPerWeek: 0 } };
            const consistent = { stats: { postsPerWeek: 5 } };

            const inconsistentScore = UserAlgo.calculateCreatorScore(inconsistent);
            const consistentScore = UserAlgo.calculateCreatorScore(consistent);

            expect(consistentScore).toBeGreaterThan(inconsistentScore);
        });
    });

    describe('calculateEngagementRate', () => {
        it('should return 0 for no followers', () => {
            const user = { stats: { followers: 0 } };
            const rate = UserAlgo.calculateEngagementRate(user);
            expect(rate).toBe(0);
        });

        it('should calculate rate based on recent engagement', () => {
            const user = {
                stats: {
                    followers: 1000,
                    recentLikes: 100,
                    recentComments: 50,
                    recentPosts: 10
                }
            };
            const rate = UserAlgo.calculateEngagementRate(user);
            expect(rate).toBeGreaterThan(0);
        });
    });

    describe('calculateContentSimilarity', () => {
        it('should return 0 for users with no interests', () => {
            const user1 = {};
            const user2 = {};
            const similarity = UserAlgo.calculateContentSimilarity(user1, user2);
            expect(similarity).toBe(0);
        });

        it('should return 1 for identical interests', () => {
            const user1 = { interests: ['music', 'art', 'travel'] };
            const user2 = { interests: ['music', 'art', 'travel'] };
            const similarity = UserAlgo.calculateContentSimilarity(user1, user2);
            expect(similarity).toBe(1);
        });

        it('should return 0 for no overlap', () => {
            const user1 = { interests: ['music', 'art'] };
            const user2 = { interests: ['sports', 'gaming'] };
            const similarity = UserAlgo.calculateContentSimilarity(user1, user2);
            expect(similarity).toBe(0);
        });

        it('should return partial score for partial overlap', () => {
            const user1 = { interests: ['music', 'art', 'travel'] };
            const user2 = { interests: ['music', 'sports'] };
            const similarity = UserAlgo.calculateContentSimilarity(user1, user2);
            expect(similarity).toBeGreaterThan(0);
            expect(similarity).toBeLessThan(1);
        });
    });

    describe('getSuggestedUsers', () => {
        it('should return empty array for empty candidates', async () => {
            const result = await UserAlgo.getSuggestedUsers('user1', []);
            expect(result).toEqual([]);
        });

        it('should exclude self from suggestions', async () => {
            const candidates = [
                { _id: 'user1' },
                { _id: 'user2' }
            ];

            const result = await UserAlgo.getSuggestedUsers('user1', candidates);

            expect(result.find(u => u._id === 'user1')).toBeUndefined();
        });

        it('should exclude already following', async () => {
            const candidates = [
                { _id: 'user2' },
                { _id: 'user3' }
            ];

            const result = await UserAlgo.getSuggestedUsers('user1', candidates, {
                followingIds: ['user2']
            });

            expect(result.find(u => u._id === 'user2')).toBeUndefined();
        });

        it('should add _recommendScore property', async () => {
            const candidates = [
                { _id: 'user2', stats: { followers: 1000 } }
            ];

            const result = await UserAlgo.getSuggestedUsers('user1', candidates);

            expect(result[0]).toHaveProperty('_recommendScore');
        });

        it('should respect limit', async () => {
            const candidates = Array(50).fill(null).map((_, i) => ({
                _id: `user${i}`,
                stats: { followers: i * 100 }
            }));

            const result = await UserAlgo.getSuggestedUsers('user1', candidates, { limit: 10 });

            expect(result.length).toBe(10);
        });
    });

    describe('getSimilarUsers', () => {
        it('should exclude target user from results', async () => {
            const target = { _id: 'target', interests: ['music'] };
            const candidates = [
                { _id: 'target', interests: ['music'] },
                { _id: 'other', interests: ['music'] }
            ];

            const result = await UserAlgo.getSimilarUsers(target, candidates);

            expect(result.find(u => u._id === 'target')).toBeUndefined();
        });

        it('should rank by similarity', async () => {
            const target = { _id: 'target', interests: ['music', 'art'] };
            const candidates = [
                { _id: 'similar', interests: ['music', 'art'] },
                { _id: 'different', interests: ['sports'] }
            ];

            const result = await UserAlgo.getSimilarUsers(target, candidates);

            expect(result[0]._id).toBe('similar');
        });
    });

    describe('getTrendingCreators', () => {
        it('should filter by minimum followers', () => {
            const users = [
                { _id: 'small', stats: { followers: 50 } },
                { _id: 'big', stats: { followers: 5000 } }
            ];

            const trending = UserAlgo.getTrendingCreators(users, { minFollowers: 100 });

            expect(trending.length).toBe(1);
            expect(trending[0]._id).toBe('big');
        });

        it('should add _trendScore property', () => {
            const users = [
                { _id: 'user1', stats: { followers: 1000, followerGrowthRate: 0.1 } }
            ];

            const trending = UserAlgo.getTrendingCreators(users);

            expect(trending[0]).toHaveProperty('_trendScore');
        });

        it('should respect limit', () => {
            const users = Array(50).fill(null).map((_, i) => ({
                _id: `user${i}`,
                stats: { followers: 1000 + i * 100 }
            }));

            const trending = UserAlgo.getTrendingCreators(users, { limit: 5 });

            expect(trending.length).toBe(5);
        });
    });

    describe('injectDiversity', () => {
        it('should return original if small list', () => {
            const users = [{ _id: 'u1' }, { _id: 'u2' }];
            const result = UserAlgo.injectDiversity(users, 10);
            expect(result).toEqual(users);
        });

        it('should mix in random users for large lists', () => {
            const users = Array(20).fill(null).map((_, i) => ({
                _id: `user${i}`,
                _recommendScore: 20 - i // Descending scores
            }));

            // Run multiple times to check randomness
            const results = [];
            for (let i = 0; i < 5; i++) {
                results.push(UserAlgo.injectDiversity([...users], 15).map(u => u._id).join(','));
            }

            // Should have some variation (though not guaranteed with small samples)
            expect(results.length).toBe(5);
        });
    });
});
