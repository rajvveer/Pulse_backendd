const mongoose = require('mongoose');

const segmentSchema = new mongoose.Schema({
    content: {
        type: String,
        required: true,
        maxlength: 500
    },
    media: {
        type: String, // URL to image/video
    },
    mediaType: {
        type: String,
        enum: ['image', 'video', 'none'],
        default: 'none'
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    votes: { type: Number, default: 0 },
    voters: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        value: { type: Number, enum: [1, -1] }
    }],
    isApproved: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const chainStorySchema = new mongoose.Schema({
    // Story Info
    title: {
        type: String,
        required: true,
        maxlength: 80,
        trim: true
    },
    previewImage: String,

    // First segment/prompt
    starterContent: {
        type: String,
        required: true,
        maxlength: 500
    },
    starterAuthor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Chain of segments
    segments: [segmentSchema],

    // Pending submissions (for voting)
    pendingSegments: [segmentSchema],

    // Stats
    segmentCount: { type: Number, default: 0 },
    contributorCount: { type: Number, default: 0 },
    contributors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    totalVotes: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },

    // Status
    status: {
        type: String,
        enum: ['active', 'complete', 'archived'],
        default: 'active'
    },
    maxSegments: { type: Number, default: 50 },

    // Settings
    isPublic: { type: Boolean, default: true },
    allowAnyone: { type: Boolean, default: true }, // Anyone can add segments
    requireVotes: { type: Number, default: 3 }, // Votes needed to approve segment

    // Categories/Tags
    genre: {
        type: String,
        enum: ['mystery', 'comedy', 'drama', 'horror', 'romance', 'adventure', 'other'],
        default: 'other'
    },
    tags: [String]
}, { timestamps: true });

// Indexes
chainStorySchema.index({ status: 1, likes: -1 });
chainStorySchema.index({ genre: 1 });
chainStorySchema.index({ 'segments.author': 1 });

// Virtual for last segment
chainStorySchema.virtual('lastSegment').get(function () {
    if (this.segments.length === 0) return this.starterContent;
    return this.segments[this.segments.length - 1].content;
});

// Static: Get active chains
chainStorySchema.statics.getActiveChains = async function (options = {}) {
    const { genre, limit = 20, skip = 0 } = options;
    const query = { status: 'active' };
    if (genre) query.genre = genre;

    return this.find(query)
        .sort({ likes: -1, contributorCount: -1 })
        .skip(skip)
        .limit(limit)
        .populate('starterAuthor', 'username profile.avatar')
        .select('-pendingSegments -segments.voters');
};

// Instance: Add segment submission
chainStorySchema.methods.submitSegment = async function (content, authorId, media = null) {
    if (this.status !== 'active') {
        throw new Error('This chain is no longer accepting submissions');
    }
    if (this.segmentCount >= this.maxSegments) {
        throw new Error('This chain has reached maximum segments');
    }

    const segment = {
        content,
        author: authorId,
        media,
        mediaType: media ? (media.includes('.mp4') ? 'video' : 'image') : 'none'
    };

    this.pendingSegments.push(segment);
    await this.save();

    return segment;
};

// Instance: Vote on pending segment
chainStorySchema.methods.voteOnSegment = async function (segmentId, userId, value) {
    const segment = this.pendingSegments.id(segmentId);
    if (!segment) throw new Error('Segment not found');

    // Check existing vote
    const existingIdx = segment.voters.findIndex(v => v.user.toString() === userId.toString());

    if (existingIdx > -1) {
        segment.votes -= segment.voters[existingIdx].value;
        segment.voters.splice(existingIdx, 1);
    }

    segment.voters.push({ user: userId, value });
    segment.votes += value;

    // Check if approved
    if (segment.votes >= this.requireVotes && !segment.isApproved) {
        segment.isApproved = true;

        // Move to main segments
        this.segments.push(segment);
        this.pendingSegments.pull(segmentId);
        this.segmentCount++;

        // Track contributor
        if (!this.contributors.includes(segment.author)) {
            this.contributors.push(segment.author);
            this.contributorCount++;
        }

        // Check if complete
        if (this.segmentCount >= this.maxSegments) {
            this.status = 'complete';
        }
    }

    this.totalVotes++;
    await this.save();

    return { votes: segment.votes, approved: segment.isApproved };
};

// Instance: Like chain
chainStorySchema.methods.toggleLike = async function (userId) {
    // Simple increment for now - could track individual likes
    this.likes++;
    await this.save();
    return this.likes;
};

module.exports = mongoose.model('ChainStory', chainStorySchema);
