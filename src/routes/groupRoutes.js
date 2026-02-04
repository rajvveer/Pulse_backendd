const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const groupController = require('../controllers/groupController');

// Group CRUD
router.post('/', verifyAccessToken, groupController.createGroup);
router.get('/:groupId', verifyAccessToken, groupController.getGroupDetails);
router.put('/:groupId', verifyAccessToken, groupController.updateGroupInfo);
router.delete('/:groupId', verifyAccessToken, groupController.deleteGroup);

// Member management
router.post('/:groupId/members', verifyAccessToken, groupController.addGroupMembers);
router.delete('/:groupId/members/:userId', verifyAccessToken, groupController.removeGroupMember);
router.post('/:groupId/leave', verifyAccessToken, groupController.leaveGroup);

// Admin management
router.post('/:groupId/admins', verifyAccessToken, groupController.makeAdmin);
router.delete('/:groupId/admins/:userId', verifyAccessToken, groupController.removeAdmin);

module.exports = router;
