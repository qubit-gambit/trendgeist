const pool = require('../database/config');
const cacheManager = require('./cache');

class ScoringSystem {
  constructor() {
    this.BASE_POINTS = 100;
    this.CONFIDENCE_MULTIPLIER = 0.01;
    this.STREAK_BONUS = 10;
    this.DIFFICULTY_MULTIPLIERS = {
      'cpi': 1.5,
      'unemployment': 1.3,
      'fed_rate': 2.0,
      'gdp': 1.8,
      'payrolls': 1.4,
      'housing': 1.2,
      'retail_sales': 1.1,
      'ppi': 1.3,
      'custom': 1.0
    };
  }

  // Calculate base points for a prediction
  calculateBasePoints(eventType, confidence, isCorrect) {
    if (!isCorrect) return 0;

    const difficultyMultiplier = this.DIFFICULTY_MULTIPLIERS[eventType] || 1.0;
    const confidenceBonus = confidence * this.CONFIDENCE_MULTIPLIER;
    
    return Math.round(this.BASE_POINTS * difficultyMultiplier * (1 + confidenceBonus));
  }

  // Calculate streak bonus
  calculateStreakBonus(currentStreak) {
    if (currentStreak < 2) return 0;
    
    // Exponential streak bonus with diminishing returns
    return Math.round(this.STREAK_BONUS * Math.log2(currentStreak));
  }

  // Calculate time bonus (bonus for early predictions)
  calculateTimeBonus(predictionTime, eventTime, basePoints) {
    const timeDifference = eventTime - predictionTime;
    const daysDifference = timeDifference / (1000 * 60 * 60 * 24);
    
    if (daysDifference >= 7) {
      return Math.round(basePoints * 0.2); // 20% bonus for week+ early
    } else if (daysDifference >= 3) {
      return Math.round(basePoints * 0.1); // 10% bonus for 3+ days early
    } else if (daysDifference >= 1) {
      return Math.round(basePoints * 0.05); // 5% bonus for 1+ day early
    }
    
    return 0;
  }

  // Main scoring function
  async scorePrediction(predictionId, actualOutcome, resolutionData = {}) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get prediction details
      const predictionResult = await client.query(
        `SELECT p.*, u.win_streak, u.total_points 
         FROM predictions p 
         JOIN users u ON p.user_id = u.id 
         WHERE p.id = $1`,
        [predictionId]
      );
      
      if (predictionResult.rows.length === 0) {
        throw new Error('Prediction not found');
      }
      
      const prediction = predictionResult.rows[0];
      const isCorrect = this.evaluatePrediction(prediction, actualOutcome, resolutionData);
      
      // Calculate points
      const basePoints = this.calculateBasePoints(
        prediction.event_type, 
        prediction.confidence, 
        isCorrect
      );
      
      const timeBonus = this.calculateTimeBonus(
        new Date(prediction.created_at),
        new Date(prediction.expires_at),
        basePoints
      );
      
      let totalPoints = basePoints + timeBonus;
      let newStreak = prediction.win_streak;
      
      if (isCorrect) {
        newStreak += 1;
        const streakBonus = this.calculateStreakBonus(newStreak);
        totalPoints += streakBonus;
      } else {
        newStreak = 0;
      }
      
      // Update prediction with results
      await client.query(
        `UPDATE predictions 
         SET actual_outcome = $1, 
             points_awarded = $2, 
             is_resolved = true, 
             resolution_date = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [actualOutcome, totalPoints, predictionId]
      );
      
      // Update user stats
      await client.query(
        `UPDATE users 
         SET total_points = total_points + $1,
             win_streak = $2,
             correct_predictions = correct_predictions + $3
         WHERE id = $4`,
        [totalPoints, newStreak, isCorrect ? 1 : 0, prediction.user_id]
      );
      
      // Update leaderboard
      await this.updateLeaderboard(client, prediction.user_id, totalPoints);
      
      await client.query('COMMIT');
      
      // Invalidate relevant caches
      await cacheManager.invalidateUserSession(prediction.user_id);
      await this.invalidateLeaderboardCaches();
      
      return {
        predictionId,
        isCorrect,
        pointsAwarded: totalPoints,
        breakdown: {
          basePoints,
          timeBonus,
          streakBonus: totalPoints - basePoints - timeBonus,
          newStreak
        }
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Scoring error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Evaluate if prediction was correct
  evaluatePrediction(prediction, actualOutcome, resolutionData) {
    const predictedOutcome = prediction.predicted_outcome;
    const predictionValue = JSON.parse(prediction.prediction_value);
    
    switch (prediction.event_type) {
      case 'cpi':
        return this.evaluateNumericPrediction(
          predictedOutcome, 
          predictionValue, 
          actualOutcome, 
          resolutionData
        );
      
      case 'unemployment':
        return this.evaluateNumericPrediction(
          predictedOutcome, 
          predictionValue, 
          actualOutcome, 
          resolutionData
        );
      
      case 'fed_rate':
        return this.evaluateFedRatePrediction(
          predictedOutcome, 
          predictionValue, 
          actualOutcome, 
          resolutionData
        );
      
      case 'gdp':
        return this.evaluateNumericPrediction(
          predictedOutcome, 
          predictionValue, 
          actualOutcome, 
          resolutionData
        );
      
      default:
        // Binary yes/no predictions
        return predictedOutcome.toLowerCase() === actualOutcome.toLowerCase();
    }
  }

  // Evaluate numeric predictions (higher/lower/same)
  evaluateNumericPrediction(predictedOutcome, predictionValue, actualOutcome, resolutionData) {
    const threshold = predictionValue.threshold || 0;
    const actualValue = resolutionData.actualValue;
    const previousValue = resolutionData.previousValue;
    
    if (!actualValue || !previousValue) {
      return predictedOutcome.toLowerCase() === actualOutcome.toLowerCase();
    }
    
    const change = actualValue - previousValue;
    
    switch (predictedOutcome) {
      case 'higher':
        return change > threshold;
      case 'lower': 
        return change < -threshold;
      case 'same':
        return Math.abs(change) <= threshold;
      default:
        return false;
    }
  }

  // Evaluate Fed rate predictions (specific to FOMC meetings)
  evaluateFedRatePrediction(predictedOutcome, predictionValue, actualOutcome, resolutionData) {
    const predictedRate = predictionValue.rate;
    const actualRate = resolutionData.actualRate;
    
    if (predictedRate && actualRate) {
      const tolerance = 0.125; // 12.5 basis points tolerance
      return Math.abs(predictedRate - actualRate) <= tolerance;
    }
    
    // Fallback to simple outcome matching
    return predictedOutcome.toLowerCase() === actualOutcome.toLowerCase();
  }

  // Update leaderboard rankings
  async updateLeaderboard(client, userId, pointsAwarded) {
    // Update overall leaderboard
    await client.query(
      `INSERT INTO leaderboard (user_id, points, rank, category, total_predictions, accuracy_percentage)
       SELECT 
         $1,
         u.total_points,
         0, -- Will be updated in rank calculation
         'overall',
         u.total_predictions,
         CASE WHEN u.total_predictions > 0 
              THEN ROUND((u.correct_predictions::numeric / u.total_predictions) * 100, 2)
              ELSE 0 END
       FROM users u 
       WHERE u.id = $1
       ON CONFLICT (user_id, category) 
       DO UPDATE SET 
         points = EXCLUDED.points,
         total_predictions = EXCLUDED.total_predictions,
         accuracy_percentage = EXCLUDED.accuracy_percentage,
         updated_at = CURRENT_TIMESTAMP`,
      [userId]
    );
    
    // Recalculate ranks for overall category
    await this.recalculateRanks(client, 'overall');
  }

  // Recalculate leaderboard ranks
  async recalculateRanks(client, category) {
    await client.query(
      `UPDATE leaderboard 
       SET rank = ranked.new_rank
       FROM (
         SELECT 
           user_id,
           ROW_NUMBER() OVER (ORDER BY points DESC, updated_at ASC) as new_rank
         FROM leaderboard 
         WHERE category = $1
       ) ranked
       WHERE leaderboard.user_id = ranked.user_id 
       AND leaderboard.category = $1`,
      [category]
    );
  }

  // Batch resolve multiple predictions
  async batchResolvePredictions(resolutions) {
    const results = [];
    
    for (const resolution of resolutions) {
      try {
        const result = await this.scorePrediction(
          resolution.predictionId,
          resolution.actualOutcome,
          resolution.resolutionData
        );
        results.push(result);
      } catch (error) {
        console.error(`Failed to resolve prediction ${resolution.predictionId}:`, error);
        results.push({
          predictionId: resolution.predictionId,
          error: error.message
        });
      }
    }
    
    return results;
  }

  // Resolve expired predictions
  async resolveExpiredPredictions() {
    const client = await pool.connect();
    
    try {
      const expiredPredictions = await client.query(
        `SELECT id, event_type, event_title 
         FROM predictions 
         WHERE expires_at < NOW() 
         AND is_resolved = false`
      );
      
      console.log(`Found ${expiredPredictions.rows.length} expired predictions to resolve`);
      
      // Auto-resolve expired predictions as incorrect (0 points)
      for (const prediction of expiredPredictions.rows) {
        await this.scorePrediction(prediction.id, 'expired', {});
      }
      
      return expiredPredictions.rows.length;
      
    } finally {
      client.release();
    }
  }

  // Invalidate leaderboard caches
  async invalidateLeaderboardCaches() {
    const categories = ['overall', 'cpi', 'unemployment', 'fed_rate', 'gdp', 'weekly', 'monthly'];
    
    for (const category of categories) {
      for (let page = 1; page <= 10; page++) { // Clear first 10 pages
        for (const limit of [20, 50, 100]) {
          await cacheManager.del(`leaderboard:${category}_${page}_${limit}`);
        }
      }
    }
    
    await cacheManager.del('leaderboard_stats');
  }

  // Get user's prediction accuracy by category
  async getUserAccuracy(userId, eventType = null) {
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT 
          COUNT(*) as total_predictions,
          COUNT(CASE WHEN points_awarded > 0 THEN 1 END) as correct_predictions,
          AVG(confidence) as avg_confidence,
          SUM(points_awarded) as total_points
        FROM predictions 
        WHERE user_id = $1 AND is_resolved = true
      `;
      
      let params = [userId];
      
      if (eventType) {
        query += ' AND event_type = $2';
        params.push(eventType);
      }
      
      const result = await client.query(query, params);
      const stats = result.rows[0];
      
      const accuracy = stats.total_predictions > 0 
        ? (stats.correct_predictions / stats.total_predictions * 100).toFixed(2)
        : 0;
      
      return {
        totalPredictions: parseInt(stats.total_predictions),
        correctPredictions: parseInt(stats.correct_predictions),
        accuracy: parseFloat(accuracy),
        avgConfidence: stats.avg_confidence ? parseFloat(stats.avg_confidence).toFixed(2) : 0,
        totalPoints: parseInt(stats.total_points || 0)
      };
      
    } finally {
      client.release();
    }
  }
}

// Create singleton instance
const scoringSystem = new ScoringSystem();

// Schedule expired prediction resolution every hour
if (process.env.NODE_ENV !== 'test') {
  setInterval(async () => {
    try {
      const resolved = await scoringSystem.resolveExpiredPredictions();
      if (resolved > 0) {
        console.log(`✅ Auto-resolved ${resolved} expired predictions`);
      }
    } catch (error) {
      console.error('Error resolving expired predictions:', error);
    }
  }, 60 * 60 * 1000); // Every hour
}

module.exports = scoringSystem; 