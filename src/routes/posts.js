const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const postController = require('../controllers/postController');

// Create post
router.post('/', verifyAccessToken, postController.createPost);

// Search posts
router.get('/search', verifyAccessToken, postController.searchPosts);

// Get trending hashtags
router.get('/trending', verifyAccessToken, postController.getTrendingHashtags);

// Get single post (must be after /search and /trending to avoid conflict)
router.get('/:postId', verifyAccessToken, postController.getPost);

// Update post
router.patch('/:postId', verifyAccessToken, postController.updatePost);

// Delete post
router.delete('/:postId', verifyAccessToken, postController.deletePost);
router.get('/me/posts', verifyAccessToken, postController.getMyPosts);


// User posts
router.get('/user/:username', verifyAccessToken, postController.getUserPosts);

// Like/Unlike post
router.post('/:postId/like', verifyAccessToken, postController.toggleLike);

// Comments
router.post('/:postId/comments', verifyAccessToken, postController.addComment);
router.get('/:postId/comments', verifyAccessToken, postController.getComments);
router.post('/:postId/comments/:commentId/like', verifyAccessToken, postController.toggleCommentLike);

module.exports = router;
