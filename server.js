const express = require('express');
const http = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');
const winston = require('winston');

// Load environment variables
dotenv.config();

// Import custom modules
const pool = require('./database/config');
const cacheManager = require('./utils/cache');
const WebSocketManager = require('./utils/websocket');
const scoringSystem = require('./utils/scoring');
const { cleanupExpiredTokens } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const predictionRoutes = require('./routes/predictions');
const leaderboardRoutes = require('./routes/leaderboard');
const paymentRoutes = require('./routes/payments');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Setup logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'trendgeist-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || [
    "http://localhost:3000", 
    "http://localhost:8000",
    "https://qubit-gambit.github.io"
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Serve static files
app.use(express.static('.', {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

// Initialize WebSocket
const wsManager = new WebSocketManager(server);

// Initialize Gemini AI
let genAI = null;
let model = null;

if (process.env.GEMINI_API_KEY) {
  console.log('Initializing Gemini AI...');
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  console.log('✅ Gemini AI initialized');
} else {
  console.warn('⚠️  GEMINI_API_KEY not provided - AI features will be disabled');
}

// Economic indicators data
const indicators = {
  'cpi': 'Consumer Price Index',
  'gdp': 'Gross Domestic Product',
  'unemployment': 'Unemployment Rate',
  'fed_rate': 'Federal Funds Rate',
  'ppi': 'Producer Price Index',
  'retail_sales': 'Retail Sales',
  'housing_starts': 'Housing Starts',
  'industrial_production': 'Industrial Production',
  'yield_curve_analysis': 'US Treasury Yield Curve Analysis',
  'inflation_analysis': 'Comprehensive Inflation Analysis',
  'phillips_curve_analysis': 'Phillips Curve & Economic Theory Analysis'
};

// Generate explanation for economic indicator using Gemini
async function generateExplanation(indicator, currentValue, trend) {
  if (!model) {
    return 'AI analysis temporarily unavailable.';
  }

  let prompt;
  
  // Check if this is a comprehensive analysis request
  if (indicator === 'yield_curve_analysis') {
    const yieldData = JSON.parse(currentValue);
    prompt = `
    As a senior fixed income analyst, provide a comprehensive yield curve analysis based on this data:
    
    Current Yields: ${JSON.stringify(yieldData.current_yields)}
    Key Inversions: 3M-10Y (${yieldData.inversions['3M_10Y'].spread} bps, ${yieldData.inversions['3M_10Y'].duration_days} days), 2Y-10Y (${yieldData.inversions['2Y_10Y'].spread} bps, ${yieldData.inversions['2Y_10Y'].duration_days} days)
    Curve Shape: ${yieldData.curve_shape}
    Recession Probability: ${yieldData.recession_probability}%
    
    Provide a professional analysis covering:
    1. Current yield curve implications for monetary policy
    2. Recession probability assessment based on historical inversion patterns
    3. Expected Federal Reserve actions given curve shape
    4. Investment implications for fixed income portfolios
    5. Timeline outlook for potential economic inflection points
    
    Write in Bloomberg Terminal style with specific actionable insights (4-5 sentences).
    `;
  } else if (indicator === 'inflation_analysis') {
    const inflationData = JSON.parse(currentValue);
    prompt = `
    As a macroeconomic inflation specialist, analyze this comprehensive inflation data:
    
    Current CPI: ${inflationData.current_cpi}% (vs Fed target ${inflationData.fed_target}%)
    Core CPI: ${inflationData.core_cpi}%
    Monthly Change: ${inflationData.mom_change}%
    Trend: ${inflationData.trend}
    6-Month History: ${inflationData.recent_history.map(h => `${h.month}: ${h.cpi}%`).join(', ')}
    Key Components: Housing (+${inflationData.components.housing.impact}%), Energy (${inflationData.components.energy.impact}%), Services (+${inflationData.components.services.impact}%)
    
    Provide professional analysis covering:
    1. Disinflation trajectory assessment vs Fed 2% target
    2. Component-level drivers and their persistence
    3. Federal Reserve policy implications
    4. Forward-looking inflation expectations
    5. Investment positioning recommendations
    
    Write in professional economic research style (4-5 sentences).
    `;
  } else if (indicator === 'phillips_curve_analysis') {
    const economicData = JSON.parse(currentValue);
    prompt = `
    As a senior economist specializing in macroeconomic theory, analyze this Phillips Curve data:
    
    Current State: Unemployment ${economicData.current_indicators.unemployment}%, CPI Inflation ${economicData.current_indicators.cpi_inflation}%, GDP Growth ${economicData.current_indicators.gdp_growth}%
    
    Correlations: Unemployment vs CPI (${economicData.correlations.unemployment_vs_cpi}), GDP vs Unemployment (${economicData.correlations.gdp_vs_unemployment})
    Phillips Curve Validity: ${economicData.correlations.phillips_validity}%
    
    Economic Theory Status: Phillips Curve ${economicData.theory_status.phillips_curve.status} (${economicData.theory_status.phillips_curve.confidence}% confidence), Okun's Law ${economicData.theory_status.okuns_law.status} (${economicData.theory_status.okuns_law.confidence}% confidence)
    
    Provide comprehensive economic theory analysis covering:
    1. Phillips Curve relationship validity in current environment
    2. Labor market dynamics vs inflation pressures
    3. Federal Reserve dual mandate implications
    4. Economic theory breakdown risks
    5. Policy effectiveness assessment
    
    Write as institutional economic research with specific policy insights (4-5 sentences).
    `;
  } else {
    // Standard indicator analysis
    prompt = `
    As an economic expert, provide a clear, concise explanation (max 3 sentences) of the current ${indicators[indicator]} 
    situation. Current value: ${currentValue}. Recent trend: ${trend}. 
    Include what this means for the economy and what to watch for next.
    Focus on actionable insights for economic forecasters.
    `;
  }

  try {
    console.log('Sending request to Gemini for indicator:', indicator);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini response received, length:', text.length);
    return text.trim();
  } catch (error) {
    console.error('Gemini API error details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText
    });
    return 'Unable to generate explanation at this time.';
  }
}

// Generate prediction insights using Gemini
async function generatePredictionInsight(indicator, currentValue, trend, userConfidence) {
  if (!model) {
    return 'AI coaching temporarily unavailable.';
  }

  const prompt = `
  As an AI economic coach, analyze this prediction scenario:
  Indicator: ${indicators[indicator]}
  Current Value: ${currentValue}
  Trend: ${trend}
  User Confidence Level: ${userConfidence}%
  
  Provide specific coaching advice (2-3 sentences) on whether their confidence level is appropriate given current economic conditions. 
  Include calibration suggestions if needed.
  `;

  try {
    console.log('Sending coaching request to Gemini for indicator:', indicator);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini coaching response received, length:', text.length);
    return text.trim();
  } catch (error) {
    console.error('Gemini coaching API error:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText
    });
    return 'Unable to generate coaching insight at this time.';
  }
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/payments', paymentRoutes);

// Legacy Gemini AI endpoints (for backward compatibility)
app.post('/api/explain-indicator', async (req, res) => {
  const { indicator, currentValue, trend } = req.body;
  
  console.log('Received explanation request:', { indicator, currentValue, trend });
  
  // Allow comprehensive analysis types
  const validIndicators = [
    ...Object.keys(indicators),
    'yield_curve_analysis',
    'inflation_analysis', 
    'phillips_curve_analysis'
  ];
  
  if (!indicator || !validIndicators.includes(indicator)) {
    return res.status(400).json({ error: 'Invalid indicator' });
  }

  try {
    const explanation = await generateExplanation(indicator, currentValue, trend);
    res.json({ explanation });
  } catch (error) {
    console.error('Error generating explanation:', error);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
});

app.post('/api/coaching-insight', async (req, res) => {
  const { indicator, currentValue, trend, confidence } = req.body;
  
  console.log('Received coaching request:', { indicator, currentValue, trend, confidence });
  
  if (!indicator || !indicators[indicator]) {
    return res.status(400).json({ error: 'Invalid indicator' });
  }

  try {
    const insight = await generatePredictionInsight(indicator, currentValue, trend, confidence);
    res.json({ insight });
  } catch (error) {
    console.error('Error generating coaching insight:', error);
    res.status(500).json({ error: 'Failed to generate coaching insight' });
  }
});

// Admin endpoint to resolve predictions
app.post('/api/admin/resolve-prediction', async (req, res) => {
  try {
    const { predictionId, actualOutcome, resolutionData } = req.body;
    
    const result = await scoringSystem.scorePrediction(predictionId, actualOutcome, resolutionData);
    
    // Broadcast the resolution
    if (wsManager) {
      const user = { id: result.userId, username: 'System' }; // You'd get real user data
      wsManager.broadcastPredictionResolution(predictionId, result, user);
    }
    
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error resolving prediction:', error);
    res.status(500).json({ error: 'Failed to resolve prediction' });
  }
});

// WebSocket stats endpoint
app.get('/api/websocket/stats', (req, res) => {
  if (wsManager) {
    res.json(wsManager.getConnectionStats());
  } else {
    res.status(503).json({ error: 'WebSocket not available' });
  }
});

// Cache stats endpoint
app.get('/api/cache/stats', async (req, res) => {
  try {
    const stats = {
      isConnected: cacheManager.isConnected,
      type: cacheManager.client ? 'Redis' : 'Memory'
    };
    
    if (cacheManager.memoryCache) {
      stats.memoryEntries = cacheManager.memoryCache.size;
    }
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbResult = await pool.query('SELECT NOW()');
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: dbResult.rows.length > 0 ? 'healthy' : 'unhealthy',
        cache: cacheManager.isConnected ? 'healthy' : 'unhealthy',
        websocket: wsManager ? 'healthy' : 'unhealthy',
        ai: model ? 'healthy' : 'disabled'
      },
      version: '2.0.0'
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize services
async function initializeServices() {
  try {
    console.log('🚀 Initializing services...');
    
    // Initialize cache manager
    await cacheManager.connect();
    
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection verified');
    
    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    process.exit(1);
  }
}

// Cleanup function
async function cleanup() {
  console.log('🧹 Starting cleanup...');
  
  try {
    if (wsManager) {
      wsManager.cleanup();
    }
    
    await cacheManager.disconnect();
    await pool.end();
    
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3000;

initializeServices().then(() => {
  server.listen(PORT, () => {
    console.log(`
    🎉 Trendgeist Server Started!
    
    🌐 Server: http://localhost:${PORT}
    🔌 WebSocket: Available
    💾 Database: PostgreSQL
    🚀 Cache: ${cacheManager.client ? 'Redis' : 'Memory'}
    🤖 AI: ${model ? 'Gemini 1.5 Flash' : 'Disabled'}
    
    📊 Health Check: http://localhost:${PORT}/health
    📈 API Docs: Available in README.md
    `);
  });
});

// Graceful shutdown
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Schedule periodic cleanup tasks
if (process.env.NODE_ENV !== 'test') {
  // Clean up expired tokens every 6 hours
  setInterval(cleanupExpiredTokens, 6 * 60 * 60 * 1000);
  
  console.log('⏰ Scheduled cleanup tasks initialized');
}

module.exports = { app, server, wsManager }; 