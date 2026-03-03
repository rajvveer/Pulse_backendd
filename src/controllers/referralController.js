const mongoose = require('mongoose');
const { createId } = require('@paralleldrive/cuid2');
const User = mongoose.model('User');

// ---------------------------------------------------------------------------
// GET /api/v1/referral/my-code
// Returns the current user's referral code, generating one if it doesn't exist.
// ---------------------------------------------------------------------------
exports.getMyCode = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId || req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Generate code if missing
        if (!user.referralCode) {
            // Short, human-friendly code: first 8 chars of cuid2
            user.referralCode = createId().substring(0, 8).toUpperCase();
            await user.save();
        }

        const shareUrl = `https://getpulse.app/join?ref=${user.referralCode}`;

        res.json({
            success: true,
            data: {
                referralCode: user.referralCode,
                shareUrl,
                shareMessage: `Join me on Pulse — the social app with two sides! Use my code ${user.referralCode} or tap: ${shareUrl}`,
                referralCount: user.referralCount || 0
            }
        });
    } catch (error) {
        console.error('getMyCode error:', error);
        res.status(500).json({ success: false, error: 'Failed to get referral code' });
    }
};

// ---------------------------------------------------------------------------
// POST /api/v1/referral/apply
// Body: { code: "ABC123XY" }
// Links the current user to the referrer and awards badges to both.
// ---------------------------------------------------------------------------
exports.applyCode = async (req, res) => {
    try {
        const { code } = req.body;

        if (!code || typeof code !== 'string') {
            return res.status(400).json({ success: false, error: 'Referral code is required' });
        }

        const currentUser = await User.findById(req.user.userId || req.user._id);
        if (!currentUser) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Already referred?
        if (currentUser.referredBy) {
            return res.status(409).json({ success: false, error: 'You have already used a referral code' });
        }

        // Find referrer
        const referrer = await User.findOne({ referralCode: code.toUpperCase(), isActive: true });
        if (!referrer) {
            return res.status(404).json({ success: false, error: 'Invalid referral code' });
        }

        // Can't refer yourself
        if (referrer._id.toString() === currentUser._id.toString()) {
            return res.status(400).json({ success: false, error: 'You cannot use your own referral code' });
        }

        // Apply referral
        currentUser.referredBy = referrer._id;

        // Award early-adopter badge to current user if they don't have it
        const hasEarlyAdopter = currentUser.badges?.some(b => b.type === 'early-adopter');
        if (!hasEarlyAdopter) {
            currentUser.badges.push({ type: 'early-adopter', earnedAt: new Date() });
        }

        await currentUser.save();

        // Increment referrer's count
        referrer.referralCount = (referrer.referralCount || 0) + 1;

        // Award early-adopter badge to referrer if they don't have it
        const referrerHasBadge = referrer.badges?.some(b => b.type === 'early-adopter');
        if (!referrerHasBadge) {
            referrer.badges.push({ type: 'early-adopter', earnedAt: new Date() });
        }

        await referrer.save();

        res.json({
            success: true,
            message: 'Referral code applied successfully! You both earned an Early Adopter badge 🎉',
            data: {
                referredBy: {
                    username: referrer.username,
                    displayName: referrer.profile?.displayName
                },
                badgeAwarded: !hasEarlyAdopter
            }
        });
    } catch (error) {
        console.error('applyCode error:', error);
        res.status(500).json({ success: false, error: 'Failed to apply referral code' });
    }
};

// ---------------------------------------------------------------------------
// GET /api/v1/referral/stats
// Returns referral count and the list of users who used the current user's code.
// ---------------------------------------------------------------------------
exports.getStats = async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id;

        const user = await User.findById(userId).select('referralCode referralCount');
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Find users who were referred by this user (most recent first, limit 50)
        const referredUsers = await User.find({ referredBy: userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .select('username profile.displayName profile.avatar createdAt')
            .lean();

        res.json({
            success: true,
            data: {
                referralCode: user.referralCode || null,
                totalReferrals: user.referralCount || 0,
                referredUsers: referredUsers.map(u => ({
                    username: u.username,
                    displayName: u.profile?.displayName,
                    avatar: u.profile?.avatar,
                    joinedAt: u.createdAt
                }))
            }
        });
    } catch (error) {
        console.error('getStats error:', error);
        res.status(500).json({ success: false, error: 'Failed to get referral stats' });
    }
};
