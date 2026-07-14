const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Post = require('../models/Post');
const Reel = require('../models/Reel');
const Like = require('../models/Like');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Session = require('../models/Session');
const PulseDrop = require('../models/PulseDrop');
const authService = require('../services/authService');
const cacheService = require('../services/cacheService');
const escapeRegex = require('../utils/escapeRegex');

// ==========================================
// AUTH — Admin login with username/email + password
// ==========================================
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Identifier and password are required' });
    }

    const user = await User.findOne({
      $or: [
        { username: String(identifier).toLowerCase().trim() },
        { email: String(identifier).toLowerCase().trim() }
      ],
      isActive: true
    }).select('+passwordHash');

    // Same error for every failure mode — don't reveal which part was wrong
    const invalid = () => res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user || !user.passwordHash) return invalid();
    if (user.role !== 'admin') return invalid();

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) return invalid();

    const sessionResult = await authService.createUserSession(
      user,
      {
        deviceId: `admin-panel-${crypto.randomBytes(8).toString('hex')}`,
        platform: 'web',
        deviceName: 'Admin Panel'
      },
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      data: {
        tokens: sessionResult.tokens,
        user: {
          _id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar: user.profile?.avatar || user.avatar || null
        }
      }
    });
  } catch (error) {
    console.error('Admin login error:', error.message);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ==========================================
// DASHBOARD STATS
// ==========================================
exports.getStats = async (req, res) => {
  try {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const dailyAgg = (Model) => Model.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    const [
      totalUsers, activeUsers, totalPosts, activePosts, totalReels,
      totalMessages, totalConversations, activeSessions, activeDrops,
      signupsByDay, postsByDay
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      Post.countDocuments({}),
      Post.countDocuments({ isActive: true }),
      Reel.countDocuments({}),
      Message.countDocuments({}),
      Conversation.countDocuments({}),
      Session.countDocuments({ isActive: true, expiresAt: { $gt: new Date() } }),
      PulseDrop.countDocuments({ status: 'active' }),
      dailyAgg(User),
      dailyAgg(Post)
    ]);

    res.json({
      success: true,
      data: {
        totals: {
          users: totalUsers,
          activeUsers,
          bannedUsers: totalUsers - activeUsers,
          posts: totalPosts,
          activePosts,
          reels: totalReels,
          messages: totalMessages,
          conversations: totalConversations,
          activeSessions,
          activeDrops
        },
        charts: {
          signupsByDay: signupsByDay.map(d => ({ date: d._id, count: d.count })),
          postsByDay: postsByDay.map(d => ({ date: d._id, count: d.count }))
        }
      }
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
};

// ==========================================
// USER MANAGEMENT
// ==========================================
exports.listUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const { q, role, status } = req.query;

    const query = {};
    if (q && q.trim()) {
      const safe = escapeRegex(q.trim());
      query.$or = [
        { username: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
        { 'profile.displayName': { $regex: safe, $options: 'i' } }
      ];
    }
    if (role && ['user', 'admin', 'moderator'].includes(role)) query.role = role;
    if (status === 'active') query.isActive = true;
    if (status === 'banned') query.isActive = false;

    const [users, total] = await Promise.all([
      User.find(query)
        .select('username email phone role isActive isVerified isOnline lastActive createdAt stats profile.displayName profile.avatar avatar')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Admin list users error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load users' });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive (boolean) is required' });
    }
    if (userId === req.user.userId) {
      return res.status(400).json({ success: false, message: 'You cannot change your own account status' });
    }

    const user = await User.findByIdAndUpdate(userId, { $set: { isActive } }, { new: true })
      .select('username role isActive');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!isActive) {
      // Kill the user's sessions and the auth cache so the ban takes effect
      // immediately instead of after token/cache expiry
      await Session.updateMany({ userId, isActive: true }, { $set: { isActive: false } });
      try { await cacheService.del(`auth_user:${userId}`); } catch (e) { /* cache miss is fine */ }
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Admin update user status error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['user', 'admin', 'moderator'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role must be user, admin, or moderator' });
    }
    if (userId === req.user.userId) {
      return res.status(400).json({ success: false, message: 'You cannot change your own role' });
    }

    const user = await User.findByIdAndUpdate(userId, { $set: { role } }, { new: true })
      .select('username role isActive');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Admin update user role error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update role' });
  }
};

// ==========================================
// POST MODERATION
// ==========================================
exports.listPosts = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const { q, status } = req.query;

    const query = {};
    if (q && q.trim()) {
      query['content.text'] = { $regex: escapeRegex(q.trim()), $options: 'i' };
    }
    if (status === 'active') query.isActive = true;
    if (status === 'removed') query.isActive = false;

    const [posts, total] = await Promise.all([
      Post.find(query)
        .select('content visibility isActive isAnonymous stats createdAt author')
        .populate('author', 'username profile.avatar avatar')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Post.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: posts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Admin list posts error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load posts' });
  }
};

exports.updatePostStatus = async (req, res) => {
  try {
    const { postId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive (boolean) is required' });
    }

    const post = await Post.findByIdAndUpdate(postId, { $set: { isActive } }, { new: true })
      .select('isActive author content.text');
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.json({ success: true, data: post });
  } catch (error) {
    console.error('Admin update post status error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update post' });
  }
};

// ==========================================
// REEL MODERATION
// ==========================================
exports.listReels = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const { q } = req.query;

    const query = {};
    if (q && q.trim()) {
      query.caption = { $regex: escapeRegex(q.trim()), $options: 'i' };
    }

    const [reels, total] = await Promise.all([
      Reel.find(query)
        .select('caption videoUrl stats duration hashtags createdAt user')
        .populate('user', 'username profile.avatar avatar')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Reel.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: reels,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Admin list reels error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load reels' });
  }
};

exports.deleteReel = async (req, res) => {
  try {
    const { reelId } = req.params;

    const reel = await Reel.findByIdAndDelete(reelId);
    if (!reel) {
      return res.status(404).json({ success: false, message: 'Reel not found' });
    }

    // Clean up associated likes (Reel has no soft-delete flag)
    await Like.deleteMany({ targetType: 'reel', targetId: reelId });

    res.json({ success: true, message: 'Reel deleted' });
  } catch (error) {
    console.error('Admin delete reel error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete reel' });
  }
};

// ==========================================
// PULSE DROPS
// ==========================================
exports.listDrops = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

    const [drops, total] = await Promise.all([
      PulseDrop.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PulseDrop.countDocuments({})
    ]);

    res.json({
      success: true,
      data: drops,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Admin list drops error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to load drops' });
  }
};

exports.expireDrop = async (req, res) => {
  try {
    const { dropId } = req.params;

    const drop = await PulseDrop.findByIdAndUpdate(
      dropId,
      { $set: { status: 'expired' } },
      { new: true }
    );
    if (!drop) {
      return res.status(404).json({ success: false, message: 'Drop not found' });
    }

    res.json({ success: true, data: drop });
  } catch (error) {
    console.error('Admin expire drop error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to expire drop' });
  }
};
