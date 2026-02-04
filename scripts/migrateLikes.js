/**
 * Migration script to copy likes from post.likes arrays to Like model
 * Run once: node scripts/migrateLikes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../src/models/Post');
const Like = require('../src/models/Like');

const MONGO_URI = process.env.MONGO_URI;

async function migrateLikes() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected!\n');

        // Get all posts with likes
        const posts = await Post.find({ 'likes.0': { $exists: true } }).select('_id likes').lean();
        console.log(`📊 Found ${posts.length} posts with likes to migrate\n`);

        let totalMigrated = 0;
        let totalSkipped = 0;

        for (const post of posts) {
            for (const userId of post.likes) {
                try {
                    // Check if like already exists
                    const exists = await Like.findOne({
                        user: userId,
                        targetType: 'post',
                        targetId: post._id
                    });

                    if (!exists) {
                        await Like.create({
                            user: userId,
                            targetType: 'post',
                            targetId: post._id,
                            targetTypeModel: 'Post'
                        });
                        totalMigrated++;
                    } else {
                        totalSkipped++;
                    }
                } catch (err) {
                    // Duplicate key error - already exists (ignore)
                    if (err.code !== 11000) {
                        console.error(`Error migrating like for post ${post._id}:`, err.message);
                    }
                    totalSkipped++;
                }
            }
            process.stdout.write(`\r⏳ Processed ${posts.indexOf(post) + 1}/${posts.length} posts...`);
        }

        console.log(`\n\n✅ Migration complete!`);
        console.log(`   - Migrated: ${totalMigrated} likes`);
        console.log(`   - Skipped (already exist): ${totalSkipped}`);

        // Verify counts
        const likeCount = await Like.countDocuments({ targetType: 'post' });
        console.log(`\n📊 Total likes in Like model: ${likeCount}`);

        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

migrateLikes();
