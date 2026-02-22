const mongoose = require('mongoose');

/**
 * SocialDNA Model — Your Unique Content Personality Fingerprint
 *
 * Tracks:  vibe breakdown, weekly evolution, DNA twins, shareable cards
 * Powers:  DNA matching, weekly insights, viral share cards
 */

const weeklySnapshotSchema = new mongoose.Schema({
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    strands: {
        chill: { type: Number, default: 0 },
        hype: { type: Number, default: 0 },
        sad: { type: Number, default: 0 },
        funny: { type: Number, default: 0 },
        creative: { type: Number, default: 0 }
    },
    dominantVibe: { type: String, enum: ['chill', 'hype', 'sad', 'funny', 'creative'] },
    insights: [{
        type: { type: String },   // e.g. 'spike', 'shift', 'milestone'
        message: String,
        metric: String,
        value: Number
    }],
    totalInteractions: { type: Number, default: 0 }
}, { _id: true });

const socialDNASchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },

    // ===== CURRENT DNA STRANDS (percentages that add up to 100) =====
    strands: {
        chill: { type: Number, default: 20 },
        hype: { type: Number, default: 20 },
        sad: { type: Number, default: 20 },
        funny: { type: Number, default: 20 },
        creative: { type: Number, default: 20 }
    },

    // Dominant trait
    dominantVibe: {
        type: String,
        enum: ['chill', 'hype', 'sad', 'funny', 'creative'],
        default: 'chill'
    },

    // ===== RAW COUNTERS (used to compute percentages) =====
    rawSignals: {
        chill: { type: Number, default: 0 },
        hype: { type: Number, default: 0 },
        sad: { type: Number, default: 0 },
        funny: { type: Number, default: 0 },
        creative: { type: Number, default: 0 }
    },
    totalSignals: { type: Number, default: 0 },

    // ===== WEEKLY EVOLUTION =====
    snapshots: [weeklySnapshotSchema],

    // ===== DNA TWINS (users with very similar DNA) =====
    twins: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        matchPercent: { type: Number, default: 0 },
        discoveredAt: { type: Date, default: Date.now }
    }],

    // ===== INSIGHTS (latest) =====
    latestInsights: [{
        type: { type: String },
        message: String,
        metric: String,
        value: Number,
        generatedAt: { type: Date, default: Date.now }
    }],

    // ===== STATS =====
    streak: { type: Number, default: 0 },        // consecutive weeks active
    totalWeeksTracked: { type: Number, default: 0 },
    cardShareCount: { type: Number, default: 0 }, // viral tracking

    lastComputedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexes
socialDNASchema.index({ user: 1 }, { unique: true });
socialDNASchema.index({ dominantVibe: 1 });
socialDNASchema.index({ 'twins.user': 1 });

// =========================================================
//  STATIC METHODS
// =========================================================

/**
 * Get or create DNA profile for a user
 */
socialDNASchema.statics.getOrCreate = async function (userId) {
    let dna = await this.findOne({ user: userId });
    if (!dna) {
        dna = new this({ user: userId });
        await dna.save();
    }
    return dna;
};

/**
 * Record a vibe signal (called when user posts, likes, comments, etc.)
 */
socialDNASchema.statics.recordSignal = async function (userId, vibe, weight = 1) {
    const validVibes = ['chill', 'hype', 'sad', 'funny', 'creative'];
    if (!validVibes.includes(vibe)) return null;

    const dna = await this.getOrCreate(userId);

    dna.rawSignals[vibe] += weight;
    dna.totalSignals += weight;

    // Recalculate percentages
    dna._recalcStrands();

    dna.lastComputedAt = new Date();
    await dna.save();
    return dna;
};

// =========================================================
//  INSTANCE METHODS
// =========================================================

/**
 * Recalculate strand percentages from raw signals
 */
socialDNASchema.methods._recalcStrands = function () {
    const total = this.totalSignals || 1;  // avoid /0
    const vibes = ['chill', 'hype', 'sad', 'funny', 'creative'];

    vibes.forEach(v => {
        this.strands[v] = Math.round((this.rawSignals[v] / total) * 100);
    });

    // Fix rounding so it sums to 100
    const sum = vibes.reduce((s, v) => s + this.strands[v], 0);
    if (sum !== 100 && total > 0) {
        const diff = 100 - sum;
        // Add diff to dominant
        const dominant = vibes.reduce((a, b) =>
            this.strands[a] > this.strands[b] ? a : b
        );
        this.strands[dominant] += diff;
    }

    // Update dominant vibe
    this.dominantVibe = vibes.reduce((a, b) =>
        this.strands[a] >= this.strands[b] ? a : b
    );
};

/**
 * Take a weekly snapshot
 */
socialDNASchema.methods.takeSnapshot = function () {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    const snapshot = {
        weekStart,
        weekEnd: now,
        strands: { ...this.strands },
        dominantVibe: this.dominantVibe,
        insights: this._generateInsights(),
        totalInteractions: this.totalSignals
    };

    this.snapshots.push(snapshot);

    // Keep only last 52 weeks
    if (this.snapshots.length > 52) {
        this.snapshots = this.snapshots.slice(-52);
    }

    this.totalWeeksTracked++;
    this.streak++;

    return snapshot;
};

/**
 * Generate weekly insights by comparing to previous snapshot
 */
socialDNASchema.methods._generateInsights = function () {
    const insights = [];
    const prev = this.snapshots.length > 0
        ? this.snapshots[this.snapshots.length - 1]
        : null;

    const vibes = ['chill', 'hype', 'sad', 'funny', 'creative'];
    const vibeEmojis = { chill: '😌', hype: '🔥', sad: '😢', funny: '😂', creative: '✨' };

    if (!prev) {
        insights.push({
            type: 'welcome',
            message: '🧬 Your Social DNA has been activated! Keep engaging to evolve it.',
            metric: 'activation',
            value: 1
        });
        return insights;
    }

    // Check for big shifts
    vibes.forEach(v => {
        const diff = this.strands[v] - (prev.strands?.[v] || 0);
        if (diff >= 10) {
            insights.push({
                type: 'spike',
                message: `${vibeEmojis[v]} Your ${v} side surged +${diff}% this week!`,
                metric: v,
                value: diff
            });
        } else if (diff <= -10) {
            insights.push({
                type: 'shift',
                message: `${vibeEmojis[v]} Your ${v} energy dropped ${Math.abs(diff)}% — new phase?`,
                metric: v,
                value: diff
            });
        }
    });

    // Check for dominant change
    if (prev.dominantVibe !== this.dominantVibe) {
        insights.push({
            type: 'shift',
            message: `🔄 Personality shift! You went from ${vibeEmojis[prev.dominantVibe]} ${prev.dominantVibe} to ${vibeEmojis[this.dominantVibe]} ${this.dominantVibe}`,
            metric: 'dominant_change',
            value: 1
        });
    }

    // Milestone checks
    if (this.totalWeeksTracked === 4) {
        insights.push({
            type: 'milestone',
            message: '🎉 1 month of Social DNA! Your fingerprint is getting more accurate.',
            metric: 'weeks',
            value: 4
        });
    }

    if (insights.length === 0) {
        insights.push({
            type: 'stable',
            message: `🧬 Consistent vibes! Your DNA is ${this.strands[this.dominantVibe]}% ${this.dominantVibe} ${vibeEmojis[this.dominantVibe]}`,
            metric: 'stability',
            value: this.strands[this.dominantVibe]
        });
    }

    return insights;
};

/**
 * Calculate match percentage with another user's DNA
 */
socialDNASchema.methods.matchWith = function (otherDNA) {
    const vibes = ['chill', 'hype', 'sad', 'funny', 'creative'];

    // Cosine similarity of strand vectors
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    vibes.forEach(v => {
        const a = this.strands[v] || 0;
        const b = otherDNA.strands[v] || 0;
        dotProduct += a * b;
        magA += a * a;
        magB += b * b;
    });

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) return 0;

    const similarity = dotProduct / (magA * magB);
    return Math.round(similarity * 100);
};

/**
 * Get the share card data (for generating shareable images)
 */
socialDNASchema.methods.getShareCardData = function () {
    const vibeEmojis = { chill: '😌', hype: '🔥', sad: '😢', funny: '😂', creative: '✨' };
    const vibeColors = {
        chill: '#00D2FF',
        hype: '#FF6B35',
        sad: '#7B68EE',
        funny: '#FFD700',
        creative: '#FF1493'
    };

    const sorted = Object.entries(this.strands)
        .sort((a, b) => b[1] - a[1]);

    return {
        strands: sorted.map(([vibe, pct]) => ({
            vibe,
            percentage: pct,
            emoji: vibeEmojis[vibe],
            color: vibeColors[vibe]
        })),
        dominantVibe: this.dominantVibe,
        dominantEmoji: vibeEmojis[this.dominantVibe],
        dominantColor: vibeColors[this.dominantVibe],
        streak: this.streak,
        weeksTracked: this.totalWeeksTracked
    };
};

module.exports = mongoose.model('SocialDNA', socialDNASchema);
