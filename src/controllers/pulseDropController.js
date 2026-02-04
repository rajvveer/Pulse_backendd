const PulseDrop = require('../models/PulseDrop');
const Post = require('../models/Post');

// Get active drops
exports.getActive = async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const drops = await PulseDrop.getActiveDrops(parseInt(limit));

        // Add time remaining
        const withTime = drops.map(d => ({
            ...d.toObject(),
            timeRemaining: d.getTimeRemaining()
        }));

        res.json({ success: true, data: withTime });
    } catch (error) {
        console.error('Get drops error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get single drop
exports.getById = async (req, res) => {
    try {
        const { dropId } = req.params;
        const drop = await PulseDrop.findById(dropId)
            .populate('triggerPost', 'content media author stats')
            .populate('featuredResponses', 'content media author stats')
            .populate('participants.user', 'username profile.avatar');

        if (!drop) {
            return res.status(404).json({
                success: false,
                message: 'Drop not found'
            });
        }

        res.json({
            success: true,
            data: {
                ...drop.toObject(),
                timeRemaining: drop.getTimeRemaining()
            }
        });
    } catch (error) {
        console.error('Get drop error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Join a drop
exports.join = async (req, res) => {
    try {
        const { dropId } = req.params;
        const { responsePostId } = req.body;
        const userId = req.user.userId;

        const drop = await PulseDrop.findById(dropId);
        if (!drop) {
            return res.status(404).json({
                success: false,
                message: 'Drop not found'
            });
        }

        if (drop.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'This drop has expired'
            });
        }

        await drop.join(userId, responsePostId);

        res.json({
            success: true,
            data: {
                participantCount: drop.participantCount,
                responseCount: drop.responseCount
            }
        });
    } catch (error) {
        console.error('Join drop error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create response post for a drop
exports.createResponse = async (req, res) => {
    try {
        const { dropId } = req.params;
        const { content, media } = req.body;
        const userId = req.user.userId;

        const drop = await PulseDrop.findById(dropId);
        if (!drop || drop.status !== 'active') {
            return res.status(404).json({
                success: false,
                message: 'Active drop not found'
            });
        }

        // Create the post
        const post = await Post.create({
            author: userId,
            content,
            media,
            type: 'pulse_drop_response',
            metadata: { pulseDropId: dropId }
        });

        // Join the drop with response
        await drop.join(userId, post._id);

        res.status(201).json({ success: true, data: post });
    } catch (error) {
        console.error('Create response error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get drop responses
exports.getResponses = async (req, res) => {
    try {
        const { dropId } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const drop = await PulseDrop.findById(dropId);
        if (!drop) {
            return res.status(404).json({
                success: false,
                message: 'Drop not found'
            });
        }

        const responseIds = drop.participants
            .filter(p => p.response)
            .map(p => p.response);

        const responses = await Post.find({ _id: { $in: responseIds } })
            .sort({ 'stats.likes': -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('author', 'username profile.avatar');

        res.json({ success: true, data: responses });
    } catch (error) {
        console.error('Get responses error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Admin: Create manual drop
exports.createDrop = async (req, res) => {
    try {
        const { title, description, coverImage, hashtags, durationHours = 24 } = req.body;

        const drop = await PulseDrop.create({
            title,
            description,
            coverImage,
            hashtags: hashtags || [],
            triggerType: 'manual',
            expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000)
        });

        res.status(201).json({ success: true, data: drop });
    } catch (error) {
        console.error('Create drop error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Cron job: Expire old drops
exports.expireDrops = async () => {
    try {
        await PulseDrop.expireOld();
        console.log('✅ Expired old drops');
    } catch (error) {
        console.error('Expire drops error:', error);
    }
};
