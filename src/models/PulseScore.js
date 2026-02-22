const mongoose = require('mongoose');

/**
 * PulseScore Model — Gamified Social Reputation System
 *
 * A dynamic score (0-1000) visible on profiles.
 * Calculated from: engagement quality, consistency, community contribution.
 * Powers: leaderboards, tier badges, and social proof.
 */

const pulseScoreSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },

    // ===== MAIN SCORE =====
    score: { type: Number, default: 0, min: 0, max: 1000 },

    // ===== TIER (auto-calculated from score) =====
    tier: {
        type: String,
        enum: ['newcomer', 'rising', 'established', 'influencer', 'icon'],
        default: 'newcomer'
    },

    // ===== SCORE COMPONENTS (each 0-200, total = score) =====
    components: {
        engagement: { type: Number, default: 0 },     // quality of posts (likes/views ratio)
        consistency: { type: Number, default: 0 },     // daily/weekly activity streak
        community: { type: Number, default: 0 },       // comments, helps, reactions to others
        reach: { type: Number, default: 0 },           // follower growth, post reach
        creativity: { type: Number, default: 0 }       // content diversity, media usage
    },

    // ===== RAW METRICS (used to calculate components) =====
    metrics: {
        totalPosts: { type: Number, default: 0 },
        totalLikesGiven: { type: Number, default: 0 },
        totalLikesReceived: { type: Number, default: 0 },
        totalCommentsGiven: { type: Number, default: 0 },
        totalCommentsReceived: { type: Number, default: 0 },
        totalFollowers: { type: Number, default: 0 },
        totalFollowing: { type: Number, default: 0 },
        totalShares: { type: Number, default: 0 },
        totalViews: { type: Number, default: 0 },
        uniqueVibes: { type: Number, default: 0 },       // different vibes posted in
        mediaPostsCount: { type: Number, default: 0 },   // posts with images/videos
        daysActive: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        longestStreak: { type: Number, default: 0 },
        lastActiveDate: { type: String, default: '' }     // YYYY-MM-DD for streak tracking
    },

    // ===== HISTORY =====
    history: [{
        date: { type: Date, default: Date.now },
        score: Number,
        tier: String,
        delta: Number      // change from previous
    }],

    // ===== ACHIEVEMENTS =====
    achievements: [{
        id: String,           // e.g., 'first_100', 'streak_7', 'top_10'
        name: String,
        description: String,
        emoji: String,
        unlockedAt: { type: Date, default: Date.now }
    }],

    lastComputedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes
pulseScoreSchema.index({ score: -1 }); // For leaderboards
pulseScoreSchema.index({ tier: 1 });

// =========================================================
//  TIER CONFIGURATION
// =========================================================

const TIERS = {
    newcomer: { min: 0, max: 199, emoji: '🌱', label: 'Newcomer', color: '#8BC34A' },
    rising: { min: 200, max: 399, emoji: '⭐', label: 'Rising Star', color: '#FFC107' },
    established: { min: 400, max: 599, emoji: '💫', label: 'Established', color: '#FF9800' },
    influencer: { min: 600, max: 799, emoji: '🔥', label: 'Influencer', color: '#F44336' },
    icon: { min: 800, max: 1000, emoji: '👑', label: 'Icon', color: '#9C27B0' }
};

// =========================================================
//  STATIC METHODS
// =========================================================

pulseScoreSchema.statics.getOrCreate = async function (userId) {
    let ps = await this.findOne({ user: userId });
    if (!ps) {
        ps = new this({ user: userId });
        await ps.save();
    }
    return ps;
};

/**
 * Get leaderboard (top users by score)
 */
pulseScoreSchema.statics.getLeaderboard = async function (limit = 50) {
    return this.find({ score: { $gt: 0 } })
        .sort({ score: -1 })
        .limit(limit)
        .populate('user', 'username profile.displayName profile.avatar isVerified')
        .lean();
};

/**
 * Get user's rank
 */
pulseScoreSchema.statics.getUserRank = async function (userId) {
    const userScore = await this.findOne({ user: userId });
    if (!userScore) return null;

    const rank = await this.countDocuments({ score: { $gt: userScore.score } }) + 1;
    const total = await this.countDocuments({ score: { $gt: 0 } });

    return { rank, total, percentile: Math.round(((total - rank) / total) * 100) };
};

// =========================================================
//  INSTANCE METHODS
// =========================================================

/**
 * Record a user action and recalculate score
 */
pulseScoreSchema.methods.recordAction = function (action, value = 1) {
    const today = new Date().toISOString().split('T')[0];

    // Update raw metrics
    switch (action) {
        case 'post':
            this.metrics.totalPosts += value;
            break;
        case 'like_given':
            this.metrics.totalLikesGiven += value;
            break;
        case 'like_received':
            this.metrics.totalLikesReceived += value;
            break;
        case 'comment_given':
            this.metrics.totalCommentsGiven += value;
            break;
        case 'comment_received':
            this.metrics.totalCommentsReceived += value;
            break;
        case 'follower_gained':
            this.metrics.totalFollowers += value;
            break;
        case 'share':
            this.metrics.totalShares += value;
            break;
        case 'view_received':
            this.metrics.totalViews += value;
            break;
        case 'media_post':
            this.metrics.mediaPostsCount += value;
            break;
    }

    // Update streak
    if (this.metrics.lastActiveDate !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().split('T')[0];

        if (this.metrics.lastActiveDate === yStr) {
            this.metrics.currentStreak++;
        } else if (this.metrics.lastActiveDate !== today) {
            this.metrics.currentStreak = 1;
        }

        this.metrics.daysActive++;
        this.metrics.lastActiveDate = today;

        if (this.metrics.currentStreak > this.metrics.longestStreak) {
            this.metrics.longestStreak = this.metrics.currentStreak;
        }
    }

    // Recalculate score
    this._recalculate();
};

/**
 * Recalculate all score components
 */
pulseScoreSchema.methods._recalculate = function () {
    const m = this.metrics;

    // Engagement (0-200): quality ratio of likes received vs posts
    const engagementRatio = m.totalPosts > 0 ? m.totalLikesReceived / m.totalPosts : 0;
    this.components.engagement = Math.min(200, Math.round(
        Math.log1p(engagementRatio * 10) * 40
    ));

    // Consistency (0-200): streaks and daily activity
    this.components.consistency = Math.min(200, Math.round(
        (Math.min(m.currentStreak, 30) / 30) * 100 +
        (Math.min(m.daysActive, 90) / 90) * 100
    ));

    // Community (0-200): giving to others (comments, likes given)
    this.components.community = Math.min(200, Math.round(
        Math.log1p(m.totalCommentsGiven * 3) * 20 +
        Math.log1p(m.totalLikesGiven) * 10
    ));

    // Reach (0-200): follower count and view metrics
    this.components.reach = Math.min(200, Math.round(
        Math.log1p(m.totalFollowers * 5) * 25 +
        Math.log1p(m.totalViews) * 5
    ));

    // Creativity (0-200): content diversity
    const mediaRatio = m.totalPosts > 0 ? m.mediaPostsCount / m.totalPosts : 0;
    this.components.creativity = Math.min(200, Math.round(
        mediaRatio * 100 +
        Math.min(m.uniqueVibes, 5) * 20
    ));

    // Total score
    const oldScore = this.score;
    this.score = Math.min(1000,
        this.components.engagement +
        this.components.consistency +
        this.components.community +
        this.components.reach +
        this.components.creativity
    );

    // Update tier
    this._updateTier();

    // Check achievements
    this._checkAchievements();

    // Record in history (daily, not per action)
    const today = new Date().toISOString().split('T')[0];
    const lastHistory = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    const lastHistoryDate = lastHistory?.date ? new Date(lastHistory.date).toISOString().split('T')[0] : '';

    if (lastHistoryDate !== today) {
        this.history.push({
            date: new Date(),
            score: this.score,
            tier: this.tier,
            delta: this.score - oldScore
        });

        // Keep last 90 days
        if (this.history.length > 90) {
            this.history = this.history.slice(-90);
        }
    }

    this.lastComputedAt = new Date();
};

/**
 * Update tier based on score
 */
pulseScoreSchema.methods._updateTier = function () {
    for (const [tier, config] of Object.entries(TIERS)) {
        if (this.score >= config.min && this.score <= config.max) {
            this.tier = tier;
            return;
        }
    }
};

/**
 * Check and award achievements
 */
pulseScoreSchema.methods._checkAchievements = function () {
    const earned = new Set(this.achievements.map(a => a.id));

    const check = (id, condition, name, description, emoji) => {
        if (!earned.has(id) && condition) {
            this.achievements.push({ id, name, description, emoji });
        }
    };

    check('first_post', this.metrics.totalPosts >= 1, 'First Post', 'Created your first post', '📝');
    check('posts_10', this.metrics.totalPosts >= 10, 'Content Creator', '10 posts created', '📸');
    check('posts_50', this.metrics.totalPosts >= 50, 'Prolific Poster', '50 posts created', '🚀');
    check('streak_3', this.metrics.currentStreak >= 3, 'On a Roll', '3-day activity streak', '🔥');
    check('streak_7', this.metrics.currentStreak >= 7, 'Week Warrior', '7-day activity streak', '💪');
    check('streak_30', this.metrics.currentStreak >= 30, 'Month Master', '30-day activity streak', '👑');
    check('score_100', this.score >= 100, 'Getting Started', 'Reached 100 Pulse Score', '⭐');
    check('score_500', this.score >= 500, 'Half Way', 'Reached 500 Pulse Score', '💫');
    check('score_800', this.score >= 800, 'Elite Status', 'Reached 800 Pulse Score', '🏆');
    check('likes_100', this.metrics.totalLikesReceived >= 100, 'Crowd Favorite', '100 likes received', '❤️');
    check('community_50', this.metrics.totalCommentsGiven >= 50, 'Community Builder', '50 comments given', '🤝');
    check('followers_100', this.metrics.totalFollowers >= 100, 'Rising Influence', '100 followers gained', '📈');
};

/**
 * Get public display data
 */
pulseScoreSchema.methods.getDisplayData = function () {
    const tierConfig = TIERS[this.tier];

    return {
        score: this.score,
        tier: this.tier,
        tierLabel: tierConfig.label,
        tierEmoji: tierConfig.emoji,
        tierColor: tierConfig.color,
        components: this.components,
        streak: this.metrics.currentStreak,
        achievements: this.achievements.length,
        nextTierAt: tierConfig.max < 1000 ? tierConfig.max + 1 : null,
        progressToNext: tierConfig.max < 1000
            ? Math.round(((this.score - tierConfig.min) / (tierConfig.max - tierConfig.min)) * 100)
            : 100
    };
};

module.exports = mongoose.model('PulseScore', pulseScoreSchema);
module.exports.TIERS = TIERS;
