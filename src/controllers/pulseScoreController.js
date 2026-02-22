const PulseScore = require('../models/PulseScore');

// =========================================================
//  GET MY PULSE SCORE
// =========================================================
exports.getMyScore = async (req, res) => {
    try {
        const ps = await PulseScore.getOrCreate(req.user.userId);

        res.json({
            success: true,
            data: ps.getDisplayData()
        });
    } catch (error) {
        console.error('[PulseScore] getMyScore error:', error);
        res.status(500).json({ success: false, error: 'Failed to get Pulse Score' });
    }
};

// =========================================================
//  GET DETAILED BREAKDOWN
// =========================================================
exports.getBreakdown = async (req, res) => {
    try {
        const ps = await PulseScore.getOrCreate(req.user.userId);

        res.json({
            success: true,
            data: {
                ...ps.getDisplayData(),
                metrics: ps.metrics,
                history: ps.history.slice(-30),
                achievements: ps.achievements
            }
        });
    } catch (error) {
        console.error('[PulseScore] getBreakdown error:', error);
        res.status(500).json({ success: false, error: 'Failed to get breakdown' });
    }
};

// =========================================================
//  GET LEADERBOARD
// =========================================================
exports.getLeaderboard = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const leaderboard = await PulseScore.getLeaderboard(limit);

        // Get requester's rank
        const myRank = await PulseScore.getUserRank(req.user.userId);

        res.json({
            success: true,
            data: {
                leaderboard: leaderboard.map((entry, i) => ({
                    rank: i + 1,
                    user: entry.user,
                    score: entry.score,
                    tier: entry.tier
                })),
                myRank
            }
        });
    } catch (error) {
        console.error('[PulseScore] getLeaderboard error:', error);
        res.status(500).json({ success: false, error: 'Failed to get leaderboard' });
    }
};

// =========================================================
//  GET ANOTHER USER'S SCORE (public view)
// =========================================================
exports.getUserScore = async (req, res) => {
    try {
        const { userId } = req.params;
        const ps = await PulseScore.findOne({ user: userId });

        if (!ps) {
            return res.json({
                success: true,
                data: { score: 0, tier: 'newcomer', tierEmoji: '🌱' }
            });
        }

        res.json({
            success: true,
            data: ps.getDisplayData()
        });
    } catch (error) {
        console.error('[PulseScore] getUserScore error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user score' });
    }
};

// =========================================================
//  GET MY ACHIEVEMENTS
// =========================================================
exports.getAchievements = async (req, res) => {
    try {
        const ps = await PulseScore.getOrCreate(req.user.userId);

        res.json({
            success: true,
            data: ps.achievements
        });
    } catch (error) {
        console.error('[PulseScore] getAchievements error:', error);
        res.status(500).json({ success: false, error: 'Failed to get achievements' });
    }
};

// =========================================================
//  GET SCORE HISTORY (for charts)
// =========================================================
exports.getHistory = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const ps = await PulseScore.getOrCreate(req.user.userId);

        res.json({
            success: true,
            data: ps.history.slice(-days)
        });
    } catch (error) {
        console.error('[PulseScore] getHistory error:', error);
        res.status(500).json({ success: false, error: 'Failed to get history' });
    }
};
