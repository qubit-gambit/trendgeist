const express = require('express');
const { body } = require('express-validator');
const pool = require('../database/config');
const {
  generateToken,
  hashPassword,
  comparePassword,
  authenticateToken,
  storeToken,
  revokeToken,
  handleValidationErrors,
  createRateLimit
} = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Rate limiting for auth endpoints
const authRateLimit = createRateLimit(15 * 60 * 1000, 5, 'Too many authentication attempts');
const loginRateLimit = createRateLimit(15 * 60 * 1000, 10, 'Too many login attempts');

// Validation rules
const signupValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('username').isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/).withMessage('Username must be 3-30 characters and contain only letters, numbers, and underscores'),
  body('first_name').optional().isLength({ min: 1, max: 50 }).withMessage('First name must be 1-50 characters'),
  body('last_name').optional().isLength({ min: 1, max: 50 }).withMessage('Last name must be 1-50 characters')
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
];

// POST /api/auth/signup
router.post('/signup', authRateLimit, signupValidation, handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { email, password, username, first_name, last_name } = req.body;
    
    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        error: 'User with this email or username already exists'
      });
    }
    
    // Hash password
    const hashedPassword = await hashPassword(password);
    
    // Create user
    const result = await client.query(
      `INSERT INTO users (email, password, username, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, username, first_name, last_name, created_at`,
      [email, hashedPassword, username, first_name || null, last_name || null]
    );
    
    const user = result.rows[0];
    
    // Generate token
    const token = generateToken(user.id);
    await storeToken(user.id, token);
    
    // Create initial leaderboard entry
    await client.query(
      'INSERT INTO leaderboard (user_id, points, rank) VALUES ($1, 0, 0)',
      [user.id]
    );
    
    // Cache user session
    await cacheManager.cacheUserSession(user.id, {
      ...user,
      total_points: 0,
      current_rank: 0
    });
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        total_points: 0,
        current_rank: 0,
        created_at: user.created_at
      },
      token
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post('/login', loginRateLimit, loginValidation, handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { email, password } = req.body;
    
    // Get user with password
    const result = await client.query(
      `SELECT u.*, l.points as total_points, l.rank as current_rank 
       FROM users u 
       LEFT JOIN leaderboard l ON u.id = l.user_id AND l.category = 'overall'
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const user = result.rows[0];
    
    // Verify password
    const isValidPassword = await comparePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Update last login
    await client.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // Generate token
    const token = generateToken(user.id);
    await storeToken(user.id, token);
    
    // Cache user session
    const userData = {
      id: user.id,
      email: user.email,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      total_points: user.total_points || 0,
      current_rank: user.current_rank || 0
    };
    
    await cacheManager.cacheUserSession(user.id, userData);
    
    res.json({
      message: 'Login successful',
      user: userData,
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Revoke token
    await revokeToken(req.token);
    
    // Clear cached session
    await cacheManager.invalidateUserSession(req.user.id);
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Check cache first
    const cachedUser = await cacheManager.getUserSession(req.user.id);
    if (cachedUser) {
      return res.json({ user: cachedUser });
    }
    
    // Get fresh user data
    const result = await client.query(
      `SELECT u.id, u.email, u.username, u.first_name, u.last_name, u.avatar_url, u.bio,
              u.total_points, u.current_rank, u.win_streak, u.total_predictions, 
              u.correct_predictions, u.created_at, u.last_login,
              CASE WHEN u.total_predictions > 0 
                   THEN ROUND((u.correct_predictions::numeric / u.total_predictions) * 100, 2)
                   ELSE 0 
              END as accuracy_percentage
       FROM users u 
       WHERE u.id = $1 AND u.is_active = true`,
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    // Cache the user data
    await cacheManager.cacheUserSession(user.id, user);
    
    res.json({ user });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticateToken, [
  body('first_name').optional().isLength({ min: 1, max: 50 }).withMessage('First name must be 1-50 characters'),
  body('last_name').optional().isLength({ min: 1, max: 50 }).withMessage('Last name must be 1-50 characters'),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio must be less than 500 characters'),
  body('avatar_url').optional().isURL().withMessage('Avatar URL must be a valid URL')
], handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { first_name, last_name, bio, avatar_url } = req.body;
    
    const result = await client.query(
      `UPDATE users 
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           bio = COALESCE($3, bio),
           avatar_url = COALESCE($4, avatar_url)
       WHERE id = $5 AND is_active = true
       RETURNING id, email, username, first_name, last_name, bio, avatar_url`,
      [first_name, last_name, bio, avatar_url, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const updatedUser = result.rows[0];
    
    // Invalidate cache
    await cacheManager.invalidateUserSession(req.user.id);
    
    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
    
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticateToken, [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { current_password, new_password } = req.body;
    
    // Get current password hash
    const result = await client.query(
      'SELECT password FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    // Verify current password
    const isValidPassword = await comparePassword(current_password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const hashedPassword = await hashPassword(new_password);
    
    // Update password
    await client.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, req.user.id]
    );
    
    // Revoke all existing tokens for this user
    await client.query(
      'UPDATE user_sessions SET is_revoked = true WHERE user_id = $1',
      [req.user.id]
    );
    
    // Clear cached session
    await cacheManager.invalidateUserSession(req.user.id);
    
    res.json({ message: 'Password changed successfully. Please login again.' });
    
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/auth/account
router.delete('/account', authenticateToken, [
  body('password').notEmpty().withMessage('Password is required for account deletion')
], handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { password } = req.body;
    
    // Get current password hash
    const result = await client.query(
      'SELECT password FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    
    // Verify password
    const isValidPassword = await comparePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Password is incorrect' });
    }
    
    // Soft delete user (set inactive)
    await client.query(
      'UPDATE users SET is_active = false WHERE id = $1',
      [req.user.id]
    );
    
    // Revoke all tokens
    await client.query(
      'UPDATE user_sessions SET is_revoked = true WHERE user_id = $1',
      [req.user.id]
    );
    
    // Clear cached session
    await cacheManager.invalidateUserSession(req.user.id);
    
    res.json({ message: 'Account deleted successfully' });
    
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router; 