const mongoose = require('mongoose');

const whisperSchema = new mongoose.Schema({
    // Content
    content: {
        type: String,
        required: true,
        maxlength: 280,
        trim: true
    },

    // Location-based (anonymous local)
    location: {
        type: { type: String, default: 'Point', enum: ['Point'] },
        coordinates: { type: [Number], required: true } // [lng, lat]
    },
    city: String,
    region: String,

    // Author (stored but never exposed)
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        select: false // Never include in queries by default
    },

    // Voting
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    score: { type: Number, default: 0 }, // upvotes - downvotes
    voters: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', select: false },
        vote: { type: String, enum: ['up', 'down'] }
    }],

    // Replies (also anonymous)
    replies: [{
        content: { type: String, maxlength: 200 },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', select: false },
        upvotes: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now }
    }],

    // Moderation
    reports: { type: Number, default: 0 },
    isHidden: { type: Boolean, default: false },

    // Auto-expire after 24 hours
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
        index: { expires: 0 }
    }
}, { timestamps: true });

// Geospatial index for nearby queries
whisperSchema.index({ location: '2dsphere' });
whisperSchema.index({ score: -1, createdAt: -1 });

// Static: Get nearby whispers
whisperSchema.statics.getNearby = async function (lng, lat, radiusKm = 5, limit = 50) {
    return this.find({
        location: {
            $near: {
                $geometry: { type: 'Point', coordinates: [lng, lat] },
                $maxDistance: radiusKm * 1000
            }
        },
        isHidden: false
    })
        .sort({ score: -1, createdAt: -1 })
        .limit(limit)
        .select('-author -voters.user -replies.author');
};

// Static: Vote on a whisper
whisperSchema.statics.vote = async function (whisperId, userId, voteType) {
    const whisper = await this.findById(whisperId).select('+voters.user');
    if (!whisper) throw new Error('Whisper not found');

    // Check existing vote
    const existingIdx = whisper.voters.findIndex(v => v.user.toString() === userId.toString());

    if (existingIdx > -1) {
        const existing = whisper.voters[existingIdx];
        if (existing.vote === voteType) {
            // Remove vote (toggle off)
            whisper.voters.splice(existingIdx, 1);
            whisper[voteType === 'up' ? 'upvotes' : 'downvotes']--;
        } else {
            // Change vote
            whisper[existing.vote === 'up' ? 'upvotes' : 'downvotes']--;
            existing.vote = voteType;
            whisper[voteType === 'up' ? 'upvotes' : 'downvotes']++;
        }
    } else {
        // New vote
        whisper.voters.push({ user: userId, vote: voteType });
        whisper[voteType === 'up' ? 'upvotes' : 'downvotes']++;
    }

    whisper.score = whisper.upvotes - whisper.downvotes;
    await whisper.save();

    return { upvotes: whisper.upvotes, downvotes: whisper.downvotes, score: whisper.score };
};

// Instance: Add reply
whisperSchema.methods.addReply = async function (content, authorId) {
    this.replies.push({ content, author: authorId });
    await this.save();
    return this.replies[this.replies.length - 1];
};

module.exports = mongoose.model('Whisper', whisperSchema);
