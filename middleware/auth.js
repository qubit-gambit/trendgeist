const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../database/config');
const { validationResult } = require('express-validator');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// Hash password
const hashPassword = async (password) => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

// Compare password
const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied. No token provided.' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token is blacklisted
    const client = await pool.connect();
    try {
      const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
      const sessionResult = await client.query(
        'SELECT * FROM user_sessions WHERE token_hash = $1 AND is_revoked = false AND expires_at > NOW()',
        [tokenHash]
      );

      if (sessionResult.rows.length === 0) {
        return res.status(401).json({ error: 'Token has been revoked or expired.' });
      }

      // Get user data
      const userResult = await client.query(
        'SELECT id, email, username, first_name, last_name, total_points, current_rank, is_active FROM users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ error: 'User not found or inactive.' });
      }

      req.user = userResult.rows[0];
      req.token = token;
      next();
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.' });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    const client = await pool.connect();
    try {
      const userResult = await client.query(
        'SELECT id, email, username, first_name, last_name, total_points, current_rank FROM users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );

      if (userResult.rows.length > 0) {
        req.user = userResult.rows[0];
      } else {
        req.user = null;
      }
    } finally {
      client.release();
    }
    
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

// Store JWT token in database (for logout functionality)
const storeToken = async (userId, token) => {
  const client = await pool.connect();
  try {
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    const decoded = jwt.verify(token, JWT_SECRET);
    const expiresAt = new Date(decoded.exp * 1000);

    await client.query(
      'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt]
    );
  } finally {
    client.release();
  }
};

// Revoke JWT token (logout)
const revokeToken = async (token) => {
  const client = await pool.connect();
  try {
    const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
    await client.query(
      'UPDATE user_sessions SET is_revoked = true WHERE token_hash = $1',
      [tokenHash]
    );
  } finally {
    client.release();
  }
};

// Clean up expired tokens
const cleanupExpiredTokens = async () => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM user_sessions WHERE expires_at < NOW() OR is_revoked = true'
    );
    console.log(`🧹 Cleaned up ${result.rowCount} expired/revoked tokens`);
  } finally {
    client.release();
  }
};

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Admin role check middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

// Rate limiting helper
const createRateLimit = (windowMs, max, message) => {
  const rateLimit = require('express-rate-limit');
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

module.exports = {
  generateToken,
  hashPassword,
  comparePassword,
  authenticateToken,
  optionalAuth,
  storeToken,
  revokeToken,
  cleanupExpiredTokens,
  handleValidationErrors,
  requireAdmin,
  createRateLimit
}; 