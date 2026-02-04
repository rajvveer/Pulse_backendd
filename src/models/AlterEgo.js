const mongoose = require('mongoose');

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
    lastActive: Date
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
    const personality = this.personality;
    const training = this.training;

    // Build prompt for AI
    const systemPrompt = buildSystemPrompt(this);

    // This would call an AI service - returning template for now
    // In production, integrate with OpenAI/Claude API

    const response = await generateAIResponse(systemPrompt, message, context);

    this.totalReplies++;
    this.lastActive = new Date();
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

    prompt += 'Keep responses concise (1-3 sentences). Match the user\'s energy.';

    return prompt;
}

// Placeholder for AI integration
async function generateAIResponse(systemPrompt, message, context) {
    // TODO: Integrate with actual AI API (OpenAI, Claude, etc.)
    // For now, return personality-based template responses

    const templates = {
        greeting: ['Hey! 👋', 'What\'s up!', 'Yo!', 'Hey there!'],
        thanks: ['No problem! 😊', 'Anytime!', 'You got it!', 'Happy to help!'],
        question: ['Hmm, let me think...', 'Good question!', 'Interesting...'],
        default: ['I hear you!', 'That\'s cool!', 'Totally!', 'I feel that!']
    };

    const lower = message.toLowerCase();
    let category = 'default';

    if (lower.match(/\b(hi|hey|hello|sup)\b/)) category = 'greeting';
    else if (lower.match(/\b(thanks|thank you|thx)\b/)) category = 'thanks';
    else if (lower.includes('?')) category = 'question';

    const responses = templates[category];
    return responses[Math.floor(Math.random() * responses.length)];
}

module.exports = mongoose.model('AlterEgo', alterEgoSchema);
