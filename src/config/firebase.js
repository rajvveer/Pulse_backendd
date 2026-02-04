const admin = require('firebase-admin');
const config = require('./index');

class FirebaseConfig {
  constructor() {
    this.app = null;
    this.auth = null;
    this.isInitialized = false;
  }

  // Initialize Firebase Admin SDK
  async initialize() {
    try {
      if (this.isInitialized) {
        console.log('🔥 Firebase already initialized');
        return this.app;
      }

      const firebaseConfig = config.get('firebase');

      // Check if Firebase credentials are available
      if (!firebaseConfig.projectId || !firebaseConfig.privateKey || !firebaseConfig.clientEmail) {
        console.warn('⚠️  Firebase configuration incomplete - Firebase features will be disabled');
        return null;
      }

      // Prepare service account
      const serviceAccount = {
        type: 'service_account',
        project_id: firebaseConfig.projectId,
        private_key_id: firebaseConfig.privateKeyId,
        private_key: firebaseConfig.privateKey,
        client_email: firebaseConfig.clientEmail,
        client_id: firebaseConfig.clientId,
        auth_uri: firebaseConfig.authUri || 'https://accounts.google.com/o/oauth2/auth',
        token_uri: firebaseConfig.tokenUri || 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(firebaseConfig.clientEmail)}`
      };

      // Initialize Firebase Admin
      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: firebaseConfig.projectId
      });

      this.auth = admin.auth();
      this.isInitialized = true;

      console.log('✅ Firebase Admin SDK initialized successfully');
      console.log(`📍 Project ID: ${firebaseConfig.projectId}`);

      return this.app;

    } catch (error) {
      console.error('❌ Firebase initialization failed:', error.message);
      
      // Don't crash the app, just disable Firebase features
      if (config.isProduction()) {
        console.warn('⚠️  Continuing without Firebase in production');
      }
      
      return null;
    }
  }

  // Verify Firebase ID token
  async verifyIdToken(idToken) {
    try {
      if (!this.isInitialized || !this.auth) {
        throw new Error('Firebase not initialized');
      }

      const decodedToken = await this.auth.verifyIdToken(idToken);
      return {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
        name: decodedToken.name,
        picture: decodedToken.picture,
        provider: decodedToken.firebase.sign_in_provider
      };

    } catch (error) {
      console.error('Firebase token verification error:', error);
      throw new Error('Invalid Firebase token');
    }
  }

  // Create custom token for user
  async createCustomToken(userId, additionalClaims = {}) {
    try {
      if (!this.isInitialized || !this.auth) {
        throw new Error('Firebase not initialized');
      }

      const customToken = await this.auth.createCustomToken(userId.toString(), additionalClaims);
      return customToken;

    } catch (error) {
      console.error('Custom token creation error:', error);
      throw new Error('Failed to create custom token');
    }
  }

  // Get user by UID
  async getUser(uid) {
    try {
      if (!this.isInitialized || !this.auth) {
        throw new Error('Firebase not initialized');
      }

      const userRecord = await this.auth.getUser(uid);
      return {
        uid: userRecord.uid,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        disabled: userRecord.disabled,
        metadata: userRecord.metadata,
        providerData: userRecord.providerData
      };

    } catch (error) {
      console.error('Get Firebase user error:', error);
      throw new Error('User not found in Firebase');
    }
  }

  // Check if Firebase is available
  isAvailable() {
    return this.isInitialized && this.auth !== null;
  }

  // Get Firebase app instance
  getApp() {
    return this.app;
  }

  // Get Firebase auth instance
  getAuth() {
    return this.auth;
  }
}

// Export singleton instance
module.exports = new FirebaseConfig();
