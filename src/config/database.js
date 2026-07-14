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

      // Pool sizing must respect the Atlas connection cap:
      //   total connections ≈ maxPoolSize × workers/container × containers.
      // In cluster mode every worker opens its OWN pool, so a flat 50 silently
      // multiplies (50 × 8 workers × 20 containers = 8,000 — well past an M30).
      // We derive a per-PROCESS pool from a cluster-wide target divided by the
      // worker count, so adding workers doesn't inflate the total per container.
      const workersPerContainer = parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length || 1;
      const explicitPool = parseInt(process.env.MONGO_OPTIONS_MAX_POOL_SIZE);
      // Per-container connection budget (tune to your Atlas tier ÷ max containers).
      const containerPoolBudget = parseInt(process.env.MONGO_CONTAINER_POOL_BUDGET) || 50;
      const derivedPerWorker = Math.max(5, Math.floor(containerPoolBudget / workersPerContainer));
      const maxPoolSize = explicitPool || derivedPerWorker;

      const options = {
        // Connection pool — see sizing note above.
        maxPoolSize,
        minPoolSize: parseInt(process.env.MONGO_OPTIONS_MIN_POOL_SIZE) || Math.min(2, maxPoolSize),
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
      console.log(`🔗 Mongo pool: maxPoolSize=${maxPoolSize} per process (×${workersPerContainer} workers/container)`);

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

      // Actually build every schema-defined index. Model.createIndexes() is
      // additive (unlike syncIndexes, it never drops indexes created by
      // scripts/createIndexes.js), and is a no-op for indexes that exist.
      const modelNames = mongoose.modelNames();
      for (const name of modelNames) {
        try {
          await mongoose.model(name).createIndexes();
        } catch (err) {
          console.error(`❌ Index build failed for ${name}:`, err.message);
        }
      }

      for (const [name, collection] of Object.entries(mongoose.connection.collections)) {
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
