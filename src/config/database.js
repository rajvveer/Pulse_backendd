const mongoose = require('mongoose');

class DatabaseConfig {
  constructor() {
    this.isConnected = false;
    this.connection = null;
  }

  async connect() {
    try {
      if (this.isConnected) {
        console.log('📚 Already connected to MongoDB');
        return this.connection;
      }

      const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/pulse';

      const options = {
        // Connection pool — sized for high concurrency per worker
        maxPoolSize: parseInt(process.env.MONGO_OPTIONS_MAX_POOL_SIZE) || 50,
        minPoolSize: parseInt(process.env.MONGO_OPTIONS_MIN_POOL_SIZE) || 5,
        maxIdleTimeMS: 30000,

        // Timeouts
        serverSelectionTimeoutMS: parseInt(process.env.MONGO_OPTIONS_SERVER_SELECTION_TIMEOUT_MS) || 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,

        // Reliability
        heartbeatFrequencyMS: 10000,
        retryWrites: true,
        retryReads: true,
      };

      this.connection = await mongoose.connect(MONGO_URI, options);
      this.isConnected = true;

      console.log('✅ Connected to MongoDB successfully');
      console.log(`📍 Database: ${mongoose.connection.name}`);
      console.log(`🌐 Host: ${mongoose.connection.host}:${mongoose.connection.port}`);

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        console.error('❌ MongoDB connection error:', error);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.log('🔌 MongoDB disconnected');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
        this.isConnected = true;
      });

      return this.connection;

    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);

      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }

      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.isConnected) {
        await mongoose.connection.close();
        this.isConnected = false;
        console.log('👋 MongoDB connection closed');
      }
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error);
    }
  }

  async isHealthy() {
    try {
      if (!this.isConnected) return false;
      await mongoose.connection.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  getConnectionStats() {
    if (!this.isConnected) return null;

    return {
      connected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      collections: Object.keys(mongoose.connection.collections),
      models: mongoose.modelNames()
    };
  }

  async createIndexes() {
    try {
      console.log('📝 Creating database indexes...');
      const collections = mongoose.connection.collections;

      for (const [name, collection] of Object.entries(collections)) {
        const indexes = await collection.listIndexes().toArray();
        console.log(`📊 ${name} has ${indexes.length} indexes`);
      }

      console.log('✅ Database indexes verified');
    } catch (error) {
      console.error('❌ Index creation error:', error);
    }
  }
}

module.exports = new DatabaseConfig();
