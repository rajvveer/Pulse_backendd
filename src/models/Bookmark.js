const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    itemType: {
        type: String,
        enum: ['post', 'reel'],
        required: true
    }
}, {
    timestamps: true
});

// One bookmark per user per item
bookmarkSchema.index({ user: 1, itemId: 1, itemType: 1 }, { unique: true });
bookmarkSchema.index({ user: 1, itemType: 1, createdAt: -1 });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
