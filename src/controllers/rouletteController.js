const Roulette = require('../models/Roulette');
const User = require('../models/User');
const Follow = require('../models/Follow');
const cacheService = require('../services/cacheService');

// =========================================================
//  JOIN QUEUE
// =========================================================
exports.joinQueue = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Try to find a match immediately
        const match = await Roulette.findMatch(userId);

        if (match) {
            // Found a match! Start the chat
            await match.startChat();
            const populated = await match.populate('users.user', 'username profile.displayName profile.avatar');

            return res.json({
                success: true,
                data: {
                    sessionId: match._id,
                    status: 'matched',
                    partner: populated.users.find(u => u.user._id.toString() !== userId)?.user,
                    icebreaker: match.icebreaker,
                    chatDuration: match.chatDuration
                }
            });
        }

        // No match yet — join the queue
        const session = await Roulette.joinQueue(userId);

        res.json({
            success: true,
            data: {
                sessionId: session._id,
                status: 'waiting',
                message: 'Looking for someone to match with...'
            }
        });
    } catch (error) {
        console.error('[Roulette] joinQueue error:', error);
        res.status(500).json({ success: false, error: 'Failed to join roulette' });
    }
};

// =========================================================
//  CHECK STATUS (polling)
// =========================================================
exports.checkStatus = async (req, res) => {
    try {
        const userId = req.user.userId;

        const session = await Roulette.findOne({
            'users.user': userId,
            status: { $in: ['waiting', 'matched', 'chatting', 'deciding'] }
        }).populate('users.user', 'username profile.displayName profile.avatar');

        if (!session) {
            return res.json({ success: true, data: { status: 'none' } });
        }

        const partner = session.users.find(u => u.user._id.toString() !== userId)?.user;

        // Calculate remaining time
        let timeRemaining = null;
        if (session.status === 'chatting' && session.chatStartedAt) {
            const elapsed = (Date.now() - session.chatStartedAt.getTime()) / 1000;
            timeRemaining = Math.max(0, session.chatDuration - Math.floor(elapsed));

            // Auto-transition to deciding if time is up
            if (timeRemaining <= 0 && session.status === 'chatting') {
                session.status = 'deciding';
                await session.save();
            }
        }

        res.json({
            success: true,
            data: {
                sessionId: session._id,
                status: session.status,
                partner: partner || null,
                icebreaker: session.icebreaker,
                messages: session.messages.slice(-50),
                timeRemaining,
                chatDuration: session.chatDuration,
                outcome: session.outcome
            }
        });
    } catch (error) {
        console.error('[Roulette] checkStatus error:', error);
        res.status(500).json({ success: false, error: 'Failed to check status' });
    }
};

// =========================================================
//  SEND MESSAGE
// =========================================================
exports.sendMessage = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { sessionId, text } = req.body;

        if (!text?.trim()) {
            return res.status(400).json({ success: false, error: 'Message text required' });
        }

        const session = await Roulette.findById(sessionId);
        if (!session || !session.users.find(u => u.user.toString() === userId)) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        if (session.status !== 'chatting') {
            return res.status(400).json({ success: false, error: 'Chat time is over' });
        }

        const message = await session.addMessage(userId, text.trim());

        res.json({
            success: true,
            data: message
        });
    } catch (error) {
        console.error('[Roulette] sendMessage error:', error);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
};

// =========================================================
//  MAKE DECISION (connect or pass)
// =========================================================
exports.decide = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { sessionId, decision } = req.body;

        if (!['connect', 'pass'].includes(decision)) {
            return res.status(400).json({ success: false, error: 'Decision must be "connect" or "pass"' });
        }

        const session = await Roulette.findById(sessionId);
        if (!session || !session.users.find(u => u.user.toString() === userId)) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        const result = await session.recordDecision(userId, decision);

        // If mutual connect, create an actual connection
        if (result.outcome === 'mutual_connect') {
            const otherUserId = session.users.find(u => u.user.toString() !== userId)?.user;
            if (otherUserId) {
                try {
                    // Mutual follow — both follow each other, via the dedicated
                    // Follow collection (idempotent: the unique index + Follow
                    // create makes a repeat connect a no-op, not a duplicate or
                    // a runaway stat increment). No embedded array writes.
                    await Promise.all([
                        Follow.create({ follower: userId, following: otherUserId }).catch(e => {
                            if (e.code !== 11000) throw e;
                        }),
                        Follow.create({ follower: otherUserId, following: userId }).catch(e => {
                            if (e.code !== 11000) throw e;
                        })
                    ]);

                    // Reconcile the cached counters from the source of truth.
                    const [uF, uG, oF, oG] = await Promise.all([
                        Follow.getFollowerCount(userId),
                        Follow.getFollowingCount(userId),
                        Follow.getFollowerCount(otherUserId),
                        Follow.getFollowingCount(otherUserId)
                    ]);
                    await Promise.all([
                        User.updateOne({ _id: userId }, { $set: { 'stats.followers': uF, 'stats.following': uG } }),
                        User.updateOne({ _id: otherUserId }, { $set: { 'stats.followers': oF, 'stats.following': oG } })
                    ]);

                    cacheService.del(`followgraph:${userId}`).catch(() => {});
                    cacheService.del(`followgraph:${otherUserId}`).catch(() => {});
                    cacheService.del(`reel:following:${userId}`).catch(() => {});
                    cacheService.del(`reel:following:${otherUserId}`).catch(() => {});
                } catch (e) {
                    console.error('[Roulette] Follow creation error:', e);
                }
            }
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[Roulette] decide error:', error);
        res.status(500).json({ success: false, error: 'Failed to record decision' });
    }
};

// =========================================================
//  LEAVE / CANCEL
// =========================================================
exports.leave = async (req, res) => {
    try {
        const userId = req.user.userId;

        const session = await Roulette.findOne({
            'users.user': userId,
            status: { $in: ['waiting', 'matched'] }
        });

        if (session) {
            session.status = 'expired';
            session.outcome = 'expired';
            await session.save();
        }

        res.json({ success: true, message: 'Left roulette' });
    } catch (error) {
        console.error('[Roulette] leave error:', error);
        res.status(500).json({ success: false, error: 'Failed to leave' });
    }
};

// =========================================================
//  HISTORY
// =========================================================
exports.getHistory = async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit) || 20;

        const history = await Roulette.getUserHistory(userId, limit);

        res.json({
            success: true,
            data: history.map(h => ({
                sessionId: h._id,
                partner: h.users.find(u => u.user._id?.toString() !== userId)?.user,
                outcome: h.outcome,
                messageCount: h.messages?.length || 0,
                date: h.createdAt
            }))
        });
    } catch (error) {
        console.error('[Roulette] getHistory error:', error);
        res.status(500).json({ success: false, error: 'Failed to get history' });
    }
};
