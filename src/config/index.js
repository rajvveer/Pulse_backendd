require('dotenv').config();

class Config {
  constructor() {
    this.validateRequiredEnvVars();
    this.config = this.loadConfig();
  }

  // Validate required environment variables
  validateRequiredEnvVars() {
    const required = [
      'JWT_SECRET',
      'JWT_REFRESH_SECRET', 
      'TEMP_JWT_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:');
      missing.forEach(key => console.error(`   - ${key}`));
      
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      } else {
        console.warn('⚠️  Continuing in development mode with missing env vars');
      }
    }
  }

  // Load and organize configuration
  loadConfig() {
    return {
      // Server Configuration
      server: {
        port: parseInt(process.env.PORT) || 3000,
        nodeEnv: process.env.NODE_ENV || 'development',
        apiVersion: process.env.API_VERSION || 'v1',
        serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
        frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
      },

      // Database Configuration
      database: {
        mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/pulse',
        mongoTestUri: process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/pulse_test',
        options: {
          maxPoolSize: parseInt(process.env.MONGO_OPTIONS_MAX_POOL_SIZE) || 10,
          serverSelectionTimeoutMS: parseInt(process.env.MONGO_OPTIONS_SERVER_SELECTION_TIMEOUT_MS) || 5000
        }
      },

      // JWT Configuration  
      jwt: {
        secret: process.env.JWT_SECRET,
        refreshSecret: process.env.JWT_REFRESH_SECRET,
        tempSecret: process.env.TEMP_JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
      },

      // Security Configuration
      security: {
        bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
        sessionSecret: process.env.SESSION_SECRET || 'fallback-session-secret'
      },

      // Custom OTP Service
      otp: {
        email: process.env.YOUR_EMAIL,
        emailAppPassword: process.env.YOUR_EMAIL_APP_PASSWORD,
        emailDisplayName: process.env.YOUR_EMAIL_DISPLAY_NAME || 'Pulse App',
        phone: process.env.YOUR_PHONE_NUMBER,
        smsGatewayUrl: process.env.YOUR_SMS_GATEWAY_URL,
        smsApiKey: process.env.YOUR_SMS_API_KEY,
        smsApiSecret: process.env.YOUR_SMS_API_SECRET
      },

      // Firebase Configuration
      firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        clientId: process.env.FIREBASE_CLIENT_ID,
        authUri: process.env.FIREBASE_AUTH_URI,
        tokenUri: process.env.FIREBASE_TOKEN_URI
      },

      // Redis Configuration
redis: {
  url: process.env.REDIS_URL || null,   // 👈 IMPORTANT
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || null,
  maxRetries: parseInt(process.env.REDIS_MAX_RETRIES) || 3,
  retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY_ON_FAILOVER) || 100
},

      // Media & Storage
      media: {
        cloudinary: {
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          apiKey: process.env.CLOUDINARY_API_KEY,
          apiSecret: process.env.CLOUDINARY_API_SECRET,
          uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
          folder: process.env.CLOUDINARY_FOLDER || 'pulse/media'
        },
        aws: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          region: process.env.AWS_REGION || 'us-east-1',
          s3Bucket: process.env.AWS_S3_BUCKET,
          s3PublicBucket: process.env.AWS_S3_PUBLIC_BUCKET
        }
      },

      // Rate Limiting
      rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        maxRequestsPerIp: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_IP) || 1000
      },

      // CORS Configuration
      cors: {
        origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'],
        credentials: process.env.CORS_CREDENTIALS === 'true'
      },

      // Monitoring & Analytics
      monitoring: {
        sentryDsn: process.env.SENTRY_DSN,
        sentryEnvironment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        amplitudeApiKey: process.env.AMPLITUDE_API_KEY,
        mixpanelToken: process.env.MIXPANEL_TOKEN
      },

      // Feature Flags
      features: {
        enableFirebaseAuth: process.env.ENABLE_FIREBASE_AUTH === 'true',
        enableGoogleLogin: process.env.ENABLE_GOOGLE_LOGIN === 'true',
        enablePhoneVerification: process.env.ENABLE_PHONE_VERIFICATION === 'true',
        enableEmailVerification: process.env.ENABLE_EMAIL_VERIFICATION === 'true',
        enableTwoFactorAuth: process.env.ENABLE_TWO_FACTOR_AUTH === 'true',
        enableBackgroundJobs: process.env.ENABLE_BACKGROUND_JOBS === 'true'
      },

      // Development/Debug
      debug: {
        logLevel: process.env.LOG_LEVEL || 'info',
        enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING === 'true',
        enableApiDocs: process.env.ENABLE_API_DOCS === 'true',
        debugMode: process.env.DEBUG_MODE === 'true'
      }
    };
  }

  // Get configuration
  get(path) {
    return path.split('.').reduce((obj, key) => obj && obj[key], this.config);
  }

  // Check if in development
  isDevelopment() {
    return this.config.server.nodeEnv === 'development';
  }

  // Check if in production
  isProduction() {
    return this.config.server.nodeEnv === 'production';
  }

  // Check if in test environment
  isTest() {
    return this.config.server.nodeEnv === 'test';
  }

  // Get database URI based on environment
  getDatabaseUri() {
    return this.isTest() ? this.config.database.mongoTestUri : this.config.database.mongoUri;
  }

  // Print configuration summary (without secrets)
  printSummary() {
    console.log('⚙️  Configuration Summary:');
    console.log(`   🌍 Environment: ${this.config.server.nodeEnv}`);
    console.log(`   🚀 Server: ${this.config.server.serverUrl}`);
    console.log(`   📚 Database: ${this.getDatabaseUri().replace(/\/\/.*@/, '//***@')}`);
    console.log(`   🔴 Redis: ${this.config.redis.host}:${this.config.redis.port}`);
    console.log(`   📧 Email OTP: ${this.config.otp.email ? '✅' : '❌'}`);
    console.log(`   📱 SMS OTP: ${this.config.otp.smsGatewayUrl ? '✅' : '❌'}`);
    console.log(`   🔥 Firebase: ${this.config.firebase.projectId ? '✅' : '❌'}`);
    console.log(`   ☁️  Cloudinary: ${this.config.media.cloudinary.cloudName ? '✅' : '❌'}`);
  }
}

// Export singleton instance
module.exports = new Config();
