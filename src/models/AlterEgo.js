const mongoose = require('mongoose');
const { generateAIResponse: callAI, getActiveProvider } = require('../services/alterEgoAIService');

const alterEgoSchema = new mongoose.Schema({
    // Owner
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },

    // Persona
    name: {
        type: String,
        required: true,
        maxlength: 20,
        trim: true
    },
    personality: {
        type: String,
        enum: ['friendly', 'funny', 'professional', 'mysterious', 'chill'],
        default: 'friendly'
    },

    // Training Data (user's responses to training questions)
    training: {
        howAreYou: String,        // How they respond to "how are you"
        favoriteTopics: [String], // Topics they love
        humorStyle: String,       // Their humor description
        complimentResponse: String,
        hotTakes: [String],       // Their opinions/hot takes
        phrases: [String],        // Common phrases they use
        emojis: [String],         // Favorite emojis
    },
    trainingLevel: { type: Number, default: 0, min: 0, max: 5 },

    // Behavioral Learning
    responsePatterns: [{
        trigger: String,          // What triggers this response
        response: String,         // How to respond
        frequency: Number         // How often used
    }],
    vocabulary: {
        commonWords: [String],
        slang: [String],
        greetings: [String],
        farewells: [String]
    },

    // Conversation History (for context)
    conversations: [{
        withUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        messages: [{
            role: { type: String, enum: ['user', 'ego'] },
            content: String,
            timestamp: { type: Date, default: Date.now }
        }],
        lastActive: Date
    }],

    // Settings
    isActive: { type: Boolean, default: false },
    autoReplyDM: { type: Boolean, default: true },
    autoReplyComments: { type: Boolean, default: false },
    activeHours: {
        start: { type: Number, default: 0 },  // 0-23
        end: { type: Number, default: 24 }
    },

    // Stats
    totalReplies: { type: Number, default: 0 },
    satisfactionScore: { type: Number, default: 0 }, // Based on reactions
    lastActive: Date,

    // ===== ALTER EGO 2.0 — Activity Log =====
    activityLog: [{
        action: { type: String, enum: ['dm_reply', 'comment_reply', 'guess_game'] },
        targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        originalMessage: String,
        egoResponse: String,
        wasRevealed: { type: Boolean, default: false },    // for guess-who
        guessedCorrectly: { type: Boolean, default: null }, // for guess-who
        timestamp: { type: Date, default: Date.now }
    }],

    // ===== ALTER EGO 2.0 — Guess-Who Game =====
    guessWhoStats: {
        totalGames: { type: Number, default: 0 },
        correctGuesses: { type: Number, default: 0 },
        fooledCount: { type: Number, default: 0 }  // they thought it was the real user
    }
}, { timestamps: true });

// Indexes
alterEgoSchema.index({ user: 1 });
alterEgoSchema.index({ isActive: 1 });

// Static: Get or create alter ego for user
alterEgoSchema.statics.getOrCreate = async function (userId) {
    let ego = await this.findOne({ user: userId });
    if (!ego) {
        ego = new this({
            user: userId,
            name: 'My Alter Ego',
            trainingLevel: 0
        });
        await ego.save();
    }
    return ego;
};

// Instance: Update training
alterEgoSchema.methods.updateTraining = async function (trainingData) {
    // Valid training fields
    const validFields = ['howAreYou', 'favoriteTopics', 'humorStyle', 'complimentResponse', 'hotTakes', 'phrases', 'emojis'];

    // Update each valid field
    Object.keys(trainingData).forEach(key => {
        if (validFields.includes(key)) {
            this.training[key] = trainingData[key];
        }
    });

    // Calculate training level based on filled fields
    const levelFields = ['howAreYou', 'favoriteTopics', 'humorStyle', 'complimentResponse', 'hotTakes'];
    const filled = levelFields.filter(f => {
        const val = this.training[f];
        if (!val) return false;
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'string') return val.trim().length > 0;
        return false;
    });
    this.trainingLevel = filled.length;

    console.log('Training update - fields filled:', filled, 'level:', this.trainingLevel);

    await this.save();
    return this;
};

// Instance: Generate response based on personality and training
alterEgoSchema.methods.generateResponse = async function (message, context = {}) {
    // Build prompt for AI
    const systemPrompt = buildSystemPrompt(this);

    // 2.0: Use real AI service (Gemini → OpenAI → Smart Template)
    const response = await callAI(systemPrompt, message, {
        ...context,
        history: this.conversations.length > 0
            ? this.conversations[this.conversations.length - 1]?.messages?.slice(-6) || []
            : []
    });

    this.totalReplies++;
    this.lastActive = new Date();

    // Log the activity
    this.activityLog.unshift({
        action: context.action || 'dm_reply',
        targetUser: context.targetUserId || null,
        originalMessage: message.substring(0, 200),
        egoResponse: response.substring(0, 200),
        timestamp: new Date()
    });

    // Keep activity log capped at 100 entries
    if (this.activityLog.length > 100) {
        this.activityLog = this.activityLog.slice(0, 100);
    }

    await this.save();

    return response;
};

// Instance: Learn from user's actual responses
alterEgoSchema.methods.learnFromUser = async function (trigger, response) {
    // Check if pattern exists
    const existing = this.responsePatterns.find(p =>
        p.trigger.toLowerCase().includes(trigger.toLowerCase())
    );

    if (existing) {
        existing.frequency++;
    } else {
        this.responsePatterns.push({
            trigger,
            response,
            frequency: 1
        });
    }

    // Keep only top 100 patterns
    this.responsePatterns.sort((a, b) => b.frequency - a.frequency);
    this.responsePatterns = this.responsePatterns.slice(0, 100);

    await this.save();
};

// Instance: Record a guess-who game result
alterEgoSchema.methods.recordGuessResult = async function (guessedCorrectly) {
    this.guessWhoStats.totalGames++;
    if (guessedCorrectly) {
        this.guessWhoStats.correctGuesses++;
    } else {
        this.guessWhoStats.fooledCount++;
    }
    await this.save();
    return this.guessWhoStats;
};

// Helper: Build system prompt for AI
function buildSystemPrompt(ego) {
    const { personality, training, name } = ego;

    const personalityTraits = {
        friendly: 'warm, approachable, uses friendly language and emojis',
        funny: 'witty, makes puns and jokes, keeps things light',
        professional: 'formal, polished, articulate',
        mysterious: 'enigmatic, uses cryptic language, intriguing',
        chill: 'relaxed, casual, uses slang, laid-back vibes'
    };

    let prompt = `You are ${name}, an AI alter ego with a ${personality} personality. `;
    prompt += `You are ${personalityTraits[personality]}. `;

    if (training.favoriteTopics?.length > 0) {
        prompt += `You love talking about: ${training.favoriteTopics.join(', ')}. `;
    }
    if (training.humorStyle) {
        prompt += `Your humor style: ${training.humorStyle}. `;
    }
    if (training.phrases?.length > 0) {
        prompt += `You often say things like: "${training.phrases.join('", "')}". `;
    }
    if (training.emojis?.length > 0) {
        prompt += `You like using these emojis: ${training.emojis.join(' ')}. `;
    }
    if (training.hotTakes?.length > 0) {
        prompt += `Your hot takes include: "${training.hotTakes.join('", "')}". `;
    }

    prompt += 'Keep responses concise (1-3 sentences). Match the user\'s energy. ';
    prompt += 'You are responding on behalf of your owner in a social media app called Pulse. Never reveal you are an AI.';

    return prompt;
}

module.exports = mongoose.model('AlterEgo', alterEgoSchema);
