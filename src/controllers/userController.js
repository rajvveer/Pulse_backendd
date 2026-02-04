const User = require('../models/User');
const Post = require('../models/Post'); // Ensure you have this model
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
    // 1. Get user (remove .lean() so we can save changes)
    const user = await User.findById(req.user.userId).select('-passwordHash -authMethods');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 2. SELF-HEALING: Check if DB stats match actual data
    const realFollowerCount = user.followers ? user.followers.length : 0;
    const realFollowingCount = user.following ? user.following.length : 0;
    const realPostCount = await Post.countDocuments({ author: user._id });

    let needsSave = false;

    // Check Followers
    if (user.stats.followers !== realFollowerCount) {
      user.stats.followers = realFollowerCount;
      needsSave = true;
    }
    // Check Following
    if (user.stats.following !== realFollowingCount) {
      user.stats.following = realFollowingCount;
      needsSave = true;
    }
    // Check Posts
    if (user.stats.posts !== realPostCount) {
      user.stats.posts = realPostCount;
      needsSave = true;
    }

    // 3. Save if we fixed anything
    if (needsSave) {
      console.log(`🔧 Auto-fixed stats for user: ${user.username}`);
      await user.save();
    }

    res.json({
      success: true,
      data: user
    });
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

    // Check if current user is following
    const isFollowing = user.followers?.some(id => id.toString() === currentUserId) || false;
    const isOwnProfile = user._id.toString() === currentUserId;

    // Calculate dynamic stats for display (Double safety)
    const stats = {
      posts: await Post.countDocuments({ author: user._id }),
      followers: user.followers ? user.followers.length : 0,
      following: user.following ? user.following.length : 0
    };

    res.json({
      success: true,
      data: {
        ...user,
        stats, // Send calculated stats
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
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const posts = await Post.find({ author: user._id })
      // ✅ FIXED: Added 'avatar' specifically to the populate string
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

    const targetUser = await User.findOne({ username });
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    if (targetUser._id.toString() === currentUserId) {
      return res.status(400).json({ success: false, message: 'Cannot follow yourself' });
    }

    // Check if already following
    const isFollowing = targetUser.followers?.includes(currentUserId) || false;

    if (isFollowing) {
      // === UNFOLLOW ===
      // 1. Remove ID from Followers Array AND Decrement Count
      await User.findByIdAndUpdate(targetUser._id, { 
        $pull: { followers: currentUserId },
        $inc: { 'stats.followers': -1 } 
      });

      // 2. Remove ID from Following Array AND Decrement Count
      await User.findByIdAndUpdate(currentUserId, { 
        $pull: { following: targetUser._id },
        $inc: { 'stats.following': -1 }
      });

    } else {
      // === FOLLOW ===
      // 1. Add ID to Followers Array AND Increment Count
      await User.findByIdAndUpdate(targetUser._id, { 
        $addToSet: { followers: currentUserId },
        $inc: { 'stats.followers': 1 }
      });

      // 2. Add ID to Following Array AND Increment Count
      await User.findByIdAndUpdate(currentUserId, { 
        $addToSet: { following: targetUser._id },
        $inc: { 'stats.following': 1 }
      });
    }

    res.json({
      success: true,
      data: { isFollowing: !isFollowing }
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
      'profile.displayName', 
      'profile.bio', 
      'profile.location', 
      'profile.website', 
      'profile.avatar',
      'avatar' // Added root level field to allowed updates
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
    const user = await User.findOne({ username })
      .populate({
        path: 'followers',
        select: 'username profile.displayName profile.avatar avatar isVerified' // Added avatar
      });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, data: user.followers });
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
    const user = await User.findOne({ username })
      .populate({
        path: 'following',
        select: 'username profile.displayName profile.avatar avatar isVerified' // Added avatar
      });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, data: user.following });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};