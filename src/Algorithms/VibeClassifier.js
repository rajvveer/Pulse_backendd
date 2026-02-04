/**
 * VibeClassifier - Automatically classifies posts into mood categories
 * Used to enable Vibe Check filtering in the feed
 */

// Keyword patterns for each vibe
const VIBE_PATTERNS = {
    chill: {
        keywords: [
            'relax', 'peaceful', 'calm', 'cozy', 'vibes', 'sunset', 'sunrise',
            'coffee', 'tea', 'lazy', 'sunday', 'chill', 'quiet', 'serene',
            'nature', 'beach', 'waves', 'rain', 'sleep', 'rest', 'meditation'
        ],
        emojis: ['😌', '☕', '🌅', '🌄', '🏖️', '🌊', '🌿', '🍃', '💤', '🧘'],
        hashtags: ['chill', 'vibes', 'relax', 'peaceful', 'cozy', 'mood', 'aesthetic']
    },
    hype: {
        keywords: [
            'amazing', 'incredible', 'insane', 'crazy', 'wild', 'party',
            'excited', 'hyped', 'lit', 'fire', 'best', 'epic', 'legendary',
            'winning', 'lets go', 'lfg', 'sickkk', 'goat', 'banger'
        ],
        emojis: ['🔥', '🚀', '💯', '⚡', '🎉', '🙌', '💪', '🏆', '✨', '💥'],
        hashtags: ['viral', 'trending', 'fire', 'lit', 'hype', 'epic', 'goat']
    },
    sad: {
        keywords: [
            'sad', 'miss', 'crying', 'alone', 'lonely', 'heartbreak', 'hurt',
            'depressed', 'feelings', 'feels', 'broken', 'pain', 'tears',
            'gone', 'lost', 'sorry', 'regret', 'memories', 'goodbye'
        ],
        emojis: ['😢', '😭', '💔', '🥺', '😔', '😞', '🖤', '💧'],
        hashtags: ['feels', 'deep', 'sad', 'mood', 'relatable', 'heartbreak']
    },
    funny: {
        keywords: [
            'lol', 'lmao', 'rofl', 'hilarious', 'funny', 'joke', 'meme',
            'dead', 'dying', 'haha', 'comedy', 'laughing', 'pranked',
            'clown', 'bruh', 'no way', 'bruhhh'
        ],
        emojis: ['😂', '🤣', '💀', '😆', '🤡', '😹', '🤪', '😜'],
        hashtags: ['funny', 'meme', 'comedy', 'lol', 'humor', 'jokes']
    },
    creative: {
        keywords: [
            'art', 'design', 'created', 'made', 'painted', 'drew', 'music',
            'wrote', 'built', 'project', 'craft', 'diy', 'photography',
            'film', 'edit', 'animation', 'sketch', 'composition'
        ],
        emojis: ['🎨', '✏️', '🎵', '🎬', '📸', '✨', '💡', '🖌️', '🎭'],
        hashtags: ['art', 'create', 'design', 'music', 'diy', 'photography', 'creative']
    }
};

// Weights for different signal types
const WEIGHTS = {
    keyword: 1.0,
    emoji: 1.5,
    hashtag: 2.0
};

class VibeClassifier {
    /**
     * Classify a post's vibe based on its content
     * @param {Object} post - Post object with content.text and content.hashtags
     * @returns {Object} { vibe, scores, confidence }
     */
    static classify(post) {
        const scores = {
            chill: 0,
            hype: 0,
            sad: 0,
            funny: 0,
            creative: 0
        };

        const text = (post.content?.text || '').toLowerCase();
        const hashtags = (post.content?.hashtags || []).map(h => h.toLowerCase());

        // Analyze each vibe pattern
        for (const [vibe, patterns] of Object.entries(VIBE_PATTERNS)) {
            // Check keywords
            for (const keyword of patterns.keywords) {
                if (text.includes(keyword)) {
                    scores[vibe] += WEIGHTS.keyword;
                }
            }

            // Check emojis
            for (const emoji of patterns.emojis) {
                const count = (text.match(new RegExp(emoji, 'g')) || []).length;
                scores[vibe] += count * WEIGHTS.emoji;
            }

            // Check hashtags
            for (const tag of patterns.hashtags) {
                if (hashtags.includes(tag)) {
                    scores[vibe] += WEIGHTS.hashtag;
                }
            }
        }

        // Media type influences
        if (post.content?.media?.length > 0) {
            const mediaTypes = post.content.media.map(m => m.type);
            if (mediaTypes.includes('video')) {
                scores.funny += 0.3; // Videos often funny
                scores.hype += 0.3;
            }
            if (mediaTypes.includes('image')) {
                scores.creative += 0.2;
                scores.chill += 0.2;
            }
        }

        // Find primary vibe
        const sortedVibes = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const topVibe = sortedVibes[0];
        const secondVibe = sortedVibes[1];

        // Calculate confidence
        const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
        const confidence = totalScore > 0 ? topVibe[1] / totalScore : 0;

        // If no strong signal, mark as general
        const primaryVibe = topVibe[1] >= 1 ? topVibe[0] : 'general';

        return {
            vibe: primaryVibe,
            vibeScore: scores,
            confidence: Math.round(confidence * 100) / 100
        };
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
            return classification.vibe === vibe && classification.confidence >= minConfidence;
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
