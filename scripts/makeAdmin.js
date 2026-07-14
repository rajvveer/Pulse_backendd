/**
 * Promote a user to admin (or create a fresh admin account).
 *
 * Promote existing user:  node scripts/makeAdmin.js <username>
 * Create new admin:       node scripts/makeAdmin.js <username> <email> <password>
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

async function main() {
  const [username, email, password] = process.argv.slice(2);

  if (!username) {
    console.log('Usage:');
    console.log('  Promote existing user:  node scripts/makeAdmin.js <username>');
    console.log('  Create new admin:       node scripts/makeAdmin.js <username> <email> <password>');
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI environment variable is required');
    process.exit(1);
  }
  await mongoose.connect(uri);

  let user = await User.findOne({ username: username.toLowerCase() }).select('+passwordHash');

  if (user) {
    user.role = 'admin';
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 12);
      console.log('Password updated.');
    }
    if (!user.passwordHash) {
      console.warn('WARNING: this user has no password set — admin panel login needs one.');
      console.warn('Re-run with: node scripts/makeAdmin.js ' + username + ' <email> <password>');
    }
    await user.save();
    console.log(`✅ ${user.username} is now an admin.`);
  } else {
    if (!email || !password) {
      console.error(`User "${username}" not found. To create a new admin, provide email and password.`);
      process.exit(1);
    }
    if (password.length < 8) {
      console.error('Password must be at least 8 characters.');
      process.exit(1);
    }
    user = await User.create({
      username: username.toLowerCase(),
      name: username,
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
      isActive: true,
      isVerified: true
    });
    console.log(`✅ Admin account "${user.username}" created.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
