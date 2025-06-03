const express = require('express');
const { body, query } = require('express-validator');
const pool = require('../database/config');
const { authenticateToken, optionalAuth, handleValidationErrors } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// Validation rules
const predictionValidation = [
  body('event_type').isIn(['cpi', 'unemployment', 'fed_rate', 'gdp', 'payrolls', 'housing', 'retail_sales', 'ppi', 'custom']).withMessage('Invalid event type'),
  body('event_title').isLength({ min: 10, max: 500 }).withMessage('Event title must be 10-500 characters'),
  body('prediction_value').notEmpty().withMessage('Prediction value is required'),
  body('confidence').isInt({ min: 0, max: 100 }).withMessage('Confidence must be between 0 and 100'),
  body('predicted_outcome').isIn(['yes', 'no', 'higher', 'lower', 'same', 'custom']).withMessage('Invalid predicted outcome'),
  body('expires_at').isISO8601().withMessage('Valid expiration date is required')
];

const updatePredictionValidation = [
  body('prediction_value').optional().notEmpty().withMessage('Prediction value cannot be empty'),
  body('confidence').optional().isInt({ min: 0, max: 100 }).withMessage('Confidence must be between 0 and 100'),
  body('predicted_outcome').optional().isIn(['yes', 'no', 'higher', 'lower', 'same', 'custom']).withMessage('Invalid predicted outcome')
];

// POST /api/predictions - Create new prediction
router.post('/', authenticateToken, predictionValidation, handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const {
      event_type,
      event_title,
      prediction_value,
      confidence,
      predicted_outcome,
      expires_at,
      metadata
    } = req.body;
    
    // Check if prediction deadline is in the future
    const expirationDate = new Date(expires_at);
    if (expirationDate <= new Date()) {
      return res.status(400).json({ error: 'Prediction expiration must be in the future' });
    }
    
    // Check if user already has a prediction for this event
    const existingPrediction = await client.query(
      'SELECT id FROM predictions WHERE user_id = $1 AND event_title = $2 AND is_resolved = false',
      [req.user.id, event_title]
    );
    
    if (existingPrediction.rows.length > 0) {
      return res.status(400).json({ error: 'You already have an active prediction for this event' });
    }
    
    // Create prediction
    const result = await client.query(
      `INSERT INTO predictions (user_id, event_type, event_title, prediction_value, confidence, predicted_outcome, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.id, event_type, event_title, JSON.stringify(prediction_value), confidence, predicted_outcome, expires_at, JSON.stringify(metadata || {})]
    );
    
    const prediction = result.rows[0];
    
    // Update user's total predictions count
    await client.query(
      'UPDATE users SET total_predictions = total_predictions + 1 WHERE id = $1',
      [req.user.id]
    );
    
    // Invalidate user cache
    await cacheManager.invalidateUserSession(req.user.id);
    
    res.status(201).json({
      message: 'Prediction created successfully',
      prediction: {
        ...prediction,
        prediction_value: JSON.parse(prediction.prediction_value),
        metadata: JSON.parse(prediction.metadata)
      }
    });
    
  } catch (error) {
    console.error('Create prediction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/predictions - Get user's predictions
router.get('/', authenticateToken, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('event_type').optional().isIn(['cpi', 'unemployment', 'fed_rate', 'gdp', 'payrolls', 'housing', 'retail_sales', 'ppi', 'custom']).withMessage('Invalid event type'),
  query('status').optional().isIn(['active', 'resolved', 'all']).withMessage('Invalid status filter')
], handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const eventType = req.query.event_type;
    const status = req.query.status || 'all';
    
    let whereClause = 'WHERE user_id = $1';
    let params = [req.user.id];
    let paramCount = 1;
    
    if (eventType) {
      paramCount++;
      whereClause += ` AND event_type = $${paramCount}`;
      params.push(eventType);
    }
    
    if (status === 'active') {
      whereClause += ' AND is_resolved = false AND expires_at > NOW()';
    } else if (status === 'resolved') {
      whereClause += ' AND is_resolved = true';
    }
    
    // Get predictions
    const predictionsResult = await client.query(
      `SELECT * FROM predictions 
       ${whereClause}
       ORDER BY created_at DESC 
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );
    
    // Get total count
    const countResult = await client.query(
      `SELECT COUNT(*) FROM predictions ${whereClause}`,
      params
    );
    
    const predictions = predictionsResult.rows.map(prediction => ({
      ...prediction,
      prediction_value: JSON.parse(prediction.prediction_value),
      metadata: JSON.parse(prediction.metadata || '{}')
    }));
    
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);
    
    res.json({
      predictions,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
    
  } catch (error) {
    console.error('Get predictions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/predictions/:id - Get specific prediction
router.get('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM predictions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prediction not found' });
    }
    
    const prediction = result.rows[0];
    
    res.json({
      prediction: {
        ...prediction,
        prediction_value: JSON.parse(prediction.prediction_value),
        metadata: JSON.parse(prediction.metadata || '{}')
      }
    });
    
  } catch (error) {
    console.error('Get prediction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT /api/predictions/:id - Update prediction
router.put('/:id', authenticateToken, updatePredictionValidation, handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { prediction_value, confidence, predicted_outcome, metadata } = req.body;
    
    // Check if prediction exists and belongs to user
    const existingResult = await client.query(
      'SELECT * FROM predictions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prediction not found' });
    }
    
    const existingPrediction = existingResult.rows[0];
    
    // Check if prediction is still editable (not resolved and not expired)
    if (existingPrediction.is_resolved) {
      return res.status(400).json({ error: 'Cannot update resolved prediction' });
    }
    
    if (new Date(existingPrediction.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'Cannot update expired prediction' });
    }
    
    // Update prediction
    const result = await client.query(
      `UPDATE predictions 
       SET prediction_value = COALESCE($1, prediction_value),
           confidence = COALESCE($2, confidence),
           predicted_outcome = COALESCE($3, predicted_outcome),
           metadata = COALESCE($4, metadata)
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [
        prediction_value ? JSON.stringify(prediction_value) : null,
        confidence,
        predicted_outcome,
        metadata ? JSON.stringify(metadata) : null,
        req.params.id,
        req.user.id
      ]
    );
    
    const updatedPrediction = result.rows[0];
    
    res.json({
      message: 'Prediction updated successfully',
      prediction: {
        ...updatedPrediction,
        prediction_value: JSON.parse(updatedPrediction.prediction_value),
        metadata: JSON.parse(updatedPrediction.metadata || '{}')
      }
    });
    
  } catch (error) {
    console.error('Update prediction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/predictions/:id - Delete prediction (only if not resolved)
router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Check if prediction exists and belongs to user
    const existingResult = await client.query(
      'SELECT * FROM predictions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Prediction not found' });
    }
    
    const existingPrediction = existingResult.rows[0];
    
    // Check if prediction can be deleted (not resolved)
    if (existingPrediction.is_resolved) {
      return res.status(400).json({ error: 'Cannot delete resolved prediction' });
    }
    
    // Delete prediction
    await client.query(
      'DELETE FROM predictions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    
    // Update user's total predictions count
    await client.query(
      'UPDATE users SET total_predictions = total_predictions - 1 WHERE id = $1',
      [req.user.id]
    );
    
    // Invalidate user cache
    await cacheManager.invalidateUserSession(req.user.id);
    
    res.json({ message: 'Prediction deleted successfully' });
    
  } catch (error) {
    console.error('Delete prediction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/predictions/public/recent - Get recent public predictions (for community)
router.get('/public/recent', optionalAuth, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('event_type').optional().isIn(['cpi', 'unemployment', 'fed_rate', 'gdp', 'payrolls', 'housing', 'retail_sales', 'ppi', 'custom']).withMessage('Invalid event type')
], handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const eventType = req.query.event_type;
    
    let whereClause = 'WHERE p.expires_at > NOW()';
    let params = [];
    let paramCount = 0;
    
    if (eventType) {
      paramCount++;
      whereClause += ` AND p.event_type = $${paramCount}`;
      params.push(eventType);
    }
    
    const result = await client.query(
      `SELECT p.id, p.event_type, p.event_title, p.predicted_outcome, p.confidence, 
              p.created_at, p.expires_at, u.username, u.total_points
       FROM predictions p
       JOIN users u ON p.user_id = u.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );
    
    res.json({
      predictions: result.rows,
      pagination: {
        page,
        limit,
        hasNextPage: result.rows.length === limit
      }
    });
    
  } catch (error) {
    console.error('Get public predictions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/predictions/stats - Get user's prediction statistics
router.get('/stats', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      `SELECT 
         COUNT(*) as total_predictions,
         COUNT(CASE WHEN is_resolved = true AND points_awarded > 0 THEN 1 END) as correct_predictions,
         COUNT(CASE WHEN is_resolved = true THEN 1 END) as resolved_predictions,
         AVG(CASE WHEN is_resolved = true THEN confidence END) as avg_confidence,
         SUM(points_awarded) as total_points_earned,
         MAX(win_streak) as best_streak
       FROM predictions p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [req.user.id]
    );
    
    const stats = result.rows[0];
    const accuracy = stats.resolved_predictions > 0 
      ? (stats.correct_predictions / stats.resolved_predictions * 100).toFixed(2)
      : 0;
    
    res.json({
      stats: {
        ...stats,
        accuracy_percentage: parseFloat(accuracy),
        avg_confidence: stats.avg_confidence ? parseFloat(stats.avg_confidence).toFixed(2) : 0
      }
    });
    
  } catch (error) {
    console.error('Get prediction stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router; 