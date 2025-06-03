const pool = require('./config');

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting database migration...');
    
    // Enable UUID extension
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        avatar_url TEXT,
        bio TEXT,
        total_points INTEGER DEFAULT 0,
        current_rank INTEGER DEFAULT 0,
        win_streak INTEGER DEFAULT 0,
        total_predictions INTEGER DEFAULT 0,
        correct_predictions INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Predictions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS predictions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        event_title VARCHAR(500) NOT NULL,
        prediction_value JSONB NOT NULL,
        confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
        predicted_outcome VARCHAR(50) NOT NULL,
        actual_outcome VARCHAR(50),
        points_awarded INTEGER DEFAULT 0,
        is_resolved BOOLEAN DEFAULT false,
        resolution_date TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Leaderboard table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        points INTEGER DEFAULT 0,
        rank INTEGER NOT NULL,
        category VARCHAR(100) DEFAULT 'overall',
        win_streak INTEGER DEFAULT 0,
        total_predictions INTEGER DEFAULT 0,
        accuracy_percentage DECIMAL(5,2) DEFAULT 0.00,
        badge VARCHAR(50),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category)
      )
    `);
    
    // User sessions table (for JWT blacklisting)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        is_revoked BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Market events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_type VARCHAR(100) NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        resolution_criteria TEXT NOT NULL,
        opens_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closes_at TIMESTAMP NOT NULL,
        resolves_at TIMESTAMP,
        status VARCHAR(50) DEFAULT 'open',
        outcome VARCHAR(100),
        total_predictions INTEGER DEFAULT 0,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for better performance
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_event_type ON predictions(event_type)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_leaderboard_rank ON leaderboard(rank)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_leaderboard_category ON leaderboard(category)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_market_events_status ON market_events(status)');
    
    // Create trigger to update updated_at timestamps
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    await client.query(`
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    
    await client.query(`
      CREATE TRIGGER update_predictions_updated_at BEFORE UPDATE ON predictions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    
    await client.query(`
      CREATE TRIGGER update_market_events_updated_at BEFORE UPDATE ON market_events
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
    
    console.log('✅ Database migration completed successfully!');
    console.log('📊 Tables created: users, predictions, leaderboard, user_sessions, market_events');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
if (require.main === module) {
  createTables()
    .then(() => {
      console.log('🎉 Migration complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { createTables }; 