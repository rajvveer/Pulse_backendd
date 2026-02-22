/**
 * CommentsAlgo.test.js - Unit tests for Comment Ranking Algorithm v2.0
 */

const CommentsAlgo = require('../../src/Algorithms/CommentsAlgo');

describe('CommentsAlgo', () => {

    describe('calculateCommentQuality', () => {
        it('should return 0 for empty comment', () => {
            const comment = { content: '', likes: [], replies: [] };
            expect(CommentsAlgo.calculateCommentQuality(comment)).toBe(0);
        });

        it('should score based on likes', () => {
            const comment = { content: 'test comment', likes: [1, 2, 3], replies: [] };
            const score = CommentsAlgo.calculateCommentQuality(comment);
            expect(score).toBeGreaterThan(0);
        });

        it('should weight replies higher than likes', () => {
            const likesComment = { content: 'test', likes: [1, 2, 3], replies: [] };
            const repliesComment = { content: 'test', likes: [], replies: [1, 2, 3] };
            expect(CommentsAlgo.calculateCommentQuality(repliesComment))
                .toBeGreaterThan(CommentsAlgo.calculateCommentQuality(likesComment));
        });

        it('should give length bonus for thoughtful comments', () => {
            const short = { content: 'ok', likes: [], replies: [] };
            const long = { content: 'This is a much more thoughtful and detailed response that adds value to the discussion', likes: [], replies: [] };
            expect(CommentsAlgo.calculateCommentQuality(long))
                .toBeGreaterThan(CommentsAlgo.calculateCommentQuality(short));
        });

        it('should boost OP comments', () => {
            const comment = { content: 'test comment here', likes: [], replies: [], author: { _id: 'a1' } };
            expect(CommentsAlgo.calculateCommentQuality(comment, { isOP: true }))
                .toBeGreaterThan(CommentsAlgo.calculateCommentQuality(comment, { isOP: false }));
        });

        it('should boost verified authors', () => {
            const unverified = { content: 'test comment', likes: [], replies: [], author: { isVerified: false } };
            const verified = { content: 'test comment', likes: [], replies: [], author: { isVerified: true } };
            expect(CommentsAlgo.calculateCommentQuality(verified))
                .toBeGreaterThan(CommentsAlgo.calculateCommentQuality(unverified));
        });
    });

    describe('Wilson score (v2.0)', () => {
        it('should export wilsonScore function', () => {
            expect(typeof CommentsAlgo.wilsonScore).toBe('function');
        });

        it('should return 0 for no total', () => {
            expect(CommentsAlgo.wilsonScore(0, 0)).toBe(0);
        });

        it('should rank 5/5 higher than 1/1 due to sample size', () => {
            const big = CommentsAlgo.wilsonScore(5, 5);
            const small = CommentsAlgo.wilsonScore(1, 1);
            expect(big).toBeGreaterThan(small);
        });
    });

    describe('applyTimeDecay', () => {
        it('should halve score at half-life', () => {
            const halfLifeAgo = new Date(Date.now() - CommentsAlgo.CONFIG.HALF_LIFE_HOURS * 3600000);
            expect(CommentsAlgo.applyTimeDecay(100, halfLifeAgo)).toBeCloseTo(50, 1);
        });
    });

    describe('calculateControversy', () => {
        it('should return 0 for low engagement', () => {
            expect(CommentsAlgo.calculateControversy({ likes: [1], replies: [] })).toBe(0);
        });

        it('should return higher for many replies relative to likes', () => {
            const normal = CommentsAlgo.calculateControversy({ likes: [1, 2, 3, 4, 5], replies: [1] });
            const controversial = CommentsAlgo.calculateControversy({ likes: [1, 2], replies: [1, 2, 3, 4, 5] });
            expect(controversial).toBeGreaterThan(normal);
        });
    });

    describe('isSpammy', () => {
        it('should detect spam with multiple signals', () => {
            // v2.0 requires 3+ spam signals
            expect(CommentsAlgo.isSpammy({ content: 'FOLLOW ME NOW!!!! Check http://spam.com http://spam2.com http://spam3.com #spam #spam #spam #follow #me #now' })).toBe(true);
        });

        it('should not flag normal comments', () => {
            expect(CommentsAlgo.isSpammy({ content: 'Really enjoyed this video, thanks for sharing!' })).toBe(false);
        });
    });

    describe('detectToxicity (v2.0)', () => {
        it('should export detectToxicity function', () => {
            expect(typeof CommentsAlgo.detectToxicity).toBe('function');
        });
    });

    describe('rankComments', () => {
        it('should return empty array for empty input', async () => {
            expect(await CommentsAlgo.rankComments([])).toEqual([]);
        });

        it('should sort by score descending for TOP mode', async () => {
            const comments = [
                { _id: '1', content: 'ok', likes: [], replies: [], createdAt: new Date() },
                { _id: '2', content: 'great!', likes: [1, 2, 3, 4, 5], replies: [], createdAt: new Date() },
                { _id: '3', content: 'good', likes: [1, 2], replies: [], createdAt: new Date() }
            ];
            const ranked = await CommentsAlgo.rankComments(comments, { mode: 'top' });
            expect(ranked[0]._id).toBe('2');
        });

        it('should sort by timestamp for NEW mode', async () => {
            const now = Date.now();
            const comments = [
                { _id: '1', content: 'old', likes: [1, 2, 3, 4, 5], createdAt: new Date(now - 60000) },
                { _id: '2', content: 'new', likes: [], createdAt: new Date(now) }
            ];
            const ranked = await CommentsAlgo.rankComments(comments, { mode: 'new' });
            expect(ranked[0]._id).toBe('2');
        });
    });

    describe('filterLowQuality', () => {
        it('should remove spammy comments', () => {
            const comments = [
                { content: 'Good video!', _score: 5 },
                { content: 'FOLLOW ME NOW!!!! http://spam.com http://spam2.com http://spam3.com #spam #spam #spam #follow #me #now', _score: 10 }
            ];
            const filtered = CommentsAlgo.filterLowQuality(comments);
            expect(filtered.length).toBe(1);
            expect(filtered[0].content).toBe('Good video!');
        });
    });

    describe('flattenThread', () => {
        it('should add depth property', () => {
            const comments = [{ _id: '1', replies: [{ _id: 'r1', replies: [] }] }];
            const flat = CommentsAlgo.flattenThread(comments);
            expect(flat[0]._depth).toBe(0);
            expect(flat[1]._depth).toBe(1);
        });

        it('should respect maxItems limit', () => {
            const comments = Array(20).fill(null).map((_, i) => ({ _id: `c${i}`, replies: [] }));
            expect(CommentsAlgo.flattenThread(comments, 10).length).toBe(10);
        });
    });
});
