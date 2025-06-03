const redis = require('redis');

class CacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.useRedis = process.env.USE_REDIS === 'true'; // Only try Redis if explicitly enabled
  }

  async connect() {
    // Skip Redis connection attempt unless explicitly enabled
    if (!this.useRedis) {
      console.log('📝 Using in-memory cache (Redis disabled)');
      this.setupMemoryFallback();
      return;
    }

    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            // Silently fall back to memory cache instead of showing error
            return new Error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 3) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.client.on('connect', () => {
        console.log('✅ Connected to Redis');
        this.isConnected = true;
        this.retryCount = 0;
      });

      this.client.on('error', (err) => {
        // Only log Redis errors if explicitly trying to use Redis
        if (this.useRedis) {
          console.warn('⚠️ Redis connection issue, falling back to memory cache');
        }
        this.isConnected = false;
        this.setupMemoryFallback();
      });

      this.client.on('end', () => {
        if (this.useRedis) {
          console.log('Redis connection ended');
        }
        this.isConnected = false;
      });

      await this.client.connect();
      
    } catch (error) {
      // Silent fallback - no error logging unless explicitly using Redis
      if (this.useRedis) {
        console.warn('⚠️ Could not connect to Redis, using memory cache');
      } else {
        console.log('📝 Using in-memory cache');
      }
      
      this.setupMemoryFallback();
    }
  }

  setupMemoryFallback() {
    if (!this.useRedis) {
      // Don't show warning if we're intentionally not using Redis
      console.log('💾 Memory cache initialized');
    }
    this.memoryCache = new Map();
    this.isConnected = true; // Allow cache operations to proceed
  }

  async set(key, value, ttlSeconds = 3600) {
    try {
      if (!this.isConnected) return false;

      const serializedValue = JSON.stringify(value);
      
      if (this.client) {
        await this.client.setEx(key, ttlSeconds, serializedValue);
      } else if (this.memoryCache) {
        this.memoryCache.set(key, {
          value: serializedValue,
          expires: Date.now() + (ttlSeconds * 1000)
        });
      }
      
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async get(key) {
    try {
      if (!this.isConnected) return null;

      let result = null;
      
      if (this.client) {
        result = await this.client.get(key);
      } else if (this.memoryCache && this.memoryCache.has(key)) {
        const cached = this.memoryCache.get(key);
        if (cached.expires > Date.now()) {
          result = cached.value;
        } else {
          this.memoryCache.delete(key);
        }
      }

      return result ? JSON.parse(result) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) return false;

      if (this.client) {
        await this.client.del(key);
      } else if (this.memoryCache) {
        this.memoryCache.delete(key);
      }
      
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key) {
    try {
      if (!this.isConnected) return false;

      if (this.client) {
        return await this.client.exists(key);
      } else if (this.memoryCache) {
        return this.memoryCache.has(key);
      }
      
      return false;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  async flushAll() {
    try {
      if (!this.isConnected) return false;

      if (this.client) {
        await this.client.flushAll();
      } else if (this.memoryCache) {
        this.memoryCache.clear();
      }
      
      return true;
    } catch (error) {
      console.error('Cache flush error:', error);
      return false;
    }
  }

  // FRED API specific caching
  async cacheFREDResponse(endpoint, params, data, ttlSeconds = 3600) {
    const key = `fred:${endpoint}:${JSON.stringify(params)}`;
    return await this.set(key, data, ttlSeconds);
  }

  async getFREDCache(endpoint, params) {
    const key = `fred:${endpoint}:${JSON.stringify(params)}`;
    return await this.get(key);
  }

  // Leaderboard caching
  async cacheLeaderboard(category, data, ttlSeconds = 300) {
    const key = `leaderboard:${category}`;
    return await this.set(key, data, ttlSeconds);
  }

  async getLeaderboard(category) {
    const key = `leaderboard:${category}`;
    return await this.get(key);
  }

  // User session caching
  async cacheUserSession(userId, sessionData, ttlSeconds = 86400) {
    const key = `session:${userId}`;
    return await this.set(key, sessionData, ttlSeconds);
  }

  async getUserSession(userId) {
    const key = `session:${userId}`;
    return await this.get(key);
  }

  async invalidateUserSession(userId) {
    const key = `session:${userId}`;
    return await this.del(key);
  }

  // Rate limiting
  async checkRateLimit(identifier, limit, windowSeconds) {
    try {
      if (!this.isConnected) return { allowed: true, remaining: limit };

      const key = `rate_limit:${identifier}`;
      
      if (this.client) {
        const current = await this.client.incr(key);
        if (current === 1) {
          await this.client.expire(key, windowSeconds);
        }
        
        const remaining = Math.max(0, limit - current);
        return {
          allowed: current <= limit,
          remaining,
          resetTime: Date.now() + (windowSeconds * 1000)
        };
      } else if (this.memoryCache) {
        const now = Date.now();
        const windowStart = now - (windowSeconds * 1000);
        
        if (!this.memoryCache.has(key)) {
          this.memoryCache.set(key, { count: 1, windowStart: now });
          return { allowed: true, remaining: limit - 1 };
        }
        
        const data = this.memoryCache.get(key);
        if (data.windowStart < windowStart) {
          data.count = 1;
          data.windowStart = now;
        } else {
          data.count++;
        }
        
        const remaining = Math.max(0, limit - data.count);
        return {
          allowed: data.count <= limit,
          remaining,
          resetTime: data.windowStart + (windowSeconds * 1000)
        };
      }
      
      return { allowed: true, remaining: limit };
    } catch (error) {
      console.error('Rate limit check error:', error);
      return { allowed: true, remaining: limit };
    }
  }

  // Market data caching
  async cacheMarketData(type, data, ttlSeconds = 60) {
    const key = `market:${type}`;
    return await this.set(key, data, ttlSeconds);
  }

  async getMarketData(type) {
    const key = `market:${type}`;
    return await this.get(key);
  }

  // Cleanup expired memory cache entries
  cleanupMemoryCache() {
    if (!this.memoryCache) return;
    
    const now = Date.now();
    for (const [key, value] of this.memoryCache.entries()) {
      if (value.expires && value.expires < now) {
        this.memoryCache.delete(key);
      }
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      this.isConnected = false;
      console.log('Redis connection closed');
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

// Create singleton instance
const cacheManager = new CacheManager();

// Cleanup memory cache every 5 minutes
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    cacheManager.cleanupMemoryCache();
  }, 5 * 60 * 1000);
}

module.exports = cacheManager; 