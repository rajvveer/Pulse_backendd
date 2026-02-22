const AlterEgo = require('../models/AlterEgo');
const { getActiveProvider } = require('../services/alterEgoAIService');

// Get user's alter ego
exports.getMyEgo = async (req, res) => {
    try {
        const userId = req.user.userId;
        const ego = await AlterEgo.getOrCreate(userId);

        res.json({ success: true, data: ego });
    } catch (error) {
        console.error('Get ego error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update alter ego settings
exports.update = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, personality, isActive, autoReplyDM, autoReplyComments } = req.body;

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({
                success: false,
                message: 'Alter Ego not found'
            });
        }

        if (name) ego.name = name;
        if (personality) ego.personality = personality;
        if (typeof isActive === 'boolean') ego.isActive = isActive;
        if (typeof autoReplyDM === 'boolean') ego.autoReplyDM = autoReplyDM;
        if (typeof autoReplyComments === 'boolean') ego.autoReplyComments = autoReplyComments;

        await ego.save();

        res.json({ success: true, data: ego });
    } catch (error) {
        console.error('Update ego error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update training data
exports.train = async (req, res) => {
    try {
        const userId = req.user.userId;
        const trainingData = req.body;

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({
                success: false,
                message: 'Alter Ego not found'
            });
        }

        await ego.updateTraining(trainingData);

        res.json({
            success: true,
            data: {
                trainingLevel: ego.trainingLevel,
                training: ego.training
            }
        });
    } catch (error) {
        console.error('Train ego error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Generate a response (for testing/preview)
exports.generateResponse = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { message, context = {} } = req.body;

        if (!message?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Message required'
            });
        }

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({
                success: false,
                message: 'Alter Ego not found'
            });
        }

        const response = await ego.generateResponse(message, context);

        res.json({ success: true, data: { response } });
    } catch (error) {
        console.error('Generate response error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Toggle active status
exports.toggle = async (req, res) => {
    try {
        const userId = req.user.userId;

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({
                success: false,
                message: 'Alter Ego not found'
            });
        }

        // Require minimum training to activate
        if (!ego.isActive && ego.trainingLevel < 1) {
            return res.status(400).json({
                success: false,
                message: 'Complete at least 1 training step to activate'
            });
        }

        ego.isActive = !ego.isActive;
        await ego.save();

        res.json({
            success: true,
            data: { isActive: ego.isActive }
        });
    } catch (error) {
        console.error('Toggle ego error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get ego stats
exports.getStats = async (req, res) => {
    try {
        const userId = req.user.userId;

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({
                success: false,
                message: 'Alter Ego not found'
            });
        }

        res.json({
            success: true,
            data: {
                totalReplies: ego.totalReplies,
                trainingLevel: ego.trainingLevel,
                isActive: ego.isActive,
                lastActive: ego.lastActive,
                personality: ego.personality,
                guessWhoStats: ego.guessWhoStats,
                aiProvider: getActiveProvider()
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Learn from user's response (for improving AI)
exports.learn = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { trigger, response } = req.body;

        if (!trigger || !response) {
            return res.status(400).json({
                success: false,
                message: 'Trigger and response required'
            });
        }

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({
                success: false,
                message: 'Alter Ego not found'
            });
        }

        await ego.learnFromUser(trigger, response);

        res.json({ success: true, message: 'Learned!' });
    } catch (error) {
        console.error('Learn error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ================================================
//  ALTER EGO 2.0 — NEW ENDPOINTS
// ================================================

// Get activity log (paginated)
exports.getActivityLog = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({ success: false, message: 'Alter Ego not found' });
        }

        const activities = ego.activityLog.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            data: activities,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: ego.activityLog.length,
                hasMore: skip + parseInt(limit) < ego.activityLog.length
            }
        });
    } catch (error) {
        console.error('Get activity log error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Record guess-who game result
exports.recordGuess = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { guessedCorrectly } = req.body;

        if (typeof guessedCorrectly !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'guessedCorrectly (boolean) required'
            });
        }

        const ego = await AlterEgo.findOne({ user: userId });
        if (!ego) {
            return res.status(404).json({ success: false, message: 'Alter Ego not found' });
        }

        const stats = await ego.recordGuessResult(guessedCorrectly);

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Record guess error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get AI provider status
exports.getAIStatus = async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                provider: getActiveProvider(),
                isAIEnabled: getActiveProvider() !== 'template'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
