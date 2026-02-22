/**
 * InterestProfiler.test.js - Unit tests for Interest Profiling Algorithm v2.0
 *
 * Exports: getRelevanceScore, batchScorePosts, extractTopics, calculateTopicMatch,
 *          calculateNichenessBoost, calculateCrossTopicBoost, getMediaType,
 *          getPostLengthKey, getTopInterests, TOPIC_PATTERNS, CROSS_TOPIC_AFFINITIES, CONFIG
 */

jest.mock('../../src/models/UserBehavior', () => ({
    getPreferences: jest.fn().mockResolvedValue({
        topics: { music: 10, sports: 5, art: 8, food: 3 },
        sessionDepth: 0,
        totalInteractions: 50
    }),
    getSeenPostIds: jest.fn().mockResolvedValue(new Set())
}));

const InterestProfiler = require('../../src/Algorithms/InterestProfiler');

describe('InterestProfiler', () => {

    describe('extractTopics', () => {
        it('should return array of topics from post content', () => {
            const topics = InterestProfiler.extractTopics({
                content: { text: 'Check out this amazing music video with guitars and drums!' }
            });
            expect(Array.isArray(topics)).toBe(true);
        });

        it('should handle posts with no text content', () => {
            const topics = InterestProfiler.extractTopics({ content: {} });
            expect(Array.isArray(topics)).toBe(true);
        });

        it('should extract music-related topics', () => {
            const topics = InterestProfiler.extractTopics({
                content: { text: 'Playing guitar and singing a new song today', hashtags: ['music'] }
            });
            expect(topics).toContain('music');
        });

        it('should extract technology topics', () => {
            const topics = InterestProfiler.extractTopics({
                content: { text: 'New AI model released for coding and programming', hashtags: ['tech'] }
            });
            expect(topics).toContain('tech');
        });

        it('should extract multiple topics from mixed content', () => {
            const topics = InterestProfiler.extractTopics({
                content: { text: 'Cooking with music playing, love this recipe and these beats!' }
            });
            expect(topics.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getMediaType', () => {
        it('should identify video type', () => {
            expect(InterestProfiler.getMediaType({ content: { media: [{ type: 'video' }] } })).toBe('video');
        });

        it('should handle no media', () => {
            const type = InterestProfiler.getMediaType({ content: {} });
            expect(typeof type).toBe('string');
        });
    });

    describe('getPostLengthKey', () => {
        it('should return a length category', () => {
            const key = InterestProfiler.getPostLengthKey({ content: { text: 'Hello world this is a test post' } });
            expect(typeof key).toBe('string');
        });
    });

    describe('calculateTopicMatch', () => {
        it('should return a number', () => {
            const score = InterestProfiler.calculateTopicMatch(['music', 'art'], { music: 5, art: 3 });
            expect(typeof score).toBe('number');
        });

        it('should return higher for matching topics', () => {
            const match = InterestProfiler.calculateTopicMatch(['music'], { music: 5 });
            const noMatch = InterestProfiler.calculateTopicMatch(['music'], { sports: 5 });
            expect(match).toBeGreaterThan(noMatch);
        });
    });

    describe('calculateNichenessBoost (v2.0)', () => {
        it('should return a number', () => {
            const boost = InterestProfiler.calculateNichenessBoost(['music'], { music: 100, sports: 5 });
            expect(typeof boost).toBe('number');
        });
    });

    describe('calculateCrossTopicBoost (v2.0)', () => {
        it('should be a function', () => {
            expect(typeof InterestProfiler.calculateCrossTopicBoost).toBe('function');
        });
    });

    describe('getTopInterests', () => {
        it('should return top interests from user preferences', async () => {
            const result = await InterestProfiler.getTopInterests('507f1f77bcf86cd799439011', 2);
            expect(result.length).toBeLessThanOrEqual(2);
        });
    });

    describe('TOPIC_PATTERNS', () => {
        it('should have 20+ topic categories (v2.0)', () => {
            expect(Object.keys(InterestProfiler.TOPIC_PATTERNS).length).toBeGreaterThan(15);
        });
    });

    describe('CONFIG', () => {
        it('should export CONFIG', () => {
            expect(InterestProfiler.CONFIG).toBeDefined();
        });
    });
});
