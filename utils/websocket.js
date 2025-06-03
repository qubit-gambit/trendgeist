const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../database/config');

class WebSocketManager {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.connectedUsers = new Map(); // userId -> socket mapping
    this.userSockets = new Map();    // socketId -> userId mapping
    this.rooms = new Set(['global', 'leaderboard', 'predictions']);
    
    this.setupMiddleware();
    this.setupEventHandlers();
    
    console.log('🔌 WebSocket server initialized');
  }

  setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          // Allow anonymous connections with limited functionality
          socket.userId = null;
          socket.isAuthenticated = false;
          return next();
        }

        const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Verify user exists and is active
        const client = await pool.connect();
        try {
          const userResult = await client.query(
            'SELECT id, username, total_points, current_rank FROM users WHERE id = $1 AND is_active = true',
            [decoded.userId]
          );

          if (userResult.rows.length === 0) {
            return next(new Error('User not found'));
          }

          socket.userId = decoded.userId;
          socket.user = userResult.rows[0];
          socket.isAuthenticated = true;
          
        } finally {
          client.release();
        }
        
        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        socket.userId = null;
        socket.isAuthenticated = false;
        next(); // Allow connection but as anonymous
      }
    });
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      socket.on('join_room', (data) => this.handleJoinRoom(socket, data));
      socket.on('leave_room', (data) => this.handleLeaveRoom(socket, data));
      socket.on('subscribe_predictions', (data) => this.handleSubscribePredictions(socket, data));
      socket.on('subscribe_leaderboard', (data) => this.handleSubscribeLeaderboard(socket, data));
      socket.on('ping', () => socket.emit('pong'));
      socket.on('disconnect', () => this.handleDisconnection(socket));
    });
  }

  handleConnection(socket) {
    console.log(`Socket connected: ${socket.id} (User: ${socket.userId || 'anonymous'})`);
    
    if (socket.isAuthenticated) {
      // Store user-socket mapping
      this.connectedUsers.set(socket.userId, socket);
      this.userSockets.set(socket.id, socket.userId);
      
      // Join user to their personal room for direct messages
      socket.join(`user:${socket.userId}`);
      
      // Send welcome message with user stats
      socket.emit('connected', {
        message: 'Connected successfully',
        user: socket.user,
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('connected', {
        message: 'Connected as anonymous user',
        timestamp: new Date().toISOString()
      });
    }
    
    // Join global room by default
    socket.join('global');
    
    // Send current online count
    this.broadcastOnlineCount();
  }

  handleDisconnection(socket) {
    console.log(`Socket disconnected: ${socket.id}`);
    
    if (socket.userId) {
      this.connectedUsers.delete(socket.userId);
      this.userSockets.delete(socket.id);
    }
    
    this.broadcastOnlineCount();
  }

  handleJoinRoom(socket, data) {
    const { room } = data;
    
    if (!room || !this.rooms.has(room)) {
      socket.emit('error', { message: 'Invalid room' });
      return;
    }
    
    socket.join(room);
    socket.emit('joined_room', { room, timestamp: new Date().toISOString() });
    
    console.log(`Socket ${socket.id} joined room: ${room}`);
  }

  handleLeaveRoom(socket, data) {
    const { room } = data;
    
    if (!room) {
      socket.emit('error', { message: 'Room name required' });
      return;
    }
    
    socket.leave(room);
    socket.emit('left_room', { room, timestamp: new Date().toISOString() });
    
    console.log(`Socket ${socket.id} left room: ${room}`);
  }

  handleSubscribePredictions(socket, data) {
    const { eventTypes = [] } = data;
    
    // Join prediction-specific rooms
    eventTypes.forEach(eventType => {
      const room = `predictions:${eventType}`;
      socket.join(room);
    });
    
    socket.emit('subscribed_predictions', { 
      eventTypes, 
      timestamp: new Date().toISOString() 
    });
  }

  handleSubscribeLeaderboard(socket, data) {
    const { categories = ['overall'] } = data;
    
    // Join leaderboard-specific rooms
    categories.forEach(category => {
      const room = `leaderboard:${category}`;
      socket.join(room);
    });
    
    socket.emit('subscribed_leaderboard', { 
      categories, 
      timestamp: new Date().toISOString() 
    });
  }

  // Broadcast new prediction to relevant users
  broadcastNewPrediction(prediction, user) {
    const data = {
      type: 'new_prediction',
      prediction: {
        id: prediction.id,
        event_type: prediction.event_type,
        event_title: prediction.event_title,
        predicted_outcome: prediction.predicted_outcome,
        confidence: prediction.confidence,
        expires_at: prediction.expires_at,
        created_at: prediction.created_at
      },
      user: {
        id: user.id,
        username: user.username,
        total_points: user.total_points
      },
      timestamp: new Date().toISOString()
    };
    
    // Broadcast to global room and event-specific room
    this.io.to('global').emit('prediction_update', data);
    this.io.to(`predictions:${prediction.event_type}`).emit('prediction_update', data);
    
    console.log(`📡 Broadcasted new prediction: ${prediction.event_title}`);
  }

  // Broadcast prediction resolution
  broadcastPredictionResolution(predictionId, result, user) {
    const data = {
      type: 'prediction_resolved',
      predictionId,
      result: {
        isCorrect: result.isCorrect,
        pointsAwarded: result.pointsAwarded,
        breakdown: result.breakdown
      },
      user: {
        id: user.id,
        username: user.username,
        newTotalPoints: user.total_points
      },
      timestamp: new Date().toISOString()
    };
    
    // Send to user who made the prediction
    this.io.to(`user:${user.id}`).emit('prediction_resolved', data);
    
    // Broadcast to global if significant points were awarded
    if (result.pointsAwarded > 100) {
      this.io.to('global').emit('prediction_update', data);
    }
    
    console.log(`🎯 Broadcasted prediction resolution: ${predictionId} (${result.pointsAwarded} points)`);
  }

  // Broadcast leaderboard updates
  broadcastLeaderboardUpdate(category, topUsers, updatedUser = null) {
    const data = {
      type: 'leaderboard_update',
      category,
      topUsers: topUsers.slice(0, 10), // Top 10 users
      updatedUser,
      timestamp: new Date().toISOString()
    };
    
    this.io.to('leaderboard').emit('leaderboard_update', data);
    this.io.to(`leaderboard:${category}`).emit('leaderboard_update', data);
    
    console.log(`🏆 Broadcasted leaderboard update for category: ${category}`);
  }

  // Send notification to specific user
  sendNotificationToUser(userId, notification) {
    const socket = this.connectedUsers.get(userId);
    if (socket) {
      socket.emit('notification', {
        ...notification,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Broadcast system-wide announcement
  broadcastAnnouncement(message, type = 'info') {
    const data = {
      type: 'announcement',
      message,
      level: type,
      timestamp: new Date().toISOString()
    };
    
    this.io.to('global').emit('announcement', data);
    console.log(`📢 Broadcasted announcement: ${message}`);
  }

  // Broadcast market event updates
  broadcastMarketEventUpdate(event, type = 'opened') {
    const data = {
      type: 'market_event_update',
      eventType: type, // 'opened', 'closing_soon', 'closed', 'resolved'
      event: {
        id: event.id,
        title: event.title,
        event_type: event.event_type,
        closes_at: event.closes_at,
        status: event.status
      },
      timestamp: new Date().toISOString()
    };
    
    this.io.to('global').emit('market_event_update', data);
    
    if (type === 'closing_soon') {
      // Send urgent notification to users with active predictions
      this.notifyUsersWithActivePredictions(event.id);
    }
    
    console.log(`📊 Broadcasted market event update: ${event.title} (${type})`);
  }

  // Notify users about events closing soon
  async notifyUsersWithActivePredictions(eventId) {
    const client = await pool.connect();
    
    try {
      const result = await client.query(
        `SELECT DISTINCT p.user_id, u.username, p.event_title
         FROM predictions p
         JOIN users u ON p.user_id = u.id
         WHERE p.event_title LIKE '%' || (SELECT title FROM market_events WHERE id = $1) || '%'
         AND p.is_resolved = false
         AND p.expires_at > NOW()`,
        [eventId]
      );
      
      result.rows.forEach(row => {
        this.sendNotificationToUser(row.user_id, {
          type: 'prediction_closing_soon',
          title: 'Prediction Closing Soon!',
          message: `Your prediction for "${row.event_title}" is closing in 1 hour.`,
          action: 'review_prediction'
        });
      });
      
    } finally {
      client.release();
    }
  }

  // Get current online user count
  broadcastOnlineCount() {
    const onlineCount = this.connectedUsers.size;
    const anonymousCount = this.io.sockets.sockets.size - this.connectedUsers.size;
    
    this.io.to('global').emit('online_count', {
      authenticated: onlineCount,
      anonymous: anonymousCount,
      total: this.io.sockets.sockets.size,
      timestamp: new Date().toISOString()
    });
  }

  // Send real-time FRED data updates
  broadcastFREDDataUpdate(indicator, data) {
    const updateData = {
      type: 'fred_data_update',
      indicator,
      data,
      timestamp: new Date().toISOString()
    };
    
    this.io.to('global').emit('fred_data_update', updateData);
    console.log(`📈 Broadcasted FRED data update: ${indicator}`);
  }

  // Get connected user IDs
  getConnectedUserIds() {
    return Array.from(this.connectedUsers.keys());
  }

  // Get connection stats
  getConnectionStats() {
    return {
      totalConnections: this.io.sockets.sockets.size,
      authenticatedUsers: this.connectedUsers.size,
      anonymousUsers: this.io.sockets.sockets.size - this.connectedUsers.size,
      rooms: Array.from(this.rooms)
    };
  }

  // Clean up disconnected sockets
  cleanup() {
    console.log('🧹 Cleaning up WebSocket connections...');
    this.io.close();
  }
}

module.exports = WebSocketManager; 