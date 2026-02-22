const mongoose = require('mongoose');

/**
 * Roulette Model — Random 1-on-1 Content-Based Matching
 *
 * How it works:
 * 1. User joins the roulette queue
 * 2. System matches them with someone based on vibe/DNA compatibility
 * 3. They get a 3-minute timed chat
 * 4. After the timer, they choose: Connect or Pass
 * 5. Mutual Connects create a connection
 */

const rouletteSchema = new mongoose.Schema({
    // ===== MATCH DATA =====
    users: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        joinedAt: { type: Date, default: Date.now },
        decision: { type: String, enum: ['pending', 'connect', 'pass'], default: 'pending' }
    }],

    // ===== SESSION =====
    status: {
        type: String,
        enum: ['waiting', 'matched', 'chatting', 'deciding', 'completed', 'expired'],
        default: 'waiting'
    },

    // Match quality
    matchScore: { type: Number, default: 0 },       // 0-100 compatibility
    matchReason: { type: String, default: '' },       // "Both 🔥 Hype vibes"

    // Chat
    messages: [{
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: { type: String, maxlength: 500 },
        timestamp: { type: Date, default: Date.now }
    }],

    // Timing
    matchedAt: Date,
    chatStartedAt: Date,
    chatDuration: { type: Number, default: 180 },    // seconds (3 min default)
    expiresAt: Date,

    // Outcome
    outcome: {
        type: String,
        enum: ['mutual_connect', 'one_sided', 'mutual_pass', 'expired'],
        default: null
    },

    // Icebreaker prompt
    icebreaker: { type: String, default: '' }
}, { timestamps: true });

// Indexes
rouletteSchema.index({ status: 1 });
rouletteSchema.index({ 'users.user': 1 });
rouletteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-cleanup

// =========================================================
//  ICEBREAKER PROMPTS
// =========================================================

const ICEBREAKERS = [
    "What's the most random thing you've learned recently? 🤓",
    "If you could only listen to one song for a week, what would it be? 🎵",
    "Hot take: pineapple on pizza? 🍕",
    "What's your go-to comfort show? 📺",
    "If you could teleport anywhere right now, where? ✈️",
    "What's the best compliment you've ever received? 💫",
    "Describe yourself in 3 emojis. Go! 🎭",
    "What's something on your bucket list? 🪣",
    "Morning person or night owl? 🌙",
    "What's the last thing that made you laugh? 😂",
    "If you had a superpower, what would it be? ⚡",
    "What's your unpopular opinion? 🗣️",
    "Coffee or tea? This is important. ☕",
    "What's a skill you wish you had? 🎯",
    "What would your alter ego's name be? 🎭"
];

// =========================================================
//  STATIC METHODS
// =========================================================

/**
 * Join the roulette queue
 */
rouletteSchema.statics.joinQueue = async function (userId) {
    // Check if already in an active session
    const existing = await this.findOne({
        'users.user': userId,
        status: { $in: ['waiting', 'matched', 'chatting', 'deciding'] }
    });

    if (existing) return existing;

    // Create a waiting session
    const session = new this({
        users: [{ user: userId, joinedAt: new Date() }],
        status: 'waiting'
    });

    await session.save();
    return session;
};

/**
 * Find a match for a waiting user
 */
rouletteSchema.statics.findMatch = async function (userId, userVibes = {}) {
    // Find another waiting user (not the current user)
    const waiting = await this.find({
        status: 'waiting',
        'users.user': { $ne: userId },
        'users.0.joinedAt': { $gte: new Date(Date.now() - 5 * 60 * 1000) } // within 5 min
    }).sort({ 'users.0.joinedAt': 1 }).limit(10);

    if (waiting.length === 0) return null;

    // Simple match — pick the longest-waiting user
    // In production, we'd score by DNA/vibe compatibility
    const match = waiting[0];

    // Combine into one session
    match.users.push({ user: userId, joinedAt: new Date() });
    match.status = 'matched';
    match.matchedAt = new Date();
    match.icebreaker = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];

    // Set expiry for auto-cleanup (15 min total lifecycle)
    match.expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await match.save();
    return match;
};

/**
 * Start the chat timer
 */
rouletteSchema.methods.startChat = async function () {
    this.status = 'chatting';
    this.chatStartedAt = new Date();
    await this.save();
    return this;
};

/**
 * Add a message
 */
rouletteSchema.methods.addMessage = async function (senderId, text) {
    this.messages.push({
        sender: senderId,
        text: text.substring(0, 500),
        timestamp: new Date()
    });

    // Cap at 100 messages
    if (this.messages.length > 100) {
        this.messages = this.messages.slice(-100);
    }

    await this.save();
    return this.messages[this.messages.length - 1];
};

/**
 * Record a user's decision
 */
rouletteSchema.methods.recordDecision = async function (userId, decision) {
    const userEntry = this.users.find(u => u.user.toString() === userId.toString());
    if (!userEntry) throw new Error('User not in this session');

    userEntry.decision = decision;

    // Check if both users have decided
    const allDecided = this.users.every(u => u.decision !== 'pending');
    if (allDecided) {
        this.status = 'completed';

        const decisions = this.users.map(u => u.decision);
        if (decisions.every(d => d === 'connect')) {
            this.outcome = 'mutual_connect';
        } else if (decisions.every(d => d === 'pass')) {
            this.outcome = 'mutual_pass';
        } else {
            this.outcome = 'one_sided';
        }
    } else {
        this.status = 'deciding';
    }

    await this.save();
    return { outcome: this.outcome, status: this.status };
};

/**
 * Get user's roulette history
 */
rouletteSchema.statics.getUserHistory = async function (userId, limit = 20) {
    return this.find({
        'users.user': userId,
        status: 'completed'
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('users.user', 'username profile.displayName profile.avatar')
        .lean();
};

module.exports = mongoose.model('Roulette', rouletteSchema);
