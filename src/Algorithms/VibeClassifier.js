/**
 * VibeClassifier v2.0 — Advanced Post Mood Classification
 *
 * Upgrades:
 *  - Negation handling ("not sad" won't classify as sad)
 *  - N-gram context (multi-word phrase detection)
 *  - Tiered keyword weights (strong vs weak signals)
 *  - Emoji stacking detection (😂😂😂 = stronger)
 *  - Multi-vibe support (primary + secondary vibe)
 *  - Entropy-based confidence calibration
 *
 * Exports are 100% backward-compatible.
 */

// =========================================================
//  NEGATION WORDS
// =========================================================

const NEGATION_WORDS = new Set([
    'not', "n't", 'no', 'never', 'neither', 'nobody', 'nothing',
    'nowhere', 'nor', 'hardly', 'barely', 'scarcely', "don't",
    "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
    "won't", "wouldn't", "shouldn't", "couldn't", "can't", "cannot"
]);

const NEGATION_WINDOW = 3; // Words after a negation that get flipped

// =========================================================
//  KEYWORD PATTERNS — Tiered (strong / weak)
// =========================================================

const VIBE_PATTERNS = {
    chill: {
        strong: [
            'peaceful', 'serene', 'meditation', 'zen', 'tranquil',
            'cozy vibes', 'lazy sunday', 'just chilling'
        ],
        weak: [
            'relax', 'calm', 'cozy', 'vibes', 'sunset', 'sunrise',
            'coffee', 'tea', 'lazy', 'sunday', 'chill', 'quiet',
            'nature', 'beach', 'waves', 'rain', 'sleep', 'rest',
            'breeze', 'cottage', 'lo-fi', 'lofi', 'ambient', 'soothing'
        ],
        emojis: ['😌', '☕', '🌅', '🌄', '🏖️', '🌊', '🌿', '🍃', '💤', '🧘', '🕯️', '🫖'],
        hashtags: ['chill', 'vibes', 'relax', 'peaceful', 'cozy', 'mood', 'aesthetic', 'lofi', 'zen']
    },
    hype: {
        strong: [
            'insane', 'legendary', 'goat', 'banger', 'unreal',
            'lets go', "let's go", 'lfg', 'sickkk', 'no cap'
        ],
        weak: [
            'amazing', 'incredible', 'crazy', 'wild', 'party',
            'excited', 'hyped', 'lit', 'fire', 'best', 'epic',
            'winning', 'dope', 'fire', 'slaps', 'bussin', 'peak',
            'massive', 'electric', 'charged', 'pumped'
        ],
        emojis: ['🔥', '🚀', '💯', '⚡', '🎉', '🙌', '💪', '🏆', '✨', '💥', '🫡', '🤯'],
        hashtags: ['viral', 'trending', 'fire', 'lit', 'hype', 'epic', 'goat', 'bussin', 'peak']
    },
    sad: {
        strong: [
            'heartbreak', 'depressed', 'sobbing', 'devastated', 'heartbroken',
            'crying myself', 'falling apart', 'can\'t stop crying'
        ],
        weak: [
            'sad', 'miss', 'crying', 'alone', 'lonely', 'hurt',
            'feelings', 'feels', 'broken', 'pain', 'tears',
            'gone', 'lost', 'sorry', 'regret', 'memories', 'goodbye',
            'numb', 'empty', 'heavy', 'tired of', 'drained', 'struggling'
        ],
        emojis: ['😢', '😭', '💔', '🥺', '😔', '😞', '🖤', '💧', '🥀', '😿'],
        hashtags: ['feels', 'deep', 'sad', 'mood', 'relatable', 'heartbreak', 'vent', 'overthinking']
    },
    funny: {
        strong: [
            'hilarious', 'lmfao', 'i\'m dead', "i'm dying", 'rofl',
            'no way bruh', 'comedy gold', 'crying laughing'
        ],
        weak: [
            'lol', 'lmao', 'funny', 'joke', 'meme',
            'dead', 'dying', 'haha', 'comedy', 'laughing', 'pranked',
            'clown', 'bruh', 'no way', 'bruhhh', 'ong', 'nah fr',
            'satire', 'roast', 'sarcasm', 'trolling'
        ],
        emojis: ['😂', '🤣', '💀', '😆', '🤡', '😹', '🤪', '😜', '🫠', '☠️'],
        hashtags: ['funny', 'meme', 'comedy', 'lol', 'humor', 'jokes', 'roast', 'sarcasm']
    },
    creative: {
        strong: [
            'masterpiece', 'portfolio', 'composition', 'handmade',
            'original work', 'my creation', 'just finished painting'
        ],
        weak: [
            'art', 'design', 'created', 'made', 'painted', 'drew', 'music',
            'wrote', 'built', 'project', 'craft', 'diy', 'photography',
            'film', 'edit', 'animation', 'sketch', 'illustration',
            'digital art', 'sculpture', 'collage', 'remix'
        ],
        emojis: ['🎨', '✏️', '🎵', '🎬', '📸', '✨', '💡', '🖌️', '🎭', '🎧', '🎹', '📷'],
        hashtags: ['art', 'create', 'design', 'music', 'diy', 'photography', 'creative', 'digital', 'illustration']
    }
};

// =========================================================
//  N-GRAM PHRASES — Detected as single tokens
// =========================================================

const NGRAM_PHRASES = {
    chill: ['lazy sunday', 'cozy vibes', 'peaceful morning', 'good vibes only', 'just vibing', 'stay calm'],
    hype: ["let's go", 'lets go', 'no cap', 'on god', 'for real', 'goes hard', 'so fire', 'too lit'],
    sad: ['falling apart', "can't sleep", 'miss you', 'all alone', 'broke my heart', 'feel like crying'],
    funny: ["i'm dead", "i can't", 'no way', 'bro what', 'nah fr', 'comedy gold', 'not the'],
    creative: ['work in progress', 'just finished', 'original work', 'behind the scenes', 'sneak peek']
};

// =========================================================
//  SIGNAL WEIGHTS
// =========================================================

const WEIGHTS = {
    strongKeyword: 2.5,
    weakKeyword: 1.0,
    ngram: 3.0,
    emoji: 1.5,
    emojiStack: 0.8,   // Extra per repeated emoji beyond first
    hashtag: 2.0
};

// =========================================================
//  HELPER: NEGATION-AWARE TEXT ANALYSIS
// =========================================================

/**
 * Tokenize text and mark negated zones.
 * Returns an array of { word, negated } objects.
 */
function tokenizeWithNegation(text) {
    const words = text.toLowerCase().split(/\s+/);
    const tokens = [];
    let negationCountdown = 0;

    for (const word of words) {
        // Detect inline contractions like "isn't" or "don't"
        const isNegation = NEGATION_WORDS.has(word) || word.endsWith("n't");

        if (isNegation) {
            negationCountdown = NEGATION_WINDOW;
            tokens.push({ word, negated: false, isNegator: true });
        } else {
            tokens.push({ word, negated: negationCountdown > 0, isNegator: false });
            if (negationCountdown > 0) negationCountdown--;
        }
    }

    return tokens;
}

// =========================================================
//  MAIN CLASS
// =========================================================

class VibeClassifier {
    /**
     * Classify a post's vibe based on its content
     * @param {Object} post - Post object with content.text and content.hashtags
     * @returns {Object} { vibe, vibeScore, confidence, secondaryVibe, secondaryConfidence }
     */
    static classify(post) {
        const scores = { chill: 0, hype: 0, sad: 0, funny: 0, creative: 0 };

        const text = (post.content?.text || '').toLowerCase();
        const hashtags = (post.content?.hashtags || []).map(h => h.toLowerCase().replace('#', ''));

        // ── 1. N-gram phrase detection (highest priority) ──
        for (const [vibe, phrases] of Object.entries(NGRAM_PHRASES)) {
            for (const phrase of phrases) {
                if (text.includes(phrase)) {
                    scores[vibe] += WEIGHTS.ngram;
                }
            }
        }

        // ── 2. Negation-aware keyword scoring ──
        const tokens = tokenizeWithNegation(text);
        for (const [vibe, patterns] of Object.entries(VIBE_PATTERNS)) {
            // Strong keywords
            for (const keyword of patterns.strong) {
                const matchToken = tokens.find(t =>
                    t.word === keyword || text.includes(keyword)
                );
                if (matchToken) {
                    // If this keyword is inside a negated zone, penalize instead
                    const negated = tokens.some(t =>
                        t.word.includes(keyword.split(' ')[0]) && t.negated
                    );
                    scores[vibe] += negated ? -WEIGHTS.strongKeyword * 0.5 : WEIGHTS.strongKeyword;
                }
            }

            // Weak keywords — check negation per token
            for (const keyword of patterns.weak) {
                const matchingTokens = tokens.filter(t => t.word === keyword);
                for (const token of matchingTokens) {
                    scores[vibe] += token.negated ? -WEIGHTS.weakKeyword * 0.3 : WEIGHTS.weakKeyword;
                }
            }

            // ── 3. Emoji detection with stacking ──
            for (const emoji of patterns.emojis) {
                const matches = text.match(new RegExp(emoji, 'g'));
                if (matches) {
                    const count = matches.length;
                    // First occurrence = full weight, each extra = stacking bonus
                    scores[vibe] += WEIGHTS.emoji + (count - 1) * WEIGHTS.emojiStack;
                }
            }

            // ── 4. Hashtag matching ──
            for (const tag of patterns.hashtags) {
                if (hashtags.includes(tag)) {
                    scores[vibe] += WEIGHTS.hashtag;
                }
            }
        }

        // ── 5. Media type influence ──
        if (post.content?.media?.length > 0) {
            const mediaTypes = post.content.media.map(m => m.type);
            if (mediaTypes.includes('video')) {
                scores.funny += 0.4;
                scores.hype += 0.4;
            }
            if (mediaTypes.includes('image')) {
                scores.creative += 0.3;
                scores.chill += 0.2;
            }
        }

        // ── 6. Clamp negative scores to 0 ──
        for (const vibe of Object.keys(scores)) {
            scores[vibe] = Math.max(0, scores[vibe]);
        }

        // ── 7. Determine primary and secondary vibes ──
        const sortedVibes = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const topVibe = sortedVibes[0];
        const secondVibe = sortedVibes[1];

        // ── 8. Entropy-based confidence ──
        const confidence = this._calculateEntropy(scores);

        // If no strong signal, mark as general
        const primaryVibe = topVibe[1] >= 1.0 ? topVibe[0] : 'general';
        const secondaryVibe = secondVibe[1] >= 0.5 ? secondVibe[0] : null;

        // Secondary confidence (how strong is the secondary relative to primary)
        const secondaryConfidence = topVibe[1] > 0 && secondVibe[1] > 0
            ? Math.round((secondVibe[1] / topVibe[1]) * 100) / 100
            : 0;

        return {
            vibe: primaryVibe,
            vibeScore: scores,
            confidence,
            secondaryVibe,
            secondaryConfidence
        };
    }

    /**
     * Calculate entropy-based confidence.
     * Low entropy (one dominant vibe) = high confidence.
     * High entropy (even spread) = low confidence.
     * @returns {number} 0–1 confidence score
     */
    static _calculateEntropy(scores) {
        const values = Object.values(scores);
        const total = values.reduce((a, b) => a + b, 0);
        if (total === 0) return 0;

        // Normalize to probabilities
        const probs = values.map(v => v / total);

        // Shannon entropy
        let entropy = 0;
        for (const p of probs) {
            if (p > 0) entropy -= p * Math.log2(p);
        }

        // Max entropy for 5 vibes = log2(5) ≈ 2.32
        const maxEntropy = Math.log2(values.length);
        // Invert: low entropy → high confidence
        const confidence = 1 - (entropy / maxEntropy);

        return Math.round(confidence * 100) / 100;
    }

    /**
     * Classify multiple posts at once
     */
    static classifyBatch(posts) {
        return posts.map(post => ({
            postId: post._id,
            ...this.classify(post)
        }));
    }

    /**
     * Get posts filtered by vibe
     * @param {Array} posts - Array of posts
     * @param {String} vibe - Target vibe
     * @param {Number} minConfidence - Minimum confidence threshold (0-1)
     */
    static filterByVibe(posts, vibe, minConfidence = 0.2) {
        if (vibe === 'auto' || !vibe) return posts;

        return posts.filter(post => {
            // If post already has vibe, use it
            if (post.vibe && post.vibe !== 'general') {
                return post.vibe === vibe;
            }

            // Otherwise classify on the fly
            const classification = this.classify(post);
            // Check primary OR secondary vibe
            const matchesPrimary = classification.vibe === vibe && classification.confidence >= minConfidence;
            const matchesSecondary = classification.secondaryVibe === vibe && classification.secondaryConfidence >= 0.6;
            return matchesPrimary || matchesSecondary;
        }).sort((a, b) => {
            // Sort by vibe score for that specific vibe
            const scoreA = a.vibeScore?.[vibe] || 0;
            const scoreB = b.vibeScore?.[vibe] || 0;
            return scoreB - scoreA;
        });
    }

    /**
     * Boost posts matching a vibe in ranking
     * @param {Array} posts - Array of posts with scores
     * @param {String} vibe - Target vibe
     * @param {Number} boostFactor - How much to boost matching posts
     */
    static boostByVibe(posts, vibe, boostFactor = 1.5) {
        if (vibe === 'auto' || !vibe) return posts;

        return posts.map(post => {
            const matchesVibe = post.vibe === vibe ||
                (post.vibeScore && post.vibeScore[vibe] > 1);

            if (matchesVibe) {
                return {
                    ...post,
                    _score: (post._score || 0) * boostFactor,
                    _vibeMatch: true
                };
            }
            return post;
        });
    }
}

module.exports = VibeClassifier;
