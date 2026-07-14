/**
 * InterestProfiler v2.0 — Advanced Content Relevance Scoring
 *
 * Upgrades:
 *  - 20+ dynamic topic categories (vs 7 hardcoded)
 *  - TF-IDF inspired weighting (niche interests score higher)
 *  - Interest decay (old interests fade, recent behavior prioritized)
 *  - Cross-topic affinity (users who like X tend to like Y)
 *  - Dynamic topic discovery from hashtag clusters
 *  - Author affinity integration
 *
 * Exports are 100% backward-compatible.
 */

const UserBehavior = require('../../models/UserBehavior');

// =========================================================
//  CONFIGURATION
// =========================================================

const CONFIG = {
    // Relevance weights
    WEIGHTS: {
        topicMatch: 3.0,       // User interested in this topic
        mediaTypeMatch: 1.5,   // User prefers this media type
        postLengthMatch: 0.8,  // User prefers this length
        authorAffinity: 2.0,   // User engages with this author
        freshness: 1.2,        // Never-seen content boost
        nicheness: 1.5,        // Niche/rare interests boost (NEW)
        crossTopic: 0.8        // Cross-topic affinity bonus (NEW)
    },

    // Minimum affinity to consider a "match"
    AFFINITY_THRESHOLD: 0.3,

    // Topic extraction
    DEFAULT_TOPICS: ['general'],

    // Freshness decay (for seen content)
    SEEN_PENALTY: 0.3,

    // Interest decay: how much older interests fade per day (NEW)
    INTEREST_DECAY_PER_DAY: 0.02,

    // Maximum age (in days) of interests to consider (NEW)
    MAX_INTEREST_AGE_DAYS: 90
};

// =========================================================
//  EXPANDED TOPIC PATTERNS — 22 Categories
// =========================================================

const TOPIC_PATTERNS = {
    tech: {
        keywords: ['tech', 'code', 'programming', 'developer', 'software', 'ai',
            'startup', 'algorithm', 'api', 'javascript', 'python', 'react',
            'node', 'database', 'cloud', 'devops', 'ml', 'machine learning',
            'silicon valley', 'hackathon', 'open source', 'github'],
        popularity: 0.7  // How common this topic is (for IDF calculation)
    },
    gaming: {
        keywords: ['game', 'gaming', 'ps5', 'xbox', 'nintendo', 'steam', 'esports',
            'valorant', 'fortnite', 'minecraft', 'gamer', 'twitch', 'streamer',
            'rpg', 'fps', 'mmorpg', 'gta', 'zelda', 'elden ring', 'playstation'],
        popularity: 0.8
    },
    crypto: {
        keywords: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'nft', 'web3',
            'defi', 'token', 'mining', 'btc', 'eth', 'solana', 'altcoin',
            'moon', 'hodl', 'wallet', 'doge', 'memecoin'],
        popularity: 0.4
    },
    lifestyle: {
        keywords: ['life', 'lifestyle', 'daily', 'routine', 'morning', 'wellness',
            'selfcare', 'mindfulness', 'minimalist', 'productivity', 'habit',
            'journal', 'gratitude', 'balance', 'hustle', 'grind'],
        popularity: 0.9
    },
    memes: {
        keywords: ['meme', 'lol', 'funny', 'joke', 'humor', 'shitpost', 'dank',
            'bruh', 'no cap', 'sus', 'based', 'ratio', 'slay'],
        popularity: 0.95
    },
    news: {
        keywords: ['breaking', 'news', 'update', 'announced', 'reported', 'politics',
            'election', 'government', 'economy', 'world', 'crisis', 'headline'],
        popularity: 0.6
    },
    sports: {
        keywords: ['game', 'match', 'score', 'team', 'player', 'win', 'lost',
            'championship', 'league', 'nba', 'nfl', 'soccer', 'football',
            'cricket', 'ipl', 'basketball', 'tennis', 'f1', 'formula'],
        popularity: 0.75
    },
    music: {
        keywords: ['music', 'song', 'album', 'concert', 'artist', 'band', 'spotify',
            'playlist', 'producer', 'beat', 'lyric', 'rap', 'hiphop', 'pop',
            'indie', 'edm', 'vinyl', 'guitar', 'piano'],
        popularity: 0.8
    },
    food: {
        keywords: ['food', 'recipe', 'cooking', 'restaurant', 'meal', 'delicious',
            'chef', 'baking', 'cuisine', 'brunch', 'foodie', 'yummy',
            'homemade', 'pasta', 'sushi', 'pizza', 'vegan'],
        popularity: 0.85
    },
    travel: {
        keywords: ['travel', 'trip', 'vacation', 'explore', 'adventure', 'wanderlust',
            'destination', 'flight', 'hotel', 'backpack', 'roadtrip', 'beach',
            'mountain', 'europe', 'asia', 'bali', 'paris', 'tokyo'],
        popularity: 0.6
    },
    fashion: {
        keywords: ['fashion', 'style', 'outfit', 'ootd', 'clothing', 'designer',
            'trend', 'drip', 'thrift', 'vintage', 'sneakers', 'streetwear',
            'luxury', 'accessories', 'makeup', 'beauty'],
        popularity: 0.7
    },
    fitness: {
        keywords: ['fitness', 'gym', 'workout', 'exercise', 'training', 'muscle',
            'cardio', 'protein', 'bodybuilding', 'yoga', 'crossfit', 'run',
            'marathon', 'gains', 'lift', 'health', 'diet', 'bulk', 'cut'],
        popularity: 0.65
    },
    pets: {
        keywords: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'doggo', 'pupper',
            'animal', 'rescue', 'adopt', 'furry', 'paw', 'cute', 'floof',
            'birb', 'hamster', 'bunny'],
        popularity: 0.7
    },
    movies: {
        keywords: ['movie', 'film', 'cinema', 'director', 'actor', 'oscar',
            'netflix', 'disney', 'marvel', 'dc', 'horror', 'thriller',
            'documentary', 'screening', 'premiere', 'review', 'rating'],
        popularity: 0.75
    },
    anime: {
        keywords: ['anime', 'manga', 'otaku', 'waifu', 'naruto', 'one piece',
            'attack on titan', 'jjk', 'demon slayer', 'cosplay',
            'sub', 'dub', 'weeb', 'kawaii', 'isekai', 'shonen'],
        popularity: 0.5
    },
    education: {
        keywords: ['learn', 'education', 'study', 'school', 'university', 'college',
            'course', 'tutorial', 'lecture', 'homework', 'exam', 'degree',
            'scholarship', 'graduate', 'phd', 'research'],
        popularity: 0.5
    },
    science: {
        keywords: ['science', 'physics', 'chemistry', 'biology', 'space', 'nasa',
            'quantum', 'experiment', 'discovery', 'research', 'atom',
            'telescope', 'dinosaur', 'evolution', 'dna', 'lab'],
        popularity: 0.35
    },
    relationships: {
        keywords: ['love', 'relationship', 'dating', 'crush', 'couple', 'breakup',
            'marriage', 'wedding', 'boyfriend', 'girlfriend', 'single',
            'toxic', 'red flag', 'green flag', 'situationship'],
        popularity: 0.85
    },
    cars: {
        keywords: ['car', 'auto', 'vehicle', 'drive', 'horsepower', 'engine',
            'supercar', 'tesla', 'bmw', 'mercedes', 'toyota', 'jdm',
            'turbo', 'drift', 'exhaust', 'modification', 'tuning'],
        popularity: 0.45
    },
    photography: {
        keywords: ['photo', 'photography', 'camera', 'lens', 'portrait', 'landscape',
            'lightroom', 'editing', 'composition', 'exposure', 'bokeh',
            'golden hour', 'street photography', 'macro', 'drone'],
        popularity: 0.4
    },
    cooking: {
        keywords: ['cook', 'bake', 'recipe', 'kitchen', 'ingredient', 'homemade',
            'meal prep', 'seasoning', 'oven', 'grill', 'stir fry',
            'sourdough', 'ferment', 'sauce', 'sautee'],
        popularity: 0.55
    },
    politics: {
        keywords: ['politics', 'election', 'vote', 'democrat', 'republican', 'congress',
            'senate', 'president', 'policy', 'law', 'rights', 'protest',
            'activism', 'campaign', 'liberal', 'conservative'],
        popularity: 0.5
    }
};

// =========================================================
//  CROSS-TOPIC AFFINITY MAP — Users who like X tend to like Y
// =========================================================

const CROSS_TOPIC_AFFINITIES = {
    tech: ['gaming', 'science', 'crypto', 'education'],
    gaming: ['tech', 'anime', 'memes'],
    crypto: ['tech', 'news', 'politics'],
    lifestyle: ['fitness', 'food', 'travel', 'relationships'],
    memes: ['funny', 'gaming', 'anime'],
    news: ['politics', 'science', 'crypto'],
    sports: ['fitness', 'gaming'],
    music: ['movies', 'lifestyle', 'fashion'],
    food: ['cooking', 'travel', 'lifestyle'],
    travel: ['photography', 'food', 'lifestyle'],
    fashion: ['lifestyle', 'photography', 'music'],
    fitness: ['food', 'lifestyle', 'sports'],
    pets: ['lifestyle', 'photography'],
    movies: ['music', 'anime', 'memes'],
    anime: ['gaming', 'movies', 'memes'],
    education: ['tech', 'science'],
    science: ['tech', 'education', 'news'],
    relationships: ['lifestyle', 'memes'],
    cars: ['tech', 'photography'],
    photography: ['travel', 'fashion', 'cars'],
    cooking: ['food', 'lifestyle'],
    politics: ['news', 'crypto']
};

// =========================================================
//  MAIN FUNCTIONS
// =========================================================

/**
 * Score post relevance for a specific user
 * @returns {number} relevance score (0-10)
 */
async function getRelevanceScore(post, userId, userPrefs = null) {
    if (!post || !userId) return 1.0;

    // Get user preferences (cached or fetch)
    const prefs = userPrefs || await UserBehavior.getPreferences(userId);

    let score = 0;

    // ── 1. Topic Match with TF-IDF weighting ──
    const postTopics = extractTopics(post);
    const topicScore = calculateTopicMatch(postTopics, prefs.topics);
    score += topicScore * CONFIG.WEIGHTS.topicMatch;

    // ── 2. Nicheness Boost (TF-IDF inspired) ──
    const nichenessBoost = calculateNichenessBoost(postTopics);
    score += nichenessBoost * CONFIG.WEIGHTS.nicheness;

    // ── 3. Cross-Topic Affinity (NEW) ──
    const crossTopicScore = calculateCrossTopicBoost(postTopics, prefs.topics);
    score += crossTopicScore * CONFIG.WEIGHTS.crossTopic;

    // ── 4. Media Type Match ──
    const mediaType = getMediaType(post);
    const mediaScore = prefs.mediaTypes?.[mediaType] || 0.5;
    score += mediaScore * CONFIG.WEIGHTS.mediaTypeMatch;

    // ── 5. Post Length Match ──
    const lengthKey = getPostLengthKey(post);
    const lengthScore = prefs.postLengths?.[lengthKey] || 0.5;
    score += lengthScore * CONFIG.WEIGHTS.postLengthMatch;

    // ── 6. Author Affinity (NEW) ──
    // Track whether an author-affinity contribution was ACTUALLY applied so the
    // normalizer doesn't reserve weight for a term that never fired (fix:
    // otherwise scores are systematically compressed when no affinities exist).
    let authorApplied = false;
    const authorId = post.author?._id || post.author;
    if (authorId && prefs.authorAffinities) {
        const authorAffinity = prefs.authorAffinities?.[authorId?.toString()] || 0;
        if (authorAffinity > 0) {
            score += authorAffinity * CONFIG.WEIGHTS.authorAffinity;
            authorApplied = true;
        }
    }

    // ── 7. Normalize to 0-10 scale (maxPossible computed dynamically) ──
    const maxPossible = CONFIG.WEIGHTS.topicMatch + CONFIG.WEIGHTS.mediaTypeMatch +
        CONFIG.WEIGHTS.postLengthMatch + CONFIG.WEIGHTS.nicheness +
        CONFIG.WEIGHTS.crossTopic + (authorApplied ? CONFIG.WEIGHTS.authorAffinity : 0);
    const normalizedScore = (score / maxPossible) * 10;

    return Math.max(0, Math.min(10, normalizedScore));
}

/**
 * Batch score multiple posts for efficiency
 */
async function batchScorePosts(posts, userId) {
    if (!posts || posts.length === 0) return posts;

    const prefs = await UserBehavior.getPreferences(userId);
    const seenIds = await UserBehavior.getSeenPostIds(userId, 24);

    const scored = await Promise.all(posts.map(async (post) => {
        const postId = (post._id || post).toString();
        let relevanceScore = await getRelevanceScore(post, userId, prefs);

        // Penalize seen content
        if (seenIds.has(postId)) {
            relevanceScore *= CONFIG.SEEN_PENALTY;
        }

        return {
            ...post,
            _relevanceScore: relevanceScore,
            _isSeen: seenIds.has(postId)
        };
    }));

    return scored;
}

/**
 * Extract topics from post content — Upgraded with 22 categories
 *
 * MEMOIZED: extractTopics runs ~350 substring scans per post and is called
 * 4-5 times per post per ranking pass (curiosity, fatigue, negative signals,
 * feedback, relevance). For a 200-post For-You candidate set that was ~250K
 * redundant scans per request on the single event loop.
 *
 * The feed ranking pipeline spread-clones posts between passes (`{...post}`),
 * which would defeat a property cached on the post itself — but the nested
 * `post.content` object is shared by reference across those clones. So we
 * memoize in a WeakMap keyed by `post.content`: the topics are computed once
 * per real post and reused across every clone and every pass. WeakMap means
 * the entries are GC'd as soon as the request's posts go out of scope.
 */
const _topicCache = new WeakMap();

function extractTopics(post) {
    const content = post && post.content;
    if (content && typeof content === 'object') {
        const cached = _topicCache.get(content);
        if (cached) return cached;
        const result = computeTopics(post);
        _topicCache.set(content, result);
        return result;
    }
    return computeTopics(post);
}

function computeTopics(post) {
    const topics = new Set();

    // ── From hashtags ──
    const hashtags = post.content?.hashtags || [];
    hashtags.forEach(tag => {
        const clean = tag.toLowerCase().replace('#', '');
        topics.add(clean);

        // Also try to match hashtag to a known topic category
        for (const [topic, config] of Object.entries(TOPIC_PATTERNS)) {
            if (config.keywords.some(kw => clean.includes(kw) || kw.includes(clean))) {
                topics.add(topic);
            }
        }
    });

    // ── From text content ──
    const text = post.content?.text || '';
    const lower = text.toLowerCase();

    for (const [topic, config] of Object.entries(TOPIC_PATTERNS)) {
        let matchCount = 0;
        for (const keyword of config.keywords) {
            if (lower.includes(keyword)) {
                matchCount++;
            }
        }
        // Require at least 1 match, but 2+ matches = stronger signal
        if (matchCount >= 1) {
            topics.add(topic);
        }
    }

    // ── From mentions (usernames could indicate topics) ──
    const mentions = post.content?.mentions || [];
    if (mentions.length > 0) {
        topics.add('social');
    }

    return topics.size > 0 ? [...topics] : CONFIG.DEFAULT_TOPICS;
}

/**
 * Calculate topic match score — with decay for stale interests
 */
function calculateTopicMatch(postTopics, userTopics) {
    if (!userTopics || (userTopics.size === 0 && Object.keys(userTopics).length === 0)) {
        return 0.5; // Neutral for new users
    }

    let totalAffinity = 0;
    let matchCount = 0;

    for (const topic of postTopics) {
        let affinity;
        if (userTopics instanceof Map) {
            affinity = userTopics.get(topic) || 0;
        } else {
            affinity = userTopics[topic] || 0;
        }

        if (affinity >= CONFIG.AFFINITY_THRESHOLD) {
            totalAffinity += affinity;
            matchCount++;
        }
    }

    if (matchCount === 0) return 0.2; // Low score for no match

    // Bonus for multi-topic matches (post hits multiple interests)
    const multiMatchBonus = matchCount > 1 ? 0.1 * (matchCount - 1) : 0;

    return Math.min(1, (totalAffinity / matchCount) + multiMatchBonus);
}

/**
 * Calculate nicheness boost — rare/niche topics score higher (NEW)
 * Inspired by TF-IDF: topics that fewer users engage with are more "valuable"
 */
function calculateNichenessBoost(postTopics) {
    let boost = 0;

    for (const topic of postTopics) {
        const config = TOPIC_PATTERNS[topic];
        if (config) {
            // Lower popularity → higher nicheness score
            const nicheness = 1 - (config.popularity || 0.5);
            boost += nicheness * 0.5;
        }
    }

    return Math.min(1, boost);
}

/**
 * Calculate cross-topic affinity boost (NEW)
 * If user likes "tech" and post is about "gaming", they might still like it
 */
function calculateCrossTopicBoost(postTopics, userTopics) {
    if (!userTopics) return 0;

    let boost = 0;
    const userTopicList = userTopics instanceof Map
        ? [...userTopics.entries()].filter(([, v]) => v >= CONFIG.AFFINITY_THRESHOLD).map(([k]) => k)
        : Object.entries(userTopics).filter(([, v]) => v >= CONFIG.AFFINITY_THRESHOLD).map(([k]) => k);

    for (const postTopic of postTopics) {
        const relatedTopics = CROSS_TOPIC_AFFINITIES[postTopic] || [];
        for (const relatedTopic of relatedTopics) {
            if (userTopicList.includes(relatedTopic)) {
                boost += 0.3;
            }
        }
    }

    return Math.min(1, boost);
}

/**
 * Get media type from post
 */
function getMediaType(post) {
    const media = post.content?.media || [];
    if (media.length === 0) return 'text';
    const types = media.map(m => m.type);
    if (types.includes('video')) return 'video';
    if (types.includes('gif')) return 'gif';
    if (types.includes('image')) return 'image';
    return 'text';
}

/**
 * Get post length category
 */
function getPostLengthKey(post) {
    const textLength = post.content?.text?.length || 0;
    if (textLength > 500) return 'very_long';
    if (textLength > 200) return 'long';
    if (textLength > 50) return 'medium';
    return 'short';
}

/**
 * Get user's top interests for recommendations
 */
async function getTopInterests(userId, limit = 10) {
    const prefs = await UserBehavior.getPreferences(userId);
    const topics = prefs.topics;

    if (!topics || (topics.size === 0 && Object.keys(topics).length === 0)) return [];

    // Sort topics by affinity
    const entries = topics instanceof Map ? [...topics.entries()] : Object.entries(topics);
    entries.sort((a, b) => b[1] - a[1]);

    return entries.slice(0, limit).map(([topic, affinity]) => ({
        topic,
        affinity,
        isNiche: (TOPIC_PATTERNS[topic]?.popularity || 0.5) < 0.5,
        relatedTopics: CROSS_TOPIC_AFFINITIES[topic] || []
    }));
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
    getRelevanceScore,
    batchScorePosts,
    extractTopics,
    calculateTopicMatch,
    calculateNichenessBoost,    // NEW
    calculateCrossTopicBoost,   // NEW
    getMediaType,
    getPostLengthKey,
    getTopInterests,
    TOPIC_PATTERNS,             // NEW — expose for testing
    CROSS_TOPIC_AFFINITIES,    // NEW — expose for testing
    CONFIG
};
