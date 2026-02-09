/**
 * MongoDB Index Creation Script
 * Run this to optimize database performance
 * 
 * Usage: node scripts/createIndexes.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const createIndexes = async () => {
    try {
        console.log('🔧 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const db = mongoose.connection.db;

        console.log('\n📊 Creating indexes...\n');

        // ==========================================
        // POST INDEXES
        // ==========================================
        console.log('Creating Post indexes...');

        // Main feed query index
        await db.collection('posts').createIndex(
            { isActive: 1, visibility: 1, createdAt: -1 },
            { name: 'feed_query_idx', background: true }
        );

        // User posts index
        await db.collection('posts').createIndex(
            { author: 1, isActive: 1, createdAt: -1 },
            { name: 'user_posts_idx', background: true }
        );

        // Geospatial index for nearby posts
        await db.collection('posts').createIndex(
            { 'location.coordinates': '2dsphere' },
            { name: 'location_geo_idx', background: true, sparse: true }
        );

        console.log('✅ Post indexes created');

        // ==========================================
        // USER INDEXES
        // ==========================================
        console.log('Creating User indexes...');

        await db.collection('users').createIndex(
            { username: 1 },
            { name: 'username_unique_idx', unique: true, background: true }
        );

        await db.collection('users').createIndex(
            { email: 1 },
            { name: 'email_unique_idx', unique: true, sparse: true, background: true }
        );

        console.log('✅ User indexes created');

        // ==========================================
        // LIKE INDEXES
        // ==========================================
        console.log('Creating Like indexes...');

        await db.collection('likes').createIndex(
            { user: 1, targetType: 1, targetId: 1 },
            { name: 'like_lookup_idx', unique: true, background: true }
        );

        await db.collection('likes').createIndex(
            { targetType: 1, targetId: 1 },
            { name: 'like_count_idx', background: true }
        );

        console.log('✅ Like indexes created');

        // ==========================================
        // NOTIFICATION INDEXES
        // ==========================================
        console.log('Creating Notification indexes...');

        await db.collection('notifications').createIndex(
            { recipient: 1, isRead: 1, createdAt: -1 },
            { name: 'notification_feed_idx', background: true }
        );

        await db.collection('notifications').createIndex(
            { recipient: 1, createdAt: -1 },
            { name: 'notification_list_idx', background: true }
        );

        console.log('✅ Notification indexes created');

        // ==========================================
        // COMMENT INDEXES
        // ==========================================
        console.log('Creating Comment indexes...');

        await db.collection('comments').createIndex(
            { post: 1, parentComment: 1, createdAt: -1 },
            { name: 'comment_list_idx', background: true }
        );

        console.log('✅ Comment indexes created');

        // ==========================================
        // REEL INDEXES
        // ==========================================
        console.log('Creating Reel indexes...');

        await db.collection('reels').createIndex(
            { isActive: 1, createdAt: -1 },
            { name: 'reel_feed_idx', background: true }
        );

        await db.collection('reels').createIndex(
            { user: 1, isActive: 1, createdAt: -1 },
            { name: 'user_reels_idx', background: true }
        );

        console.log('✅ Reel indexes created');

        console.log('\n🎉 All indexes created successfully!\n');

        // Print index stats
        console.log('📈 Index Statistics:');
        const collections = ['posts', 'users', 'likes', 'notifications', 'comments', 'reels'];

        for (const collName of collections) {
            try {
                const indexes = await db.collection(collName).indexes();
                console.log(`  ${collName}: ${indexes.length} indexes`);
            } catch (e) {
                console.log(`  ${collName}: Collection not found`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating indexes:', error.message);
        process.exit(1);
    }
};

createIndexes();
