/**
 * Migration script to copy follow relationships from legacy User.followers[] /
 * User.following[] arrays into the dedicated Follow collection, then re-sync
 * each user's cached stats.followers / stats.following counts.
 *
 * Safe to re-run — relies on the Follow collection's unique compound index
 * ({ follower: 1, following: 1 }) to skip duplicates.
 *
 * Run once: node scripts/migrateFollows.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Follow = require('../src/models/Follow');

const MONGO_URI = process.env.MONGO_URI;

async function migrateFollows() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected!\n');

    const users = await User.find({}).select('_id username followers following').lean();
    console.log(`📊 Found ${users.length} users to scan\n`);

    let migrated = 0;
    let skipped = 0;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const following = user.following || [];

      for (const targetId of following) {
        try {
          await Follow.create({ follower: user._id, following: targetId });
          migrated++;
        } catch (err) {
          if (err.code === 11000) {
            skipped++;
          } else {
            console.error(`\nError migrating follow ${user._id} -> ${targetId}:`, err.message);
          }
        }
      }
      process.stdout.write(`\r⏳ Scanned ${i + 1}/${users.length} users...`);
    }

    console.log(`\n\n✅ Follow docs created: ${migrated}`);
    console.log(`   Skipped (already existed): ${skipped}`);

    console.log('\n🔄 Re-syncing cached stats.followers / stats.following for every user...');
    let resynced = 0;
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const [followerCount, followingCount] = await Promise.all([
        Follow.countDocuments({ following: user._id }),
        Follow.countDocuments({ follower: user._id })
      ]);
      await User.updateOne(
        { _id: user._id },
        { $set: { 'stats.followers': followerCount, 'stats.following': followingCount } }
      );
      resynced++;
      process.stdout.write(`\r⏳ Resynced ${i + 1}/${users.length} users...`);
    }

    console.log(`\n\n✅ Stats resynced for ${resynced} users`);

    const followTotal = await Follow.countDocuments({});
    console.log(`\n📊 Total Follow docs in collection: ${followTotal}`);

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateFollows();
