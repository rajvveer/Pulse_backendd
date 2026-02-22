/**
 * MoodDetector.test.js - Unit tests for Mood Detection Algorithm v2.0
 *
 * MoodDetector is a class. detectMood is ASYNC.
 * Returns: { primaryMood, confidence, moodScores, momentum, energy, timestamp }
 */

const MoodDetector = require('../../src/Algorithms/MoodDetector');

describe('MoodDetector', () => {

    let detector;
    beforeEach(() => {
        detector = new MoodDetector();
    });

    describe('constructor', () => {
        it('should create a MoodDetector instance', () => {
            expect(detector).toBeInstanceOf(MoodDetector);
        });
    });

    describe('detectMood', () => {
        it('should return a mood object with primaryMood and confidence', async () => {
            const result = await detector.detectMood({ content: { text: 'This is great!' } });
            expect(result).toHaveProperty('primaryMood');
            expect(result).toHaveProperty('confidence');
            expect(result).toHaveProperty('moodScores');
            expect(result).toHaveProperty('momentum');
            expect(result).toHaveProperty('energy');
        });

        it('should detect a positive mood for upbeat text', async () => {
            const result = await detector.detectMood({
                content: { text: 'I am so happy today! Everything is wonderful and joyful! This makes me so happy!' }
            });
            expect(['happy', 'hype', 'chill', 'funny']).toContain(result.primaryMood);
            expect(result.primaryMood).not.toBe('sad');
        });

        it('should detect chill mood', async () => {
            const result = await detector.detectMood({
                content: { text: 'Just a calm peaceful evening, feeling relaxed and serene. So tranquil and mellow.' }
            });
            expect(result.primaryMood).toBe('chill');
        });

        it('should handle empty content', async () => {
            const result = await detector.detectMood({ content: {} });
            expect(result).toHaveProperty('primaryMood');
        });

        it('should handle post with no content object', async () => {
            const result = await detector.detectMood({});
            expect(result).toHaveProperty('primaryMood');
        });
    });

    describe('_calculateMomentum', () => {
        it('should be a function', () => {
            expect(typeof detector._calculateMomentum).toBe('function');
        });
    });

    describe('mood momentum (v2.0)', () => {
        it('should track mood changes across multiple calls', async () => {
            await detector.detectMood({ content: { text: 'I am happy and excited!' } });
            await detector.detectMood({ content: { text: 'Feeling sad and lonely...' } });
            const result = await detector.detectMood({ content: { text: 'Getting better now, feeling good!' } });
            expect(result).toHaveProperty('primaryMood');
            expect(result).toHaveProperty('confidence');
        });
    });
});
