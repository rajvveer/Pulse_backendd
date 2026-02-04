const ChainStory = require('../models/ChainStory');

// Get active chains
exports.getChains = async (req, res) => {
    try {
        const { genre, page = 1, limit = 20, status = 'active' } = req.query;

        const query = {};
        if (status !== 'all') query.status = status;
        if (genre) query.genre = genre;

        const chains = await ChainStory.find(query)
            .sort({ likes: -1, contributorCount: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('starterAuthor', 'username profile.avatar')
            .select('-pendingSegments -segments.voters');

        // Add lastSegment virtual
        const withLast = chains.map(c => ({
            ...c.toObject(),
            lastSegment: c.segments.length > 0
                ? c.segments[c.segments.length - 1].content
                : c.starterContent
        }));

        res.json({ success: true, data: withLast });
    } catch (error) {
        console.error('Get chains error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get single chain with full story
exports.getById = async (req, res) => {
    try {
        const { chainId } = req.params;

        const chain = await ChainStory.findById(chainId)
            .populate('starterAuthor', 'username profile.avatar')
            .populate('segments.author', 'username profile.avatar')
            .populate('contributors', 'username profile.avatar');

        if (!chain) {
            return res.status(404).json({
                success: false,
                message: 'Chain not found'
            });
        }

        res.json({ success: true, data: chain });
    } catch (error) {
        console.error('Get chain error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create new chain
exports.create = async (req, res) => {
    try {
        const { title, starterContent, genre, previewImage, maxSegments, requireVotes } = req.body;
        const userId = req.user.userId;

        if (!title?.trim() || !starterContent?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Title and starter content required'
            });
        }

        const chain = await ChainStory.create({
            title: title.trim(),
            starterContent: starterContent.trim(),
            starterAuthor: userId,
            genre: genre || 'other',
            previewImage,
            maxSegments: maxSegments || 50,
            requireVotes: requireVotes || 3,
            contributors: [userId],
            contributorCount: 1
        });

        res.status(201).json({ success: true, data: chain });
    } catch (error) {
        console.error('Create chain error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Submit segment to chain
exports.submitSegment = async (req, res) => {
    try {
        const { chainId } = req.params;
        const { content, media } = req.body;
        const userId = req.user.userId;

        if (!content?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Content required'
            });
        }

        const chain = await ChainStory.findById(chainId);
        if (!chain) {
            return res.status(404).json({
                success: false,
                message: 'Chain not found'
            });
        }

        const segment = await chain.submitSegment(content.trim(), userId, media);

        res.status(201).json({ success: true, data: segment });
    } catch (error) {
        console.error('Submit segment error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get pending segments for voting
exports.getPending = async (req, res) => {
    try {
        const { chainId } = req.params;

        const chain = await ChainStory.findById(chainId)
            .select('pendingSegments title')
            .populate('pendingSegments.author', 'username profile.avatar');

        if (!chain) {
            return res.status(404).json({
                success: false,
                message: 'Chain not found'
            });
        }

        res.json({ success: true, data: chain.pendingSegments });
    } catch (error) {
        console.error('Get pending error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Vote on pending segment
exports.voteSegment = async (req, res) => {
    try {
        const { chainId, segmentId } = req.params;
        const { value } = req.body; // 1 or -1
        const userId = req.user.userId;

        if (![1, -1].includes(value)) {
            return res.status(400).json({
                success: false,
                message: 'Vote must be 1 or -1'
            });
        }

        const chain = await ChainStory.findById(chainId);
        if (!chain) {
            return res.status(404).json({
                success: false,
                message: 'Chain not found'
            });
        }

        const result = await chain.voteOnSegment(segmentId, userId, value);

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Vote segment error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Like a chain
exports.likeChain = async (req, res) => {
    try {
        const { chainId } = req.params;
        const userId = req.user.userId;

        const chain = await ChainStory.findById(chainId);
        if (!chain) {
            return res.status(404).json({
                success: false,
                message: 'Chain not found'
            });
        }

        const likes = await chain.toggleLike(userId);

        res.json({ success: true, data: { likes } });
    } catch (error) {
        console.error('Like chain error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
