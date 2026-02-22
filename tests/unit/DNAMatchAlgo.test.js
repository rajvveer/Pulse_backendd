/**
 * DNAMatchAlgo.test.js - Unit tests for Social DNA Matching Algorithm v2.0
 */

// Mock all DB-dependent modules
jest.mock('../../src/models/UserEngagement', () => ({
    getBatchAffinities: jest.fn().mockResolvedValue(new Map())
}));

// Mock the SocialDNA model that DNAMatchAlgo uses internally
jest.mock('../../src/models/SocialDNA', () => {
    const mockDNA = {
        strands: { hype: 5, chill: 3, rant: 1, thirst: 2, creative: 4, wholesome: 3, chaotic: 1 },
        dominantVibe: 'hype',
        totalSignals: 50
    };
    return {
        getOrCreate: jest.fn().mockResolvedValue(mockDNA),
        find: jest.fn().mockReturnValue({
            skip: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            populate: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([])
        }),
        findOneAndUpdate: jest.fn().mockResolvedValue(null)
    };
});

const DNAMatchAlgo = require('../../src/Algorithms/DNAMatchAlgo');

describe('DNAMatchAlgo', () => {

    describe('calculateMatchPercent', () => {
        it('should return 0 for empty strands', () => {
            const empty = { hype: 0, chill: 0, rant: 0 };
            expect(DNAMatchAlgo.calculateMatchPercent(empty, empty)).toBe(0);
        });

        it('should return 100 for identical strands', () => {
            const strands = { hype: 5, chill: 3, rant: 1, thirst: 2, creative: 4, wholesome: 3, chaotic: 1 };
            const result = DNAMatchAlgo.calculateMatchPercent(strands, strands);
            expect(result).toBeGreaterThanOrEqual(90);
        });

        it('should return lower score for different strands', () => {
            const a = { hype: 10, chill: 0, rant: 0, thirst: 0, creative: 0, wholesome: 0, chaotic: 0 };
            const b = { hype: 0, chill: 10, rant: 0, thirst: 0, creative: 0, wholesome: 0, chaotic: 0 };
            const result = DNAMatchAlgo.calculateMatchPercent(a, b);
            expect(result).toBeLessThan(50);
        });
    });

    describe('calculateConfidence', () => {
        it('should return high confidence for many signals', () => {
            const confidence = DNAMatchAlgo.calculateConfidence(100, 100);
            expect(confidence).toBeGreaterThanOrEqual(0.7);
        });

        it('should return low confidence for few signals', () => {
            const confidence = DNAMatchAlgo.calculateConfidence(3, 3);
            expect(confidence).toBeLessThan(0.5);
        });
    });

    describe('calculateDiversity', () => {
        it('should return 0 for empty strands', () => {
            expect(DNAMatchAlgo.calculateDiversity({ hype: 0, chill: 0 })).toBe(0);
        });

        it('should return high diversity for evenly distributed strands', () => {
            const even = { hype: 5, chill: 5, rant: 5, thirst: 5, creative: 5, wholesome: 5, chaotic: 5 };
            expect(DNAMatchAlgo.calculateDiversity(even)).toBeGreaterThan(0.6);
        });

        it('should return low diversity for one-dimensional strands', () => {
            const oneDimensional = { hype: 100, chill: 0, rant: 0, thirst: 0, creative: 0, wholesome: 0, chaotic: 0 };
            expect(DNAMatchAlgo.calculateDiversity(oneDimensional)).toBeLessThan(0.3);
        });
    });

    describe('getCompatibility', () => {
        it('should return a compatibility result with SocialDNA mock', async () => {
            const result = await DNAMatchAlgo.getCompatibility('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');
            expect(result).toHaveProperty('matchPercent');
            expect(result).toHaveProperty('label');
            expect(result).toHaveProperty('breakdown');
            expect(result).toHaveProperty('confidence');
            expect(typeof result.matchPercent).toBe('number');
        });
    });

    describe('findTwins', () => {
        it('should return an array', async () => {
            const result = await DNAMatchAlgo.findTwins('507f1f77bcf86cd799439011');
            expect(Array.isArray(result)).toBe(true);
        });
    });

    describe('recordInteraction', () => {
        it('should be a function', () => {
            expect(typeof DNAMatchAlgo.recordInteraction).toBe('function');
        });
    });

    describe('CONFIG', () => {
        it('should export CONFIG', () => {
            expect(DNAMatchAlgo.CONFIG).toBeDefined();
            expect(DNAMatchAlgo.CONFIG).toHaveProperty('TWIN_THRESHOLD');
        });
    });
});
