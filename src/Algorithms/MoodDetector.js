/**
 * MoodDetector v2.0 — Advanced User Mood Inference Engine
 *
 * Upgrades:
 *  - Mood momentum tracking (detecting mood shifts over session)
 *  - Day-of-week patterns (Fridays hype, Mondays chill)
 *  - Exponential moving average for smooth transitions
 *  - Session energy detection (bored vs engaged vs hyped)
 *  - Like velocity and scroll-to-like ratio analysis
 *  - Explicit mood memory (remembers last manual selection)
 *
 * Exports are 100% backward-compatible.
 */

// =========================================================
//  MOOD KEYWORD LEXICON — Expanded with intensity tiers
// =========================================================

const MOOD_KEYWORDS = {
    chill: {
        strong: ['meditation', 'zen', 'serene', 'tranquil', 'peaceful morning'],
        weak: ['relaxing', 'peaceful', 'calm', 'cozy', 'vibes', 'sunset', 'coffee',
            'lazy', 'sunday', 'lo-fi', 'lofi', 'ambient', 'soothing', 'breeze'],
        weight: 1.0
    },
    hype: {
        strong: ['insane', 'legendary', 'banger', 'lfg', 'sickkk', 'goat'],
        weak: ['🔥', 'lit', 'amazing', 'incredible', 'crazy', 'wild', 'party',
            'lets go', 'excited', 'hyped', 'fire', 'epic', 'pumped'],
        weight: 1.2
    },
    sad: {
        strong: ['heartbroken', 'devastated', 'sobbing', 'depressed'],
        weak: ['😢', '😭', 'sad', 'miss', 'crying', 'alone', 'lonely',
            'heartbreak', 'feelings', 'feels', 'broken', 'numb', 'empty'],
        weight: 1.0
    },
    funny: {
        strong: ['hilarious', 'lmfao', 'comedy gold', 'crying laughing'],
        weak: ['😂', '🤣', 'lol', 'lmao', 'funny', 'joke', 'meme',
            'dead', 'dying', 'haha', 'bruh', 'roast'],
        weight: 1.0
    },
    creative: {
        strong: ['masterpiece', 'portfolio', 'composition', 'original work'],
        weak: ['art', 'design', 'created', 'made', 'painted', 'drew', 'music',
            'wrote', 'built', 'project', '✨', 'craft', 'diy'],
        weight: 1.0
    }
};

// =========================================================
//  TIME-OF-DAY INFLUENCE
// =========================================================

const TIME_MOODS = {
    morning: { chill: 0.3, hype: 0.1, creative: 0.2 },           // 5am–11am
    afternoon: { hype: 0.2, creative: 0.2, funny: 0.1 },           // 11am–5pm
    evening: { chill: 0.2, sad: 0.1, creative: 0.15 },           // 5pm–9pm
    night: { sad: 0.2, chill: 0.2, funny: 0.15 }               // 9pm–5am
};

// =========================================================
//  DAY-OF-WEEK INFLUENCE — New in v2
// =========================================================

const DAY_MOODS = {
    0: { chill: 0.3, sad: 0.1 },                 // Sunday — lazy
    1: { sad: 0.15, chill: 0.1 },                // Monday — blues
    2: { creative: 0.1 },                         // Tuesday — productive
    3: { creative: 0.15, hype: 0.05 },            // Wednesday — midweek push
    4: { hype: 0.1, funny: 0.1 },                // Thursday — almost there
    5: { hype: 0.3, funny: 0.2 },                // Friday — party mode
    6: { chill: 0.15, hype: 0.15, funny: 0.1 }   // Saturday — weekend
};

// =========================================================
//  SESSION ENERGY PROFILES — New in v2
// =========================================================

const ENERGY_PROFILES = {
    bored: { scrollSpeed: 'fast', likeRatio: 'low', avgDwell: 'low' },
    browsing: { scrollSpeed: 'medium', likeRatio: 'medium', avgDwell: 'medium' },
    engaged: { scrollSpeed: 'slow', likeRatio: 'high', avgDwell: 'high' },
    hyped: { scrollSpeed: 'fast', likeRatio: 'high', avgDwell: 'medium' }
};

// =========================================================
//  SMOOTHING CONFIG
// =========================================================

const EMA_ALPHA = 0.3; // Exponential moving average smoothing factor (lower = smoother)

// =========================================================
//  MAIN CLASS
// =========================================================

class MoodDetector {
    constructor() {
        this.moodScores = {};
        this._previousMood = null;
        this._moodHistory = [];       // Track mood momentum
        this._lastExplicitMood = null; // Remember manual selection
    }

    /**
     * Detect mood from user behavior
     * @param {Object} userBehavior - UserBehavior model instance
     * @param {Object} options - Additional context
     * @returns {Object} { primaryMood, moodScores, confidence, energy, momentum, timestamp }
     */
    async detectMood(userBehavior, options = {}) {
        this.moodScores = { chill: 0, hype: 0, sad: 0, funny: 0, creative: 0 };

        // ── 1. Analyze recent interactions (with intensity) ──
        if (userBehavior?.recentLikes) {
            this._analyzeInteractions(userBehavior.recentLikes);
        }

        // ── 2. Time of day influence ──
        this._applyTimeInfluence();

        // ── 3. Day of week influence (NEW) ──
        this._applyDayInfluence();

        // ── 4. Session behavior patterns (upgraded) ──
        if (userBehavior?.sessionPatterns) {
            this._analyzeSessionBehavior(userBehavior.sessionPatterns);
        }

        // ── 5. Recent content viewed ──
        if (options.recentViews) {
            this._analyzeContent(options.recentViews);
        }

        // ── 6. Like velocity analysis (NEW) ──
        if (options.likeTimestamps) {
            this._analyzeLikeVelocity(options.likeTimestamps);
        }

        // ── 7. Explicit mood override ──
        if (options.explicitMood && options.explicitMood !== 'auto') {
            this.moodScores[options.explicitMood] += 5;
            this._lastExplicitMood = options.explicitMood;
        } else if (this._lastExplicitMood) {
            // Gentle bias toward last explicit selection (fading memory)
            this.moodScores[this._lastExplicitMood] += 0.5;
        }

        // ── 8. Calculate primary mood ──
        const sorted = Object.entries(this.moodScores).sort((a, b) => b[1] - a[1]);
        let primaryMood = sorted[0][0];

        // ── 9. Apply EMA smoothing (NEW) ──
        if (this._previousMood && this._previousMood !== primaryMood) {
            primaryMood = this._smoothTransition(sorted);
        }

        // ── 10. Calculate confidence ──
        const confidence = this._calculateConfidence(sorted);

        // ── 11. Detect session energy (NEW) ──
        const energy = this._detectEnergy(userBehavior?.sessionPatterns);

        // ── 12. Calculate mood momentum (NEW) ──
        const momentum = this._calculateMomentum(primaryMood);

        // ── 13. Update history ──
        this._previousMood = primaryMood;
        this._moodHistory.push({ mood: primaryMood, time: Date.now() });
        if (this._moodHistory.length > 20) this._moodHistory.shift();

        return {
            primaryMood,
            moodScores: this.moodScores,
            confidence,
            energy,
            momentum,
            timestamp: new Date()
        };
    }

    /**
     * Analyze recent liked/interacted content for mood signals
     * Upgraded: uses intensity tiers
     */
    _analyzeInteractions(interactions) {
        for (const interaction of interactions.slice(-20)) {
            if (interaction.content) {
                this._extractMoodFromText(interaction.content);
            }
            if (interaction.hashtags) {
                for (const tag of interaction.hashtags) {
                    this._extractMoodFromText(tag);
                }
            }
        }
    }

    /**
     * Extract mood signals from text — Now with intensity tiers
     */
    _extractMoodFromText(text) {
        const lower = text.toLowerCase();

        for (const [mood, config] of Object.entries(MOOD_KEYWORDS)) {
            // Strong keywords give bigger boost
            if (config.strong) {
                for (const keyword of config.strong) {
                    if (lower.includes(keyword)) {
                        this.moodScores[mood] += config.weight * 2.0;
                    }
                }
            }
            // Weak keywords
            for (const keyword of config.weak) {
                if (lower.includes(keyword)) {
                    this.moodScores[mood] += config.weight;
                }
            }
        }
    }

    /**
     * Apply time-of-day mood tendencies
     */
    _applyTimeInfluence() {
        const hour = new Date().getHours();
        let period;

        if (hour >= 5 && hour < 11) period = 'morning';
        else if (hour >= 11 && hour < 17) period = 'afternoon';
        else if (hour >= 17 && hour < 21) period = 'evening';
        else period = 'night';

        const influences = TIME_MOODS[period];
        for (const [mood, boost] of Object.entries(influences)) {
            this.moodScores[mood] += boost;
        }
    }

    /**
     * Apply day-of-week mood tendencies (NEW)
     */
    _applyDayInfluence() {
        const day = new Date().getDay();
        const influences = DAY_MOODS[day] || {};
        for (const [mood, boost] of Object.entries(influences)) {
            this.moodScores[mood] += boost;
        }
    }

    /**
     * Analyze session behavior for mood indicators — Upgraded
     */
    _analyzeSessionBehavior(patterns) {
        if (!patterns) return;

        // Fast scrolling = bored or restless
        if (patterns.scrollSpeed === 'fast') {
            this.moodScores.hype += 0.2;
            // If also low like rate → they're bored, not hyped
            if (patterns.likeRate < 0.05) {
                this.moodScores.hype -= 0.15;
                this.moodScores.funny += 0.2; // Inject entertainment
            }
        }

        // Long reading sessions = engaged/focused
        if (patterns.avgViewTime > 10) {
            this.moodScores.chill += 0.2;
            this.moodScores.creative += 0.15;
        }

        // Very long sessions suggest deep engagement
        if (patterns.avgViewTime > 20) {
            this.moodScores.creative += 0.2;
        }

        // Lots of video watching = entertainment mode
        if (patterns.videoViews > (patterns.textViews || 0)) {
            this.moodScores.funny += 0.2;
            this.moodScores.hype += 0.1;
        }

        // High comment writing = emotionally engaged
        if (patterns.commentRate > 0.1) {
            this.moodScores.sad += 0.1;
            this.moodScores.creative += 0.1;
        }

        // Lots of sharing = hype
        if (patterns.shareRate > 0.05) {
            this.moodScores.hype += 0.2;
        }
    }

    /**
     * Analyze recent viewed content — with recency weighting
     */
    _analyzeContent(views) {
        const now = Date.now();
        for (const view of views.slice(-15)) {
            if (view.content) {
                this._extractMoodFromText(view.content);
            }
            // Triple-weight very recent views (last 2 minutes)
            if (view.timestamp && (now - view.timestamp < 2 * 60 * 1000)) {
                if (view.content) {
                    this._extractMoodFromText(view.content);
                    this._extractMoodFromText(view.content);
                }
            }
            // Double-weight recent views (last 5 minutes)
            else if (view.timestamp && (now - view.timestamp < 5 * 60 * 1000)) {
                if (view.content) {
                    this._extractMoodFromText(view.content);
                }
            }
        }
    }

    /**
     * Analyze like velocity — rapid liking suggests hype/excitement (NEW)
     */
    _analyzeLikeVelocity(timestamps) {
        if (!timestamps || timestamps.length < 3) return;

        // Calculate average time between likes
        const sorted = timestamps.slice(-10).sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) {
            gaps.push(sorted[i] - sorted[i - 1]);
        }
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

        // Fast liking (< 3 seconds between likes) = hyped
        if (avgGap < 3000) {
            this.moodScores.hype += 0.3;
            this.moodScores.funny += 0.1;
        }
        // Very slow liking (> 30 seconds) = thoughtful/chill
        else if (avgGap > 30000) {
            this.moodScores.chill += 0.2;
            this.moodScores.creative += 0.15;
        }
    }

    /**
     * EMA-based mood transition smoothing (NEW)
     * Prevents erratic mood jumps between detections
     */
    _smoothTransition(sorted) {
        if (!this._previousMood) return sorted[0][0];

        const prevIdx = sorted.findIndex(([mood]) => mood === this._previousMood);
        const prevScore = prevIdx >= 0 ? sorted[prevIdx][1] : 0;
        const newTopScore = sorted[0][1];

        // Only switch if new mood is significantly stronger
        const threshold = 1.3; // 30% stronger required to switch
        if (newTopScore > prevScore * threshold) {
            return sorted[0][0];
        }
        return this._previousMood;
    }

    /**
     * Calculate confidence score — Improved with gap analysis
     */
    _calculateConfidence(sortedScores) {
        if (sortedScores.length < 2) return 0;

        const top = sortedScores[0][1];
        const second = sortedScores[1][1];
        const third = sortedScores.length > 2 ? sortedScores[2][1] : 0;

        if (top === 0) return 0;

        // Factor in gap between top and second, and second and third
        const primaryGap = (top - second) / top;
        const secondaryGap = second > 0 ? (second - third) / second : 0;

        // Confidence is high when there's a clear winner
        const confidence = (primaryGap * 0.7) + (secondaryGap * 0.3);
        return Math.min(1, Math.max(0, Math.round(confidence * 100) / 100));
    }

    /**
     * Detect session energy level (NEW)
     * Returns: 'bored' | 'browsing' | 'engaged' | 'hyped'
     */
    _detectEnergy(sessionPatterns) {
        if (!sessionPatterns) return 'browsing';

        const scrollFast = sessionPatterns.scrollSpeed === 'fast';
        const highLikeRate = (sessionPatterns.likeRate || 0) > 0.1;
        const longDwell = (sessionPatterns.avgViewTime || 0) > 10;

        if (scrollFast && !highLikeRate) return 'bored';
        if (scrollFast && highLikeRate) return 'hyped';
        if (!scrollFast && longDwell) return 'engaged';
        return 'browsing';
    }

    /**
     * Calculate mood momentum (NEW)
     * Returns: 'stable' | 'shifting_up' | 'shifting_down' | 'volatile'
     */
    _calculateMomentum(currentMood) {
        if (this._moodHistory.length < 3) return 'stable';

        const recent = this._moodHistory.slice(-5);
        const moodCounts = {};
        recent.forEach(entry => {
            moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
        });

        const uniqueMoods = Object.keys(moodCounts).length;

        // More than 3 different moods in last 5 = volatile
        if (uniqueMoods > 3) return 'volatile';

        // All same mood = stable
        if (uniqueMoods === 1) return 'stable';

        // Check if trending toward positive or negative
        const positiveVibes = ['hype', 'funny', 'creative'];
        const lastThree = recent.slice(-3).map(e => e.mood);
        const positiveCount = lastThree.filter(m => positiveVibes.includes(m)).length;

        if (positiveCount >= 2 && !positiveVibes.includes(recent[0]?.mood)) return 'shifting_up';
        if (positiveCount <= 1 && positiveVibes.includes(recent[0]?.mood)) return 'shifting_down';

        return 'stable';
    }

    /**
     * Get content filter for a specific mood
     * Returns query modifications for the feed
     */
    static getMoodFilter(mood) {
        const filters = {
            chill: {
                hashtags: { $in: ['#peaceful', '#calm', '#relax', '#vibes', '#cozy', '#lofi', '#zen'] },
                mediaPreference: ['image'],
                sortBias: { 'stats.saves': 1 },
                energyHint: 'low'
            },
            hype: {
                hashtags: { $in: ['#trending', '#viral', '#hot', '#fire', '#lit', '#lfg'] },
                sortBias: { 'stats.likes': -1, velocity: -1 },
                minEngagement: 50,
                energyHint: 'high'
            },
            sad: {
                hashtags: { $in: ['#feels', '#deep', '#relatable', '#mood', '#vent'] },
                sortBias: { 'stats.comments': -1 },
                energyHint: 'low'
            },
            funny: {
                hashtags: { $in: ['#funny', '#meme', '#comedy', '#lol', '#roast'] },
                mediaPreference: ['video', 'gif'],
                sortBias: { 'stats.shares': -1 },
                energyHint: 'high'
            },
            creative: {
                hashtags: { $in: ['#art', '#create', '#design', '#music', '#diy', '#photography'] },
                sortBias: { 'stats.saves': -1, 'stats.comments': -1 },
                energyHint: 'medium'
            }
        };

        return filters[mood] || {};
    }
}

module.exports = MoodDetector;
