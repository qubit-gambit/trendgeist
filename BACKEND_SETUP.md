# Trendgeist Backend Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL 13+
- Redis (optional, will fallback to memory cache)
- Gemini AI API key (optional, for AI features)

### Installation

1. **Install Dependencies**
```bash
npm install
```

2. **Environment Configuration**
Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:3000,http://localhost:8000

# Database Configuration (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trendgeist
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Redis Configuration (Optional)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Gemini AI Configuration
GEMINI_API_KEY=your_gemini_api_key

# FRED API Configuration
FRED_API_KEY=your_fred_api_key_here
```

3. **Database Setup**
```bash
# Create PostgreSQL database
createdb trendgeist

# Run migrations to create tables
npm run migrate

# Optional: Seed with sample data
npm run seed
```

4. **Start the Server**
```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

## 📚 API Documentation

### Authentication Endpoints

#### POST `/api/auth/signup`
Create a new user account.
```json
{
  "email": "user@example.com",
  "password": "password123",
  "username": "username",
  "first_name": "John",
  "last_name": "Doe"
}
```

#### POST `/api/auth/login`
Authenticate user and receive JWT token.
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### POST `/api/auth/logout`
Revoke current JWT token.
**Requires:** Authorization header with Bearer token

#### GET `/api/auth/me`
Get current user profile.
**Requires:** Authorization header with Bearer token

### Predictions Endpoints

#### POST `/api/predictions`
Create a new prediction.
**Requires:** Authentication
```json
{
  "event_type": "cpi",
  "event_title": "Will CPI exceed 3.5% next month?",
  "prediction_value": { "threshold": 3.5 },
  "confidence": 75,
  "predicted_outcome": "yes",
  "expires_at": "2024-01-15T00:00:00Z"
}
```

#### GET `/api/predictions`
Get user's predictions with pagination.
**Query params:** `page`, `limit`, `event_type`, `status`

#### PUT `/api/predictions/:id`
Update an existing prediction (only if not resolved).

#### DELETE `/api/predictions/:id`
Delete a prediction (only if not resolved).

### Leaderboard Endpoints

#### GET `/api/leaderboard`
Get leaderboard rankings.
**Query params:** `category` (overall, cpi, unemployment, etc.), `page`, `limit`

#### GET `/api/leaderboard/user/:userId`
Get specific user's rankings across all categories.

#### GET `/api/leaderboard/stats`
Get leaderboard statistics and tier information.

## 🔌 WebSocket Events

### Client -> Server Events

- `join_room` - Join a specific room
- `leave_room` - Leave a room
- `subscribe_predictions` - Subscribe to prediction updates
- `subscribe_leaderboard` - Subscribe to leaderboard updates

### Server -> Client Events

- `connected` - Connection established
- `prediction_update` - New prediction or resolution
- `leaderboard_update` - Leaderboard changes
- `notification` - Personal notifications
- `online_count` - Current user count

### WebSocket Authentication
Include JWT token in connection:
```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your_jwt_token_here'
  }
});
```

## 🎯 Scoring System

### Point Calculation
- **Base Points:** 100 × difficulty multiplier
- **Confidence Bonus:** Base points × (confidence / 100)
- **Time Bonus:** Early predictions get up to 20% bonus
- **Streak Bonus:** Exponential bonus for consecutive correct predictions

### Difficulty Multipliers
- CPI: 1.5x
- Fed Rate: 2.0x
- GDP: 1.8x
- Unemployment: 1.3x
- Payrolls: 1.4x
- Others: 1.0-1.3x

### Automatic Resolution
- Expired predictions are auto-resolved as incorrect
- Scheduled resolution runs every hour

## 💾 Database Schema

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  total_points INTEGER DEFAULT 0,
  current_rank INTEGER DEFAULT 0,
  win_streak INTEGER DEFAULT 0,
  -- ... additional fields
);
```

### Predictions Table
```sql
CREATE TABLE predictions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  event_type VARCHAR(100) NOT NULL,
  prediction_value JSONB NOT NULL,
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  points_awarded INTEGER DEFAULT 0,
  is_resolved BOOLEAN DEFAULT false,
  -- ... additional fields
);
```

### Leaderboard Table
```sql
CREATE TABLE leaderboard (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  points INTEGER DEFAULT 0,
  rank INTEGER NOT NULL,
  category VARCHAR(100) DEFAULT 'overall',
  -- ... additional fields
);
```

## 🚀 Deployment

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3000
JWT_SECRET=very-secure-random-key
DB_HOST=your-production-db-host
REDIS_HOST=your-redis-host
GEMINI_API_KEY=your-production-api-key
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Health Checks
- **Endpoint:** `GET /health`
- **Response:** Service status for database, cache, WebSocket, and AI

## 🔧 Development

### Available Scripts
- `npm run dev` - Start with nodemon for development
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed database with sample data
- `npm test` - Run tests (when implemented)

### Logging
- Uses Winston for structured logging
- Log files: `logs/error.log` and `logs/combined.log`
- Console output in development

### Cache Strategy
- FRED API responses: 1 hour TTL
- Leaderboard data: 5 minutes TTL
- User sessions: 24 hours TTL
- Falls back to memory cache if Redis unavailable

## 🔒 Security Features

- Password hashing with bcrypt (12 rounds)
- JWT token blacklisting on logout
- Rate limiting on authentication endpoints
- Input validation with express-validator
- CORS configuration
- SQL injection protection with parameterized queries

## 📊 Monitoring

### Key Metrics to Monitor
- WebSocket connection count
- Database query performance
- Cache hit/miss rates
- API response times
- Error rates by endpoint

### Health Check Endpoints
- `GET /health` - Overall system health
- `GET /api/websocket/stats` - WebSocket statistics
- `GET /api/cache/stats` - Cache performance

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify PostgreSQL is running
   - Check DB credentials in .env
   - Ensure database exists

2. **Redis Connection Failed**
   - Will fallback to memory cache
   - Check Redis service status
   - Verify REDIS_HOST and REDIS_PORT

3. **JWT Token Issues**
   - Check JWT_SECRET is set
   - Verify token format: `Bearer <token>`
   - Tokens expire based on JWT_EXPIRES_IN

4. **WebSocket Connection Issues**
   - Check CORS configuration
   - Verify WebSocket URL matches server
   - Authentication token must be valid

### Debug Logging
Set `LOG_LEVEL=debug` in .env for detailed logging.

## 🔄 API Rate Limits

- Authentication endpoints: 5 requests per 15 minutes
- General API: 100 requests per 15 minutes
- WebSocket connections: No limit but monitored

## 📈 Performance Optimization

- Database indexes on frequently queried columns
- Redis caching for expensive operations
- Connection pooling for PostgreSQL
- Gzip compression for API responses
- Static file caching with appropriate headers

## 🆕 New Features Added

1. **Complete Authentication System**
   - JWT-based authentication
   - Password hashing with bcrypt
   - Token blacklisting for logout
   - User profile management

2. **PostgreSQL Database Integration**
   - Full database schema with migrations
   - User, prediction, and leaderboard tables
   - Proper indexing and relationships

3. **Real-time WebSocket Support**
   - Live prediction updates
   - Leaderboard changes
   - Personal notifications
   - Room-based subscriptions

4. **Redis Caching System**
   - FRED API response caching
   - Leaderboard data caching
   - Session management
   - Graceful fallback to memory

5. **Advanced Scoring System**
   - Confidence-based scoring
   - Time bonus for early predictions
   - Streak bonuses
   - Automatic resolution of expired predictions

6. **Comprehensive API**
   - RESTful endpoints for all operations
   - Input validation and error handling
   - Pagination support
   - Rate limiting

This backend system provides a robust foundation for your Trendgeist economic forecasting platform with real-time features, scalable architecture, and production-ready security. 