/**
 * AlterEgo AI Service — Real AI Integration for Alter Ego 2.0
 *
 * Supports: Google Gemini (free), OpenAI (fallback), and local template mode
 * The service will gracefully degrade: Gemini → OpenAI → Template
 */

// =========================================================
//  CONFIGURATION
// =========================================================

const AI_CONFIG = {
    // Set these in your .env file
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || null,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,

    // Model settings
    GEMINI_MODEL: 'gemini-1.5-flash',
    OPENAI_MODEL: 'gpt-3.5-turbo',

    // Response limits
    MAX_TOKENS: 150,
    TEMPERATURE: 0.8
};

// =========================================================
//  MAIN FUNCTION
// =========================================================

/**
 * Generate an AI response based on the alter ego's personality
 *
 * @param {string} systemPrompt - Built from the ego's training/personality
 * @param {string} userMessage - The incoming message to reply to
 * @param {Object} context - Additional context (conversation history, etc.)
 * @returns {string} AI-generated response
 */
async function generateAIResponse(systemPrompt, userMessage, context = {}) {
    // Try providers in order of preference
    if (AI_CONFIG.GEMINI_API_KEY) {
        try {
            return await callGemini(systemPrompt, userMessage, context);
        } catch (error) {
            console.error('[AlterEgoAI] Gemini failed, falling back:', error.message);
        }
    }

    if (AI_CONFIG.OPENAI_API_KEY) {
        try {
            return await callOpenAI(systemPrompt, userMessage, context);
        } catch (error) {
            console.error('[AlterEgoAI] OpenAI failed, falling back:', error.message);
        }
    }

    // Fallback to smart template mode
    return generateTemplateResponse(systemPrompt, userMessage, context);
}

// =========================================================
//  GOOGLE GEMINI
// =========================================================

async function callGemini(systemPrompt, userMessage, context) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_CONFIG.GEMINI_MODEL}:generateContent?key=${AI_CONFIG.GEMINI_API_KEY}`;

    const conversationHistory = (context.history || []).map(msg => ({
        role: msg.role === 'ego' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const body = {
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        contents: [
            ...conversationHistory,
            {
                role: 'user',
                parts: [{ text: userMessage }]
            }
        ],
        generationConfig: {
            maxOutputTokens: AI_CONFIG.MAX_TOKENS,
            temperature: AI_CONFIG.TEMPERATURE,
            topP: 0.9
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('Empty Gemini response');
    return text.trim();
}

// =========================================================
//  OPENAI
// =========================================================

async function callOpenAI(systemPrompt, userMessage, context) {
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages = [
        { role: 'system', content: systemPrompt },
        ...(context.history || []).map(msg => ({
            role: msg.role === 'ego' ? 'assistant' : 'user',
            content: msg.content
        })),
        { role: 'user', content: userMessage }
    ];

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AI_CONFIG.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: AI_CONFIG.OPENAI_MODEL,
            messages,
            max_tokens: AI_CONFIG.MAX_TOKENS,
            temperature: AI_CONFIG.TEMPERATURE
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) throw new Error('Empty OpenAI response');
    return text.trim();
}

// =========================================================
//  SMART TEMPLATE FALLBACK
// =========================================================

function generateTemplateResponse(systemPrompt, message, context) {
    const lower = message.toLowerCase();

    // Personality-aware responses
    const isFromFunny = systemPrompt.includes('funny') || systemPrompt.includes('witty');
    const isFromChill = systemPrompt.includes('chill') || systemPrompt.includes('relaxed');
    const isFromProfessional = systemPrompt.includes('professional') || systemPrompt.includes('formal');
    const isFromMysterious = systemPrompt.includes('mysterious') || systemPrompt.includes('enigmatic');

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Detect intent
    if (lower.match(/\b(hi|hey|hello|sup|yo|what'?s up)\b/)) {
        if (isFromFunny) return pick(["Yooo what's good! 😄", "Hey hey! Ready to drop some vibes? 🔥", "Sup! You caught me mid-vibe 😎"]);
        if (isFromChill) return pick(["Heyyy, what's up 🌊", "Yo, good vibes only ✌️", "Hey! Chillin' as always 😌"]);
        if (isFromProfessional) return pick(["Hello! Great to hear from you.", "Hi there! How can I help?", "Good to connect!"]);
        if (isFromMysterious) return pick(["Ah, you've arrived... 🌙", "The stars brought you here ✨", "I sensed your presence..."]);
        return pick(["Hey! 👋", "What's up!", "Hey there! How's it going?"]);
    }

    if (lower.match(/\b(thanks|thank you|thx|ty)\b/)) {
        if (isFromFunny) return pick(["Don't mention it! Well, you just did 😂", "Anytime, legend! 🏆"]);
        if (isFromChill) return pick(["No worries at all ✌️", "You're good, fam 💫"]);
        return pick(["No problem! 😊", "Anytime!", "You got it!"]);
    }

    if (lower.includes('?')) {
        if (isFromFunny) return pick(["Hmm, that's a galaxy brain question 🧠", "Ooh spicy question! Let me think... 🌶️"]);
        if (isFromMysterious) return pick(["The answer lies within... 🔮", "Some questions are better left unanswered... or are they? 🌙"]);
        return pick(["Good question! Let me think about that 🤔", "Hmm, interesting question!", "That's a great one!"]);
    }

    if (lower.match(/\b(love|amazing|awesome|great|perfect|beautiful)\b/)) {
        if (isFromFunny) return pick(["Right?! That slaps! 🔥", "Absolutely fire! No cap 💯"]);
        if (isFromChill) return pick(["Totally agree, positive vibes 🌟", "Love that energy ✨"]);
        return pick(["That's awesome! 🙌", "I love that!", "So true! 💫"]);
    }

    if (lower.match(/\b(sad|miss|lonely|bad day|tough)\b/)) {
        if (isFromFunny) return pick(["Hey, even the best vibes have off days! But you're still a legend 💪", "That's rough, but you know what? Tomorrow's gonna slap 🔥"]);
        if (isFromChill) return pick(["Hey, it's okay to feel that way. Take your time 💙", "Sending good vibes your way 🌊✨"]);
        return pick(["I hear you. It'll get better! 💙", "That's tough, but you got this! 💪"]);
    }

    // Default
    if (isFromFunny) return pick(["Ha, I vibe with that! 😄", "That's giving main character energy 💅", "Not me agreeing 100% 😂"]);
    if (isFromChill) return pick(["I feel that 🫶", "Totally 🌊", "Vibes ✨"]);
    if (isFromProfessional) return pick(["I appreciate your perspective.", "That's a solid point.", "Interesting take!"]);
    if (isFromMysterious) return pick(["Interesting... very interesting 🔮", "The universe agrees ✨", "I see... 🌙"]);

    return pick(["That's cool! ✨", "I hear you!", "Totally!", "I feel that! 🙌"]);
}

// =========================================================
//  UTILITY
// =========================================================

/**
 * Check which AI provider is currently available
 */
function getActiveProvider() {
    if (AI_CONFIG.GEMINI_API_KEY) return 'gemini';
    if (AI_CONFIG.OPENAI_API_KEY) return 'openai';
    return 'template';
}

module.exports = {
    generateAIResponse,
    getActiveProvider,
    AI_CONFIG
};
