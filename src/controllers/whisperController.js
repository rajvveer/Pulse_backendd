const Whisper = require('../models/Whisper');

// Get nearby whispers
exports.getNearby = async (req, res) => {
    try {
        const { lng, lat, radius = 5, limit = 50 } = req.query;

        if (!lng || !lat) {
            return res.status(400).json({
                success: false,
                message: 'Location coordinates required'
            });
        }

        const whispers = await Whisper.getNearby(
            parseFloat(lng),
            parseFloat(lat),
            parseFloat(radius),
            parseInt(limit)
        );

        // Add distance info
        const withDistance = whispers.map(w => {
            const wObj = w.toObject();
            const dist = calculateDistance(
                parseFloat(lat), parseFloat(lng),
                w.location.coordinates[1], w.location.coordinates[0]
            );
            return { ...wObj, distance: `${dist.toFixed(1)} km` };
        });

        res.json({ success: true, data: withDistance });
    } catch (error) {
        console.error('Get whispers error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create whisper
exports.create = async (req, res) => {
    try {
        const { content, lng, lat, city, region } = req.body;
        const userId = req.user.userId;

        if (!content?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Content is required'
            });
        }
        if (!lng || !lat) {
            return res.status(400).json({
                success: false,
                message: 'Location is required'
            });
        }

        const whisper = await Whisper.create({
            content: content.trim(),
            author: userId,
            location: {
                type: 'Point',
                coordinates: [parseFloat(lng), parseFloat(lat)]
            },
            city,
            region
        });

        // Return without author info
        const safe = whisper.toObject();
        delete safe.author;

        res.status(201).json({ success: true, data: safe });
    } catch (error) {
        console.error('Create whisper error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Vote on whisper
exports.vote = async (req, res) => {
    try {
        const { whisperId } = req.params;
        const { voteType } = req.body; // 'up' or 'down'
        const userId = req.user.userId;

        if (!['up', 'down'].includes(voteType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid vote type'
            });
        }

        const result = await Whisper.vote(whisperId, userId, voteType);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Vote error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Reply to whisper
exports.reply = async (req, res) => {
    try {
        const { whisperId } = req.params;
        const { content } = req.body;
        const userId = req.user.userId;

        const whisper = await Whisper.findById(whisperId);
        if (!whisper) {
            return res.status(404).json({
                success: false,
                message: 'Whisper not found'
            });
        }

        const reply = await whisper.addReply(content, userId);

        // Return without author
        const safe = { ...reply.toObject() };
        delete safe.author;

        res.status(201).json({ success: true, data: safe });
    } catch (error) {
        console.error('Reply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Report whisper
exports.report = async (req, res) => {
    try {
        const { whisperId } = req.params;

        const whisper = await Whisper.findById(whisperId);
        if (!whisper) {
            return res.status(404).json({
                success: false,
                message: 'Whisper not found'
            });
        }

        whisper.reports++;
        if (whisper.reports >= 5) {
            whisper.isHidden = true;
        }
        await whisper.save();

        res.json({ success: true, message: 'Reported' });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Helper: Calculate distance between two points (Haversine)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
