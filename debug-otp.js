require('dotenv').config();
const mongoose = require('mongoose');
const OTP = require('./src/models/OTP');

async function checkOTP() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const otps = await OTP.find({
    identifier: 'rajveershekhawat626@gmail.com'
  }).sort({ createdAt: -1 }).limit(5);
  
  console.log('Recent OTPs:', otps.map(otp => ({
    identifier: otp.identifier,
    purpose: otp.purpose,
    verified: otp.verified,
    attempts: otp.attempts,
    createdAt: otp.createdAt,
    expiresAt: otp.expiresAt,
    isExpired: otp.expiresAt < new Date()
  })));
  
  mongoose.disconnect();
}

checkOTP();
