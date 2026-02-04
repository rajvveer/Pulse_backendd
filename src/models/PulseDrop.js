const mongoose = require('mongoose');

const pulseDropSchema = new mongoose.Schema({
    // Drop Info
    title: {
        type: String,
        required: true,
        maxlength: 60,
        trim: true
    },
    description: {
        type: String,
        maxlength: 200
    },
    coverImage: String,

    // Trigger Post (the viral content that triggered this drop)
    triggerPost: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'
    },
    triggerType: {
        type: String,
        enum: ['viral', 'trending_hashtag', 'event', 'manual'],
        default: 'viral'
    },

    // Participation
    participants: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        response: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
        joinedAt: { type: Date, default: Date.now }
    }],
    participantCount: { type: Number, default: 0 },
    responseCount: { type: Number, default: 0 },

    // Time-limited
    startsAt: { type: Date, default: Date.now },
    expiresAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    },
    status: {
        type: String,
        enum: ['active', 'expired', 'featured'],
        default: 'active'
    },

    // Metrics
    totalEngagement: { type: Number, default: 0 },
    trending: { type: Boolean, default: false },
    trendingScore: { type: Number, default: 0 },

    // Hashtags associated
    hashtags: [String],

    // Featured responses
    featuredResponses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'
    }]
}, { timestamps: true });

// Indexes
pulseDropSchema.index({ status: 1, expiresAt: 1 });
pulseDropSchema.index({ trendingScore: -1 });
pulseDropSchema.index({ hashtags: 1 });

// Static: Get active drops
pulseDropSchema.statics.getActiveDrops = async function (limit = 20) {
    const now = new Date();
    return this.find({
        status: 'active',
        expiresAt: { $gt: now }
    })
        .sort({ trending: -1, trendingScore: -1, participantCount: -1 })
        .limit(limit)
        .populate('triggerPost', 'content media author')
        .populate('featuredResponses', 'content media stats');
};

// Static: Create drop from viral content
pulseDropSchema.statics.createFromViral = async function (postId, data = {}) {
    const Post = mongoose.model('Post');
    const post = await Post.findById(postId);
    if (!post) throw new Error('Post not found');

    // Extract hashtags
    const hashtags = post.content?.match(/#\w+/g) || [];

    const drop = new this({
        title: data.title || `🔥 ${hashtags[0] || 'Trending'} Moment`,
        description: data.description || 'Join the viral wave!',
        triggerPost: postId,
        triggerType: 'viral',
        hashtags: hashtags.map(h => h.toLowerCase()),
        trending: true
    });

    await drop.save();
    return drop;
};

// Instance: Join drop
pulseDropSchema.methods.join = async function (userId, responsePostId = null) {
    // Check if already joined
    const existing = this.participants.find(p => p.user.toString() === userId.toString());
    if (existing) {
        if (responsePostId) {
            existing.response = responsePostId;
            this.responseCount++;
        }
    } else {
        this.participants.push({
            user: userId,
            response: responsePostId
        });
        this.participantCount++;
        if (responsePostId) this.responseCount++;
    }

    // Update trending score
    this.trendingScore = this.participantCount * 2 + this.responseCount * 5;

    await this.save();
    return this;
};

// Instance: Calculate time remaining
pulseDropSchema.methods.getTimeRemaining = function () {
    const now = new Date();
    const remaining = this.expiresAt - now;
    if (remaining <= 0) return '0h 0m';

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m`;
};

// Auto-expire job hook
pulseDropSchema.statics.expireOld = async function () {
    const now = new Date();
    await this.updateMany(
        { status: 'active', expiresAt: { $lte: now } },
        { $set: { status: 'expired' } }
    );
};

module.exports = mongoose.model('PulseDrop', pulseDropSchema);
