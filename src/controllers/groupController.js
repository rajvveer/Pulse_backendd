const Conversation = require('../models/Conversation');
const User = require('../models/User');
const Message = require('../models/Message');

// @desc    Create a new group
// @route   POST /api/v1/groups
exports.createGroup = async (req, res) => {
  try {
    const { groupName, participants, groupDescription, groupAvatar } = req.body;
    const creatorId = req.user.userId;

    // Validation
    if (!groupName || !participants || participants.length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Group name and at least 2 participants required' 
      });
    }

    // Add creator to participants if not included
    const allParticipants = [...new Set([creatorId, ...participants])];

    // Initialize unread counts
    const unreadCounts = {};
    allParticipants.forEach(id => {
      unreadCounts[id] = 0;
    });

    // Create group conversation
    const group = await Conversation.create({
      type: 'group',
      groupName,
      groupDescription,
      groupAvatar,
      participants: allParticipants,
      admins: [creatorId],
      createdBy: creatorId,
      lastMessageContent: `${req.user.username || 'Someone'} created the group`,
      unreadCounts
    });

    // Create system message
    await Message.create({
      conversation: group._id,
      sender: creatorId,
      type: 'system',
      content: `${req.user.username} created "${groupName}"`
    });

    // Populate and return
    const populatedGroup = await Conversation.findById(group._id)
      .populate('participants', 'username name avatar profile.avatar isVerified')
      .populate('admins', 'username name avatar profile.avatar')
      .populate('createdBy', 'username name avatar profile.avatar');

    res.status(201).json({ success: true, data: populatedGroup });
  } catch (error) {
    console.error('❌ Create group error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get group details
// @route   GET /api/v1/groups/:groupId
exports.getGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      participants: req.user.userId
    })
    .populate('participants', 'username name avatar profile.avatar isVerified isOnline')
    .populate('admins', 'username name avatar profile.avatar')
    .populate('createdBy', 'username name avatar profile.avatar');

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    res.json({ success: true, data: group });
  } catch (error) {
    console.error('❌ Get group error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Add members to group
// @route   POST /api/v1/groups/:groupId/members
exports.addGroupMembers = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'User IDs required' });
    }

    // Check if user is admin
    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      admins: req.user.userId
    });

    if (!group) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized or group not found' 
      });
    }

    // Add new members
    const newMembers = userIds.filter(id => !group.participants.includes(id));
    
    if (newMembers.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'All users are already members' 
      });
    }

    await Conversation.findByIdAndUpdate(groupId, {
      $addToSet: { participants: { $each: newMembers } }
    });

    // Initialize unread counts for new members
    const updates = {};
    newMembers.forEach(id => {
      updates[`unreadCounts.${id}`] = 0;
    });
    
    await Conversation.findByIdAndUpdate(groupId, { $set: updates });

    // Create system message
    const newUsers = await User.find({ _id: { $in: newMembers } }).select('username');
    const usernames = newUsers.map(u => u.username).join(', ');
    
    await Message.create({
      conversation: groupId,
      sender: req.user.userId,
      type: 'system',
      content: `${req.user.username} added ${usernames}`
    });

    const updatedGroup = await Conversation.findById(groupId)
      .populate('participants', 'username name avatar profile.avatar isVerified');

    res.json({ success: true, data: updatedGroup });
  } catch (error) {
    console.error('❌ Add members error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove member from group
// @route   DELETE /api/v1/groups/:groupId/members/:userId
exports.removeGroupMember = async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      admins: req.user.userId
    });

    if (!group) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }

    // Can't remove creator
    if (String(group.createdBy) === String(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot remove group creator' 
      });
    }

    // Remove member
    await Conversation.findByIdAndUpdate(groupId, {
      $pull: { participants: userId, admins: userId }
    });

    // System message
    const removedUser = await User.findById(userId).select('username');
    await Message.create({
      conversation: groupId,
      sender: req.user.userId,
      type: 'system',
      content: `${req.user.username} removed ${removedUser.username}`
    });

    res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    console.error('❌ Remove member error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Leave group
// @route   POST /api/v1/groups/:groupId/leave
exports.leaveGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      participants: userId
    });

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Creator can't leave (must delete or transfer ownership)
    if (String(group.createdBy) === String(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Group creator cannot leave. Delete the group instead.' 
      });
    }

    // Remove user
    await Conversation.findByIdAndUpdate(groupId, {
      $pull: { participants: userId, admins: userId }
    });

    // System message
    await Message.create({
      conversation: groupId,
      sender: userId,
      type: 'system',
      content: `${req.user.username} left the group`
    });

    res.json({ success: true, message: 'Left group successfully' });
  } catch (error) {
    console.error('❌ Leave group error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update group info
// @route   PUT /api/v1/groups/:groupId
exports.updateGroupInfo = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { groupName, groupDescription, groupAvatar } = req.body;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      admins: req.user.userId
    });

    if (!group) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updates = {};
    if (groupName) updates.groupName = groupName;
    if (groupDescription !== undefined) updates.groupDescription = groupDescription;
    if (groupAvatar !== undefined) updates.groupAvatar = groupAvatar;

    const updatedGroup = await Conversation.findByIdAndUpdate(
      groupId,
      { $set: updates },
      { new: true }
    ).populate('participants', 'username name avatar profile.avatar isVerified');

    // System message for name change
    if (groupName && groupName !== group.groupName) {
      await Message.create({
        conversation: groupId,
        sender: req.user.userId,
        type: 'system',
        content: `${req.user.username} changed the group name to "${groupName}"`
      });
    }

    res.json({ success: true, data: updatedGroup });
  } catch (error) {
    console.error('❌ Update group error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Make user admin
// @route   POST /api/v1/groups/:groupId/admins
exports.makeAdmin = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      createdBy: req.user.userId // Only creator can make admins
    });

    if (!group) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Check if user is a participant
    if (!group.participants.includes(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'User is not a group member' 
      });
    }

    await Conversation.findByIdAndUpdate(groupId, {
      $addToSet: { admins: userId }
    });

    const user = await User.findById(userId).select('username');
    await Message.create({
      conversation: groupId,
      sender: req.user.userId,
      type: 'system',
      content: `${user.username} is now an admin`
    });

    res.json({ success: true, message: 'Admin added' });
  } catch (error) {
    console.error('❌ Make admin error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove admin
// @route   DELETE /api/v1/groups/:groupId/admins/:userId
exports.removeAdmin = async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      createdBy: req.user.userId
    });

    if (!group) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Can't remove creator as admin
    if (String(group.createdBy) === String(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot remove creator as admin' 
      });
    }

    await Conversation.findByIdAndUpdate(groupId, {
      $pull: { admins: userId }
    });

    const user = await User.findById(userId).select('username');
    await Message.create({
      conversation: groupId,
      sender: req.user.userId,
      type: 'system',
      content: `${user.username} is no longer an admin`
    });

    res.json({ success: true, message: 'Admin removed' });
  } catch (error) {
    console.error('❌ Remove admin error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete group
// @route   DELETE /api/v1/groups/:groupId
exports.deleteGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Conversation.findOne({
      _id: groupId,
      type: 'group',
      createdBy: req.user.userId // Only creator can delete
    });

    if (!group) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized or group not found' 
      });
    }

    // Delete all messages
    await Message.deleteMany({ conversation: groupId });

    // Delete conversation
    await Conversation.findByIdAndDelete(groupId);

    res.json({ success: true, message: 'Group deleted' });
  } catch (error) {
    console.error('❌ Delete group error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
