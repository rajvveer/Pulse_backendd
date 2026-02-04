/**
 * CommentsAlgo.test.js - Unit tests for Comment Ranking Algorithm
 */

const CommentsAlgo = require('../../src/Algorithms/CommentsAlgo');

describe('CommentsAlgo', () => {

    describe('calculateCommentQuality', () => {
        it('should return 0 for empty comment', () => {
            const comment = { content: '', likes: [], replies: [] };
            const score = CommentsAlgo.calculateCommentQuality(comment);
            expect(score).toBe(0);
        });

        it('should score based on likes', () => {
            const comment = { content: 'test', likes: [1, 2, 3], replies: [] };
            const score = CommentsAlgo.calculateCommentQuality(comment);
            expect(score).toBe(3 * CommentsAlgo.CONFIG.WEIGHTS.likes);
        });

        it('should weight replies higher than likes', () => {
            const likesComment = { content: 'test', likes: [1, 2, 3], replies: [] };
            const repliesComment = { content: 'test', likes: [], replies: [1, 2, 3] };

            const likesScore = CommentsAlgo.calculateCommentQuality(likesComment);
            const repliesScore = CommentsAlgo.calculateCommentQuality(repliesComment);

            expect(repliesScore).toBeGreaterThan(likesScore);
        });

        it('should give length bonus for thoughtful comments', () => {
            const shortComment = { content: 'ok', likes: [], replies: [] };
            const longComment = { content: 'This is a much more thoughtful and detailed response that adds value', likes: [], replies: [] };

            const shortScore = CommentsAlgo.calculateCommentQuality(shortComment);
            const longScore = CommentsAlgo.calculateCommentQuality(longComment);

            expect(longScore).toBeGreaterThan(shortScore);
        });

        it('should boost OP comments', () => {
            const comment = { content: 'test comment here', likes: [], replies: [], author: { _id: 'author1' } };

            const normalScore = CommentsAlgo.calculateCommentQuality(comment, { isOP: false });
            const opScore = CommentsAlgo.calculateCommentQuality(comment, { isOP: true });

            expect(opScore).toBeGreaterThan(normalScore);
        });

        it('should boost verified authors', () => {
            const unverified = { content: 'test comment', likes: [], replies: [], author: { isVerified: false } };
            const verified = { content: 'test comment', likes: [], replies: [], author: { isVerified: true } };

            const unverifiedScore = CommentsAlgo.calculateCommentQuality(unverified);
            const verifiedScore = CommentsAlgo.calculateCommentQuality(verified);

            expect(verifiedScore).toBeGreaterThan(unverifiedScore);
        });
    });

    describe('applyTimeDecay', () => {
        it('should decay comments faster than content (6hr half-life)', () => {
            expect(CommentsAlgo.CONFIG.HALF_LIFE_HOURS).toBeLessThan(12);
        });

        it('should halve score at half-life', () => {
            const score = 100;
            const halfLifeAgo = new Date(Date.now() - CommentsAlgo.CONFIG.HALF_LIFE_HOURS * 60 * 60 * 1000);
            const decayed = CommentsAlgo.applyTimeDecay(score, halfLifeAgo);
            expect(decayed).toBeCloseTo(50, 1);
        });
    });

    describe('calculateControversy', () => {
        it('should return 0 for low engagement', () => {
            const comment = { likes: [1], replies: [] };
            const score = CommentsAlgo.calculateControversy(comment);
            expect(score).toBe(0);
        });

        it('should return higher score for many replies relative to likes', () => {
            const normalComment = { likes: [1, 2, 3, 4, 5], replies: [1] };
            const controversialComment = { likes: [1, 2], replies: [1, 2, 3, 4, 5] };

            const normalScore = CommentsAlgo.calculateControversy(normalComment);
            const controversialScore = CommentsAlgo.calculateControversy(controversialComment);

            expect(controversialScore).toBeGreaterThan(normalScore);
        });
    });

    describe('rankComments', () => {
        it('should return empty array for empty input', async () => {
            const result = await CommentsAlgo.rankComments([]);
            expect(result).toEqual([]);
        });

        it('should sort by score descending for TOP mode', async () => {
            const comments = [
                { _id: '1', content: 'ok', likes: [], replies: [], createdAt: new Date() },
                { _id: '2', content: 'great comment!', likes: [1, 2, 3, 4, 5], replies: [], createdAt: new Date() },
                { _id: '3', content: 'good', likes: [1, 2], replies: [], createdAt: new Date() }
            ];

            const ranked = await CommentsAlgo.rankComments(comments, { mode: 'top' });

            expect(ranked[0]._id).toBe('2');
            expect(ranked[2]._id).toBe('1');
        });

        it('should sort by timestamp for NEW mode', async () => {
            const now = Date.now();
            const comments = [
                { _id: '1', content: 'old', likes: [1, 2, 3, 4, 5], createdAt: new Date(now - 60000) },
                { _id: '2', content: 'new', likes: [], createdAt: new Date(now) }
            ];

            const ranked = await CommentsAlgo.rankComments(comments, { mode: 'new' });

            expect(ranked[0]._id).toBe('2'); // Newest first
        });

        it('should rank nested replies', async () => {
            const comments = [{
                _id: '1',
                content: 'parent',
                likes: [],
                replies: [
                    { _id: 'r1', content: 'reply1', likes: [1, 2, 3], replies: [], createdAt: new Date() },
                    { _id: 'r2', content: 'reply2', likes: [], replies: [], createdAt: new Date() }
                ],
                createdAt: new Date()
            }];

            const ranked = await CommentsAlgo.rankComments(comments, { mode: 'top', includeReplies: true });

            expect(ranked[0].replies[0]._id).toBe('r1'); // Higher liked reply first
        });
    });

    describe('isSpammy', () => {
        it('should detect "follow me" spam', () => {
            const comment = { content: 'Great video! Follow me for more!' };
            expect(CommentsAlgo.isSpammy(comment)).toBe(true);
        });

        it('should detect "check out" spam', () => {
            const comment = { content: 'Check out my profile for similar content' };
            expect(CommentsAlgo.isSpammy(comment)).toBe(true);
        });

        it('should detect excessive caps', () => {
            const comment = { content: 'THIS IS ALL CAPS SPAM!!!' };
            expect(CommentsAlgo.isSpammy(comment)).toBe(true);
        });

        it('should detect character repetition', () => {
            const comment = { content: 'sooooooo good!!!!!' };
            expect(CommentsAlgo.isSpammy(comment)).toBe(true);
        });

        it('should not flag normal comments', () => {
            const comment = { content: 'Really enjoyed this video, thanks for sharing!' };
            expect(CommentsAlgo.isSpammy(comment)).toBe(false);
        });
    });

    describe('filterLowQuality', () => {
        it('should remove spammy comments', () => {
            const comments = [
                { content: 'Good video!', _score: 5 },
                { content: 'Follow me!!', _score: 10 }
            ];

            const filtered = CommentsAlgo.filterLowQuality(comments);

            expect(filtered.length).toBe(1);
            expect(filtered[0].content).toBe('Good video!');
        });

        it('should remove low score comments when threshold set', () => {
            const comments = [
                { content: 'Great', _score: 10 },
                { content: 'Ok', _score: 1 }
            ];

            const filtered = CommentsAlgo.filterLowQuality(comments, 5);

            expect(filtered.length).toBe(1);
            expect(filtered[0]._score).toBe(10);
        });
    });

    describe('flattenThread', () => {
        it('should add depth property', () => {
            const comments = [{
                _id: '1',
                replies: [{ _id: 'r1', replies: [] }]
            }];

            const flat = CommentsAlgo.flattenThread(comments);

            expect(flat[0]._depth).toBe(0);
            expect(flat[1]._depth).toBe(1);
        });

        it('should respect maxItems limit', () => {
            const comments = Array(20).fill(null).map((_, i) => ({
                _id: `c${i}`,
                replies: []
            }));

            const flat = CommentsAlgo.flattenThread(comments, 10);

            expect(flat.length).toBe(10);
        });
    });
});
