const SocialDNA = require('../models/SocialDNA');
const DNAMatchAlgo = require('../Algorithms/DNAMatchAlgo');

// =========================================================
//  GET MY DNA
// =========================================================
exports.getMyDNA = async (req, res) => {
    try {
        const dna = await SocialDNA.getOrCreate(req.user.userId);

        res.json({
            success: true,
            data: {
                strands: dna.strands,
                dominantVibe: dna.dominantVibe,
                totalSignals: dna.totalSignals,
                streak: dna.streak,
                weeksTracked: dna.totalWeeksTracked,
                latestInsights: dna.latestInsights,
                lastComputedAt: dna.lastComputedAt
            }
        });
    } catch (error) {
        console.error('[SocialDNA] getMyDNA error:', error);
        res.status(500).json({ success: false, error: 'Failed to get DNA profile' });
    }
};

// =========================================================
//  GET DNA SHARE CARD DATA
// =========================================================
exports.getShareCard = async (req, res) => {
    try {
        const dna = await SocialDNA.getOrCreate(req.user.userId);
        const cardData = dna.getShareCardData();

        res.json({
            success: true,
            data: cardData
        });
    } catch (error) {
        console.error('[SocialDNA] getShareCard error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate share card' });
    }
};

// =========================================================
//  RECORD CARD SHARE (viral tracking)
// =========================================================
exports.recordShare = async (req, res) => {
    try {
        await SocialDNA.findOneAndUpdate(
            { user: req.user.userId },
            { $inc: { cardShareCount: 1 } }
        );

        res.json({ success: true, message: 'Share recorded' });
    } catch (error) {
        console.error('[SocialDNA] recordShare error:', error);
        res.status(500).json({ success: false, error: 'Failed to record share' });
    }
};

// =========================================================
//  GET DNA EVOLUTION (weekly snapshots)
// =========================================================
exports.getEvolution = async (req, res) => {
    try {
        const dna = await SocialDNA.getOrCreate(req.user.userId);
        const limit = parseInt(req.query.weeks) || 12;

        const snapshots = dna.snapshots.slice(-limit).map(s => ({
            weekStart: s.weekStart,
            weekEnd: s.weekEnd,
            strands: s.strands,
            dominantVibe: s.dominantVibe,
            insights: s.insights,
            totalInteractions: s.totalInteractions
        }));

        res.json({
            success: true,
            data: {
                snapshots,
                currentStrands: dna.strands,
                totalWeeks: dna.totalWeeksTracked
            }
        });
    } catch (error) {
        console.error('[SocialDNA] getEvolution error:', error);
        res.status(500).json({ success: false, error: 'Failed to get evolution data' });
    }
};

// =========================================================
//  GET COMPATIBILITY WITH ANOTHER USER
// =========================================================
exports.getCompatibility = async (req, res) => {
    try {
        const { targetUserId } = req.params;

        if (!targetUserId) {
            return res.status(400).json({ success: false, error: 'Target user ID required' });
        }

        const result = await DNAMatchAlgo.getCompatibility(req.user.userId, targetUserId);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[SocialDNA] getCompatibility error:', error);
        res.status(500).json({ success: false, error: 'Failed to calculate compatibility' });
    }
};

// =========================================================
//  FIND MY DNA TWINS
// =========================================================
exports.findTwins = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const twins = await DNAMatchAlgo.findTwins(req.user.userId, limit);

        res.json({
            success: true,
            data: twins
        });
    } catch (error) {
        console.error('[SocialDNA] findTwins error:', error);
        res.status(500).json({ success: false, error: 'Failed to find DNA twins' });
    }
};

// =========================================================
//  GET ANOTHER USER'S DNA (public profile view)
// =========================================================
exports.getUserDNA = async (req, res) => {
    try {
        const { userId } = req.params;
        const dna = await SocialDNA.findOne({ user: userId });

        if (!dna) {
            return res.json({
                success: true,
                data: null,
                message: 'User has no DNA profile yet'
            });
        }

        // Return public DNA data (no raw signals)
        res.json({
            success: true,
            data: {
                strands: dna.strands,
                dominantVibe: dna.dominantVibe,
                weeksTracked: dna.totalWeeksTracked,
                streak: dna.streak
            }
        });
    } catch (error) {
        console.error('[SocialDNA] getUserDNA error:', error);
        res.status(500).json({ success: false, error: 'Failed to get user DNA' });
    }
};
