/**
 * VibeClassifier.test.js - Unit tests for Vibe Classification Algorithm v2.0
 *
 * VibeClassifier is a class with static methods:
 *   classify, classifyBatch, filterByVibe, boostByVibe
 */

const VibeClassifier = require('../../src/Algorithms/VibeClassifier');

describe('VibeClassifier', () => {

    describe('classify', () => {
        it('should return an object with vibe and confidence', () => {
            const result = VibeClassifier.classify({ content: { text: 'This is amazing!' } });
            expect(result).toHaveProperty('vibe');
            expect(result).toHaveProperty('confidence');
        });

        it('should classify hype content', () => {
            const result = VibeClassifier.classify({
                content: { text: 'LETS GOOO!!! So excited!! 🔥🔥🔥' }
            });
            expect(result.vibe).toBe('hype');
        });

        it('should classify chill content', () => {
            const result = VibeClassifier.classify({
                content: { text: 'Just relaxing at home, peaceful evening vibes 😌' }
            });
            expect(result.vibe).toBe('chill');
        });

        it('should classify angry content differently from hype', () => {
            const result = VibeClassifier.classify({
                content: { text: 'I am so frustrated with this terrible service!! This is outrageous and annoying!' }
            });
            expect(result.vibe).not.toBe('hype');
            expect(result.vibe).not.toBe('wholesome');
        });

        it('should handle empty content gracefully', () => {
            const result = VibeClassifier.classify({ content: {} });
            expect(result).toHaveProperty('vibe');
        });

        it('should handle negation (v2.0)', () => {
            const result = VibeClassifier.classify({
                content: { text: 'This is not exciting at all, not happy about this' }
            });
            expect(result.vibe).not.toBe('hype');
        });

        it('should handle emoji stacking (v2.0)', () => {
            const single = VibeClassifier.classify({ content: { text: 'cool 🔥' } });
            const stacked = VibeClassifier.classify({ content: { text: 'cool 🔥🔥🔥🔥🔥' } });
            expect(stacked.confidence).toBeGreaterThanOrEqual(single.confidence);
        });
    });

    describe('classifyBatch', () => {
        it('should classify multiple posts', () => {
            const posts = [
                { content: { text: 'This is amazing! 🔥' } },
                { content: { text: 'So peaceful and calm' } }
            ];
            const results = VibeClassifier.classifyBatch(posts);
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBe(2);
        });
    });

    describe('boostByVibe', () => {
        it('should boost posts matching the target vibe', () => {
            const posts = [
                { _score: 10, vibe: 'hype' },
                { _score: 10, vibe: 'chill' }
            ];
            const boosted = VibeClassifier.boostByVibe(posts, 'hype', 1.5);
            const hypePost = boosted.find(p => p.vibe === 'hype');
            const chillPost = boosted.find(p => p.vibe === 'chill');
            expect(hypePost._score).toBeGreaterThan(chillPost._score);
        });
    });

    describe('filterByVibe', () => {
        it('should filter posts by vibe', () => {
            const posts = [
                { vibe: 'hype', content: { text: 'hype' } },
                { vibe: 'chill', content: { text: 'chill' } }
            ];
            const filtered = VibeClassifier.filterByVibe(posts, 'hype');
            expect(filtered.every(p => p.vibe === 'hype')).toBe(true);
        });

        it('should return all posts for null vibe', () => {
            const posts = [{ vibe: 'hype' }, { vibe: 'chill' }];
            expect(VibeClassifier.filterByVibe(posts, null).length).toBe(2);
        });
    });
});
