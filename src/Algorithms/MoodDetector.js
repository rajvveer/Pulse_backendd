/**
 * MoodDetector - Infers user mood from behavior and content interaction
 * Used for Vibe Check feature to personalize feed based on emotional state
 */

const MOOD_KEYWORDS = {
    chill: {
        positive: ['relaxing', 'peaceful', 'calm', 'cozy', 'vibes', 'sunset', 'coffee', 'lazy', 'sunday'],
        weight: 1.0
    },
    hype: {
        positive: ['🔥', 'lit', 'amazing', 'incredible', 'insane', 'crazy', 'wild', 'party', 'lets go', 'lfg', 'excited', 'hyped'],
        weight: 1.2
    },
    sad: {
        positive: ['😢', '😭', 'sad', 'miss', 'crying', 'alone', 'lonely', 'heartbreak', 'depressed', 'feelings', 'feels'],
        weight: 1.0
    },
    funny: {
        positive: ['😂', '🤣', 'lol', 'lmao', 'hilarious', 'funny', 'joke', 'meme', 'dead', 'dying'],
        weight: 1.0
    },
    creative: {
        positive: ['art', 'design', 'created', 'made', 'painted', 'drew', 'music', 'wrote', 'built', 'project', '✨'],
        weight: 1.0
    }
};

const TIME_MOODS = {
    morning: { chill: 0.3, hype: 0.1, creative: 0.2 },     // 5am-11am
    afternoon: { hype: 0.2, creative: 0.2 },               // 11am-5pm  
    evening: { chill: 0.2, sad: 0.1 },                     // 5pm-9pm
    night: { sad: 0.2, chill: 0.2, funny: 0.15 }           // 9pm-5am
};

class MoodDetector {
    constructor() {
        this.moodScores = {};
    }

    /**
     * Detect mood from user behavior
     * @param {Object} userBehavior - UserBehavior model instance
     * @param {Object} options - Additional context (time, recent posts, etc)
     * @returns {Object} { primaryMood, moodScores, confidence }
     */
    async detectMood(userBehavior, options = {}) {
        this.moodScores = { chill: 0, hype: 0, sad: 0, funny: 0, creative: 0 };

        // 1. Analyze recent interactions
        if (userBehavior?.recentLikes) {
            this._analyzeInteractions(userBehavior.recentLikes);
        }

        // 2. Check time of day influence
        this._applyTimeInfluence();

        // 3. Check session behavior patterns
        if (userBehavior?.sessionPatterns) {
            this._analyzeSessionBehavior(userBehavior.sessionPatterns);
        }

        // 4. Process any recent content they viewed
        if (options.recentViews) {
            this._analyzeContent(options.recentViews);
        }

        // 5. Apply explicit mood if set
        if (options.explicitMood && options.explicitMood !== 'auto') {
            this.moodScores[options.explicitMood] += 5; // Strong boost for explicit selection
        }

        // Calculate primary mood
        const sorted = Object.entries(this.moodScores).sort((a, b) => b[1] - a[1]);
        const primaryMood = sorted[0][0];
        const confidence = this._calculateConfidence(sorted);

        return {
            primaryMood,
            moodScores: this.moodScores,
            confidence,
            timestamp: new Date()
        };
    }

    /**
     * Analyze recent liked/interacted content for mood signals
     */
    _analyzeInteractions(interactions) {
        for (const interaction of interactions.slice(-20)) { // Last 20 interactions
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
     * Extract mood signals from text content
     */
    _extractMoodFromText(text) {
        const lower = text.toLowerCase();

        for (const [mood, config] of Object.entries(MOOD_KEYWORDS)) {
            for (const keyword of config.positive) {
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
     * Analyze session behavior for mood indicators
     */
    _analyzeSessionBehavior(patterns) {
        // Fast scrolling = looking for something specific = maybe bored or restless
        if (patterns.scrollSpeed === 'fast') {
            this.moodScores.hype += 0.2;
        }

        // Long reading sessions = engaged and focused
        if (patterns.avgViewTime > 10) { // seconds
            this.moodScores.chill += 0.2;
            this.moodScores.creative += 0.1;
        }

        // Lots of video watching = entertainment mode
        if (patterns.videoViews > patterns.textViews) {
            this.moodScores.funny += 0.15;
            this.moodScores.hype += 0.1;
        }
    }

    /**
     * Analyze recent viewed content
     */
    _analyzeContent(views) {
        for (const view of views.slice(-10)) {
            if (view.content) {
                this._extractMoodFromText(view.content);
            }
            // Weight recent views more
            if (view.timestamp && (Date.now() - view.timestamp < 5 * 60 * 1000)) {
                if (view.content) {
                    this._extractMoodFromText(view.content); // Double count recent
                }
            }
        }
    }

    /**
     * Calculate confidence score
     */
    _calculateConfidence(sortedScores) {
        if (sortedScores.length < 2) return 0;

        const top = sortedScores[0][1];
        const second = sortedScores[1][1];

        if (top === 0) return 0;

        // Confidence = how much higher top mood is compared to second
        const diff = (top - second) / top;
        return Math.min(1, Math.max(0, diff));
    }

    /**
     * Get content filter for a specific mood
     * Returns query modifications for the feed
     */
    static getMoodFilter(mood) {
        const filters = {
            chill: {
                hashtags: { $in: ['#peaceful', '#calm', '#relax', '#vibes', '#cozy'] },
                mediaPrefrence: ['image'],
                sortBias: { 'stats.saves': 1 } // Saved content tends to be calming
            },
            hype: {
                hashtags: { $in: ['#trending', '#viral', '#hot', '#fire', '#lit'] },
                sortBias: { 'stats.likes': -1, velocity: -1 },
                minEngagement: 50
            },
            sad: {
                hashtags: { $in: ['#feels', '#deep', '#relatable', '#mood'] },
                sortBias: { 'stats.comments': -1 } // Discussion-heavy content
            },
            funny: {
                hashtags: { $in: ['#funny', '#meme', '#comedy', '#lol'] },
                mediaPreference: ['video', 'gif'],
                sortBias: { 'stats.shares': -1 }
            },
            creative: {
                hashtags: { $in: ['#art', '#create', '#design', '#music', '#diy'] },
                sortBias: { 'stats.saves': -1, 'stats.comments': -1 }
            }
        };

        return filters[mood] || {};
    }
}

module.exports = MoodDetector;
