const Bookmark = require('../models/Bookmark');
const Post = require('../models/Post');
const Reel = require('../models/Reel');

/**
 * @desc    Toggle bookmark (add/remove)
 * @route   POST /api/v1/bookmarks
 * @access  Private
 */
exports.toggleBookmark = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { itemId, itemType } = req.body;

        if (!itemId || !itemType) {
            return res.status(400).json({ success: false, message: 'itemId and itemType required' });
        }

        if (!['post', 'reel'].includes(itemType)) {
            return res.status(400).json({ success: false, message: 'itemType must be post or reel' });
        }

        const existing = await Bookmark.findOne({ user: userId, itemId, itemType });

        if (existing) {
            await Bookmark.deleteOne({ _id: existing._id });

            // Decrement saves count for reels
            if (itemType === 'reel') {
                await Reel.findByIdAndUpdate(itemId, { $inc: { 'stats.saves': -1 } });
            }

            return res.json({ success: true, data: { isBookmarked: false } });
        }

        await Bookmark.create({ user: userId, itemId, itemType });

        // Increment saves count for reels
        if (itemType === 'reel') {
            await Reel.findByIdAndUpdate(itemId, { $inc: { 'stats.saves': 1 } });
        }

        res.status(201).json({ success: true, data: { isBookmarked: true } });
    } catch (error) {
        console.error('Toggle bookmark error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get user's bookmarks
 * @route   GET /api/v1/bookmarks?type=post|reel
 * @access  Private
 */
exports.getBookmarks = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { type = 'post', page = 1, limit = 20 } = req.query;

        const bookmarks = await Bookmark.find({ user: userId, itemType: type })
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();

        const itemIds = bookmarks.map(b => b.itemId);

        let items = [];
        if (type === 'post') {
            items = await Post.find({ _id: { $in: itemIds }, isActive: true })
                .populate('author', 'username name avatar profile isVerified')
                .lean();

            // Add isLiked + isBookmarked flags
            items = items.map(post => ({
                ...post,
                isLiked: post.likes?.some(id => id.toString() === userId.toString()) || false,
                isBookmarked: true,
            }));
        } else if (type === 'reel') {
            items = await Reel.find({ _id: { $in: itemIds } })
                .populate('user', 'username name avatar profile isVerified')
                .lean();

            items = items.map(reel => ({
                ...reel,
                isSaved: true,
            }));
        }

        // Maintain bookmark order
        const itemMap = new Map(items.map(i => [i._id.toString(), i]));
        const ordered = itemIds
            .map(id => itemMap.get(id.toString()))
            .filter(Boolean);

        res.json({
            success: true,
            data: ordered,
            pagination: { page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('Get bookmarks error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Check if item is bookmarked
 * @route   GET /api/v1/bookmarks/check/:itemId
 * @access  Private
 */
exports.checkBookmark = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { itemId } = req.params;

        const exists = await Bookmark.findOne({ user: userId, itemId });
        res.json({ success: true, data: { isBookmarked: !!exists } });
    } catch (error) {
        console.error('Check bookmark error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};
