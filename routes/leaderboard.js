const express = require('express');
const { query } = require('express-validator');
const pool = require('../database/config');
const { optionalAuth, handleValidationErrors } = require('../middleware/auth');
const cacheManager = require('../utils/cache');

const router = express.Router();

// GET /api/leaderboard - Get leaderboard by category
router.get('/', optionalAuth, [
  query('category').optional().isIn(['overall', 'cpi', 'unemployment', 'fed_rate', 'gdp', 'weekly', 'monthly']).withMessage('Invalid category'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], handleValidationErrors, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const category = req.query.category || 'overall';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    // Check cache first
    const cacheKey = `${category}_${page}_${limit}`;
    const cachedLeaderboard = await cacheManager.getLeaderboard(cacheKey);
    
    if (cachedLeaderboard) {
      return res.json(cachedLeaderboard);
    }
    
    let query = '';
    let params = [limit, offset];
    
    if (category === 'overall') {
      query = `
        SELECT 
          ROW_NUMBER() OVER (ORDER BY l.points DESC, u.created_at ASC) as position,
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.avatar_url,
          l.points,
          l.win_streak,
          l.total_predictions,
          l.accuracy_percentage,
          l.badge,
          CASE 
            WHEN l.points >= 10000 THEN 'Legend'
            WHEN l.points >= 5000 THEN 'Expert'
            WHEN l.points >= 1000 THEN 'Pro'
            WHEN l.points >= 500 THEN 'Advanced'
            WHEN l.points >= 100 THEN 'Intermediate'
            ELSE 'Beginner'
          END as tier
        FROM leaderboard l
        JOIN users u ON l.user_id = u.id
        WHERE l.category = 'overall' AND u.is_active = true
        ORDER BY l.points DESC, u.created_at ASC
        LIMIT $1 OFFSET $2
      `;
    } else if (['weekly', 'monthly'].includes(category)) {
      // Time-based leaderboards
      const timeFilter = category === 'weekly' ? '7 days' : '30 days';
      query = `
        SELECT 
          ROW_NUMBER() OVER (ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC) as position,
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.avatar_url,
          SUM(p.points_awarded) as points,
          COUNT(p.id) as total_predictions,
          COUNT(CASE WHEN p.points_awarded > 0 THEN 1 END) as correct_predictions,
          CASE 
            WHEN COUNT(p.id) > 0 
            THEN ROUND((COUNT(CASE WHEN p.points_awarded > 0 THEN 1 END)::numeric / COUNT(p.id)) * 100, 2)
            ELSE 0 
          END as accuracy_percentage
        FROM users u
        LEFT JOIN predictions p ON u.id = p.user_id 
          AND p.is_resolved = true 
          AND p.created_at >= NOW() - INTERVAL '${timeFilter}'
        WHERE u.is_active = true
        GROUP BY u.id, u.username, u.first_name, u.last_name, u.avatar_url
        HAVING SUM(p.points_awarded) > 0
        ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC
        LIMIT $1 OFFSET $2
      `;
    } else {
      // Category-specific leaderboards (cpi, unemployment, etc.)
      query = `
        SELECT 
          ROW_NUMBER() OVER (ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC) as position,
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.avatar_url,
          SUM(p.points_awarded) as points,
          COUNT(p.id) as total_predictions,
          COUNT(CASE WHEN p.points_awarded > 0 THEN 1 END) as correct_predictions,
          CASE 
            WHEN COUNT(p.id) > 0 
            THEN ROUND((COUNT(CASE WHEN p.points_awarded > 0 THEN 1 END)::numeric / COUNT(p.id)) * 100, 2)
            ELSE 0 
          END as accuracy_percentage
        FROM users u
        LEFT JOIN predictions p ON u.id = p.user_id 
          AND p.event_type = $3
          AND p.is_resolved = true
        WHERE u.is_active = true
        GROUP BY u.id, u.username, u.first_name, u.last_name, u.avatar_url
        HAVING COUNT(p.id) >= 3  -- Minimum 3 predictions to be ranked
        ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC
        LIMIT $1 OFFSET $2
      `;
      params.push(category);
    }
    
    const result = await client.query(query, params);
    
    // Get total count for pagination
    let countQuery = '';
    let countParams = [];
    
    if (category === 'overall') {
      countQuery = `
        SELECT COUNT(*) FROM leaderboard l
        JOIN users u ON l.user_id = u.id
        WHERE l.category = 'overall' AND u.is_active = true
      `;
    } else if (['weekly', 'monthly'].includes(category)) {
      const timeFilter = category === 'weekly' ? '7 days' : '30 days';
      countQuery = `
        SELECT COUNT(*) FROM (
          SELECT u.id
          FROM users u
          LEFT JOIN predictions p ON u.id = p.user_id 
            AND p.is_resolved = true 
            AND p.created_at >= NOW() - INTERVAL '${timeFilter}'
          WHERE u.is_active = true
          GROUP BY u.id
          HAVING SUM(p.points_awarded) > 0
        ) as subquery
      `;
    } else {
      countQuery = `
        SELECT COUNT(*) FROM (
          SELECT u.id
          FROM users u
          LEFT JOIN predictions p ON u.id = p.user_id 
            AND p.event_type = $1
            AND p.is_resolved = true
          WHERE u.is_active = true
          GROUP BY u.id
          HAVING COUNT(p.id) >= 3
        ) as subquery
      `;
      countParams.push(category);
    }
    
    const countResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);
    
    // Get user's rank if authenticated
    let userRank = null;
    if (req.user) {
      let userRankQuery = '';
      let userRankParams = [req.user.id];
      
      if (category === 'overall') {
        userRankQuery = `
          SELECT position FROM (
            SELECT 
              u.id,
              ROW_NUMBER() OVER (ORDER BY l.points DESC, u.created_at ASC) as position
            FROM leaderboard l
            JOIN users u ON l.user_id = u.id
            WHERE l.category = 'overall' AND u.is_active = true
          ) ranked
          WHERE id = $1
        `;
      } else if (['weekly', 'monthly'].includes(category)) {
        const timeFilter = category === 'weekly' ? '7 days' : '30 days';
        userRankQuery = `
          SELECT position FROM (
            SELECT 
              u.id,
              ROW_NUMBER() OVER (ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC) as position
            FROM users u
            LEFT JOIN predictions p ON u.id = p.user_id 
              AND p.is_resolved = true 
              AND p.created_at >= NOW() - INTERVAL '${timeFilter}'
            WHERE u.is_active = true
            GROUP BY u.id
            HAVING SUM(p.points_awarded) > 0
          ) ranked
          WHERE id = $1
        `;
      } else {
        userRankQuery = `
          SELECT position FROM (
            SELECT 
              u.id,
              ROW_NUMBER() OVER (ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC) as position
            FROM users u
            LEFT JOIN predictions p ON u.id = p.user_id 
              AND p.event_type = $2
              AND p.is_resolved = true
            WHERE u.is_active = true
            GROUP BY u.id
            HAVING COUNT(p.id) >= 3
          ) ranked
          WHERE id = $1
        `;
        userRankParams.push(category);
      }
      
      const userRankResult = await client.query(userRankQuery, userRankParams);
      userRank = userRankResult.rows.length > 0 ? userRankResult.rows[0].position : null;
    }
    
    const response = {
      leaderboard: result.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      category,
      userRank
    };
    
    // Cache the result for 5 minutes
    await cacheManager.cacheLeaderboard(cacheKey, response, 300);
    
    res.json(response);
    
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/leaderboard/user/:userId - Get specific user's ranking across categories
router.get('/user/:userId', optionalAuth, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const userId = req.params.userId;
    
    // Verify user exists
    const userResult = await client.query(
      'SELECT id, username, first_name, last_name, avatar_url FROM users WHERE id = $1 AND is_active = true',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Get rankings across all categories
    const rankings = {};
    
    // Overall ranking
    const overallRank = await client.query(`
      SELECT 
        position,
        points,
        total_predictions,
        accuracy_percentage
      FROM (
        SELECT 
          l.user_id,
          ROW_NUMBER() OVER (ORDER BY l.points DESC, u.created_at ASC) as position,
          l.points,
          l.total_predictions,
          l.accuracy_percentage
        FROM leaderboard l
        JOIN users u ON l.user_id = u.id
        WHERE l.category = 'overall' AND u.is_active = true
      ) ranked
      WHERE user_id = $1
    `, [userId]);
    
    rankings.overall = overallRank.rows.length > 0 ? overallRank.rows[0] : null;
    
    // Category-specific rankings
    const categories = ['cpi', 'unemployment', 'fed_rate', 'gdp'];
    
    for (const category of categories) {
      const categoryRank = await client.query(`
        SELECT 
          position,
          points,
          total_predictions,
          accuracy_percentage
        FROM (
          SELECT 
            u.id as user_id,
            ROW_NUMBER() OVER (ORDER BY SUM(p.points_awarded) DESC, MIN(u.created_at) ASC) as position,
            SUM(p.points_awarded) as points,
            COUNT(p.id) as total_predictions,
            CASE 
              WHEN COUNT(p.id) > 0 
              THEN ROUND((COUNT(CASE WHEN p.points_awarded > 0 THEN 1 END)::numeric / COUNT(p.id)) * 100, 2)
              ELSE 0 
            END as accuracy_percentage
          FROM users u
          LEFT JOIN predictions p ON u.id = p.user_id 
            AND p.event_type = $2
            AND p.is_resolved = true
          WHERE u.is_active = true
          GROUP BY u.id
          HAVING COUNT(p.id) >= 3
        ) ranked
        WHERE user_id = $1
      `, [userId, category]);
      
      rankings[category] = categoryRank.rows.length > 0 ? categoryRank.rows[0] : null;
    }
    
    res.json({
      user,
      rankings
    });
    
  } catch (error) {
    console.error('Get user ranking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/leaderboard/stats - Get leaderboard statistics
router.get('/stats', async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Check cache first
    const cachedStats = await cacheManager.get('leaderboard_stats');
    if (cachedStats) {
      return res.json(cachedStats);
    }
    
    const stats = await client.query(`
      SELECT 
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT CASE WHEN l.points > 0 THEN u.id END) as active_predictors,
        AVG(l.points) as avg_points,
        MAX(l.points) as max_points,
        COUNT(DISTINCT CASE WHEN l.points >= 1000 THEN u.id END) as pro_users,
        COUNT(DISTINCT CASE WHEN l.points >= 5000 THEN u.id END) as expert_users,
        COUNT(DISTINCT CASE WHEN l.points >= 10000 THEN u.id END) as legend_users
      FROM users u
      LEFT JOIN leaderboard l ON u.id = l.user_id AND l.category = 'overall'
      WHERE u.is_active = true
    `);
    
    const response = {
      stats: stats.rows[0],
      tiers: {
        beginner: { min: 0, max: 99, color: '#64748b' },
        intermediate: { min: 100, max: 499, color: '#059669' },
        advanced: { min: 500, max: 999, color: '#dc2626' },
        pro: { min: 1000, max: 4999, color: '#7c3aed' },
        expert: { min: 5000, max: 9999, color: '#ea580c' },
        legend: { min: 10000, max: null, color: '#fbbf24' }
      }
    };
    
    // Cache for 10 minutes
    await cacheManager.set('leaderboard_stats', response, 600);
    
    res.json(response);
    
  } catch (error) {
    console.error('Get leaderboard stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router; 