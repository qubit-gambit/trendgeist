const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Initialize Gemini AI
console.log('Initializing Gemini AI...');
console.log('API Key present:', !!process.env.GEMINI_API_KEY);
console.log('API Key length:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 'undefined');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
            statusText: error.statusText,
            stack: error.stack
        });
        return 'Unable to generate explanation at this time.';
    }
}

// Generate prediction insights using Gemini
async function generatePredictionInsight(indicator, currentValue, trend, userConfidence) {
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

// API endpoint for getting indicator explanation
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

// API endpoint for prediction coaching
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        ai_provider: 'Google Gemini',
        model: 'gemini-1.5-flash',
        api_key_configured: !!process.env.GEMINI_API_KEY
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} with Google Gemini AI`);
    console.log(`Health check: http://localhost:${PORT}/health`);
}); 