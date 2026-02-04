const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const chatController = require('../controllers/chatController');

// Conversation routes
router.post('/conversation', verifyAccessToken, chatController.getOrCreateConversation);
router.get('/conversations', verifyAccessToken, chatController.getConversations);
router.get('/search', verifyAccessToken, chatController.searchConversations);
router.get('/:conversationId', verifyAccessToken, chatController.getConversationDetails);

// Message routes
router.get('/:conversationId/messages', verifyAccessToken, chatController.getMessages);
router.post('/:conversationId/read', verifyAccessToken, chatController.markConversationRead);
router.delete('/messages/:messageId', verifyAccessToken, chatController.deleteMessage);

module.exports = router;
