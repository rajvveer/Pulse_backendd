const User = require('../models/User');
const Post = require('../models/Post'); // Ensure you have this model
const Follow = require('../models/Follow');
const Notification = require('../models/Notification');
const bcrypt = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const config = require('../config');

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

// ==========================================
// SEARCH USERS
// ==========================================
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json({ success: true, data: [] });
    }

    const searchQuery = q.trim();

    // Search by username or displayName (case-insensitive)
    const users = await User.find({
      $or: [
        { username: { $regex: searchQuery, $options: 'i' } },
        { 'profile.displayName': { $regex: searchQuery, $options: 'i' } }
      ],
      _id: { $ne: req.user.userId } // Exclude current user
    })
      .select('username profile.displayName profile.avatar avatar isVerified')
      .limit(20)
      .lean();

    res.json({ success: true, data: users });
  } catch (error) {
    console.error('❌ Search users error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 1. GET CURRENT USER (With Auto-Fix Logic)
// ==========================================
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-passwordHash -authMethods');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Calculate stats from dedicated collections (scalable)
    const [followerCount, followingCount, postCount] = await Promise.all([
      Follow.getFollowerCount(user._id),
      Follow.getFollowingCount(user._id),
      Post.countDocuments({ author: user._id, isActive: true })
    ]);

    // Sync stats if they drifted
    let needsSave = false;
    if (user.stats.followers !== followerCount) { user.stats.followers = followerCount; needsSave = true; }
    if (user.stats.following !== followingCount) { user.stats.following = followingCount; needsSave = true; }
    if (user.stats.posts !== postCount) { user.stats.posts = postCount; needsSave = true; }

    if (needsSave) {
      console.log(`🔧 Auto-fixed stats for user: ${user.username}`);
      await user.save();
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('GetCurrentUser Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 2. GET USER BY USERNAME
// ==========================================
exports.getUserByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.userId;

    const user = await User.findOne({ username })
      .select('-passwordHash -authMethods -email -phone')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check follow status and get stats from Follow collection
    const [isFollowing, followerCount, followingCount, postCount] = await Promise.all([
      Follow.isFollowing(currentUserId, user._id),
      Follow.getFollowerCount(user._id),
      Follow.getFollowingCount(user._id),
      Post.countDocuments({ author: user._id, isActive: true })
    ]);

    const isOwnProfile = user._id.toString() === currentUserId;

    res.json({
      success: true,
      data: {
        ...user,
        stats: { posts: postCount, followers: followerCount, following: followingCount },
        isFollowing,
        isOwnProfile
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 3. GET USER POSTS (POPULATION FIXED)
// ==========================================
exports.getUserPosts = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { username } = req.params;
    const currentUserId = req.user?.userId; // Current logged-in user

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if viewing own profile or someone else's
    const isOwnProfile = currentUserId && user._id.toString() === currentUserId.toString();

    // Build query - hide anonymous posts from other users
    const query = {
      author: user._id,
      isActive: true  // ✅ Filter out deleted posts
    };

    // Only hide anonymous posts when viewing OTHER users' profiles
    if (!isOwnProfile) {
      query.isAnonymous = false; // ✅ Hide anonymous posts from other users
    }

    const posts = await Post.find(query)
      .populate('author', 'username name avatar profile')
      .sort({ createdAt: -1 }); // Newest first

    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 4. TOGGLE FOLLOW (Atomic Update)
// ==========================================
exports.toggleFollow = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.userId;

    const targetUser = await User.findOne({ username }).select('_id');
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    if (targetUser._id.toString() === currentUserId) {
      return res.status(400).json({ success: false, message: 'Cannot follow yourself' });
    }

    // Atomic toggle using Follow collection
    const { followed, followerCount } = await Follow.toggleFollow(currentUserId, targetUser._id);

    // Sync cached stats on User document
    await User.findByIdAndUpdate(targetUser._id, { 'stats.followers': followerCount });
    const followingCount = await Follow.getFollowingCount(currentUserId);
    await User.findByIdAndUpdate(currentUserId, { 'stats.following': followingCount });

    // Create follow notification
    if (followed) {
      Notification.createNotification({
        recipient: targetUser._id,
        sender: currentUserId,
        type: 'follow',
        message: 'started following you'
      }).catch(err => console.error('Notification error:', err));
    }

    res.json({
      success: true,
      data: { isFollowing: followed }
    });
  } catch (error) {
    console.error('Follow Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 5. UPDATE PROFILE (SYNCED LOGIC)
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    const updates = {};
    // Only allow specific fields to be updated directly
    const allowedFields = [
      // Profile fields
      'profile.displayName',
      'profile.bio',
      'profile.location',
      'profile.website',
      'profile.avatar',
      'profile.coverPhoto',
      'avatar',
      // Settings fields
      'settings.pushNotifications',
      'settings.emailNotifications',
      'settings.notifyOnLike',
      'settings.notifyOnComment',
      'settings.notifyOnFollow',
      'settings.notifyOnMention',
      'settings.theme',
      'settings.radius',
      'settings.shareExactLocation',
      'settings.anonymousPosting',
      // Privacy fields
      'privacy.isPrivate',
      'privacy.showOnlineStatus',
      'privacy.allowMessages',
      'privacy.showEmail',
      'privacy.showPhone',
      'privacy.showLocation',
      'privacy.allowTagging',
    ];

    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key)) {
        updates[key] = req.body[key];

        // ✅ AUTO-SYNC: If profile.avatar is updated, sync it to root avatar
        if (key === 'profile.avatar') updates['avatar'] = req.body[key];
        // ✅ AUTO-SYNC: If root avatar is updated, sync it to profile.avatar
        if (key === 'avatar') updates['profile.avatar'] = req.body[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash -authMethods');

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 6. UPLOAD AVATAR (STRICT SYNC)
// ==========================================
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'pulse/avatars',
        resource_type: 'auto',
        transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }]
      },
      async (error, result) => {
        if (error) {
          return res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
        }

        const user = await User.findByIdAndUpdate(
          req.user.userId,
          {
            'profile.avatar': result.secure_url, // Update profile field
            avatar: result.secure_url            // Update root field (legacy support)
          },
          { new: true }
        ).select('-passwordHash -authMethods');

        // ✅ FIXED: Sending the whole user object ensures the frontend state is fully updated
        res.json({ success: true, data: user });
      }
    );

    require('stream').Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// ==========================================
// 7. GET FOLLOWERS LIST
// ==========================================
exports.getFollowers = async (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findOne({ username }).select('_id');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const follows = await Follow.find({ following: user._id })
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate('follower', 'username profile.displayName profile.avatar avatar isVerified')
      .lean();

    const followers = follows.map(f => f.follower).filter(Boolean);

    res.json({ success: true, data: followers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 8. GET FOLLOWING LIST
// ==========================================
exports.getFollowing = async (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findOne({ username }).select('_id');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const follows = await Follow.find({ follower: user._id })
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .populate('following', 'username profile.displayName profile.avatar avatar isVerified')
      .lean();

    const following = follows.map(f => f.following).filter(Boolean);

    res.json({ success: true, data: following });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 9. CHANGE PASSWORD
// ==========================================
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user.userId).select('+passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // If the account already has a password, the current one must match.
    // (Accounts created purely via Google may not have a password yet.)
    if (user.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required' });
      }
      const matches = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!matches) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 10. DELETE ACCOUNT
// ==========================================
exports.deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Soft-delete: deactivate and scrub identifying / auth data so the
    // account can no longer be logged into, and the username / email /
    // phone are freed up for reuse.
    const suffix = user._id.toString().slice(-6);
    user.isActive = false;
    user.isOnline = false;
    user.email = undefined;
    user.phone = undefined;
    user.username = `deleted_${suffix}`;
    user.passwordHash = undefined;
    user.authMethods = [];
    user.fcmTokens = [];
    if (user.profile) {
      user.profile.displayName = 'Deleted User';
      user.profile.bio = '';
      user.profile.avatar = '';
    }
    await user.save();

    // Best-effort cleanup of the user's content and relationships.
    await Promise.allSettled([
      Post.updateMany({ author: user._id }, { isActive: false }),
      Follow.deleteMany({ $or: [{ follower: user._id }, { following: user._id }] }),
    ]);

    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 11. BLOCK USER
// ==========================================
exports.blockUser = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.userId;

    const target = await User.findOne({ username }).select('_id');
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (target._id.toString() === currentUserId) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself' });
    }

    await User.findByIdAndUpdate(currentUserId, { $addToSet: { blockedUsers: target._id } });

    // Drop any follow relationship in both directions.
    await Promise.allSettled([
      Follow.deleteOne({ follower: currentUserId, following: target._id }),
      Follow.deleteOne({ follower: target._id, following: currentUserId }),
    ]);

    res.json({ success: true, message: 'User blocked' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 12. UNBLOCK USER
// ==========================================
exports.unblockUser = async (req, res) => {
  try {
    const { username } = req.params;

    const target = await User.findOne({ username }).select('_id');
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await User.findByIdAndUpdate(req.user.userId, { $pull: { blockedUsers: target._id } });

    res.json({ success: true, message: 'User unblocked' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// 13. GET BLOCKED USERS
// ==========================================
exports.getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('blockedUsers')
      .populate('blockedUsers', 'username profile.displayName profile.avatar avatar isVerified')
      .lean();

    res.json({ success: true, data: user?.blockedUsers || [] });
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};