# Trendgeist with Google Gemini AI

This platform now uses Google's Gemini AI to provide intelligent economic indicator explanations and personalized prediction coaching.

## 🚀 Quick Setup

### 1. Get Your Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

### 2. Set Up Environment Variables

Create a `.env` file in your project root:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Server

```bash
# Development mode (auto-restart)
npm run dev

# Production mode
npm start
```

## 🤖 Gemini AI Features

### Economic Indicator Explanations
- Real-time analysis of CPI, unemployment, Fed rates
- Context-aware insights based on current trends
- Clear, actionable explanations for forecasters

### Personalized AI Coaching
- Click "🎯 Get AI Coaching" on any prediction card
- Analyzes your confidence level vs. current economic conditions
- Provides calibration suggestions and strategic advice
- Adapts recommendations based on live FRED data

### Enhanced Features vs. OpenAI
- **Faster response times** - Gemini is typically quicker
- **Better context understanding** - Improved economic domain knowledge
- **Cost-effective** - More generous free tier
- **Multimodal capabilities** - Ready for future chart/graph analysis

## 📊 API Endpoints

### `POST /api/explain-indicator`
Generate economic indicator explanations

```json
{
  "indicator": "cpi",
  "currentValue": "3.2",
  "trend": "increasing"
}
```

### `POST /api/coaching-insight`
Get personalized prediction coaching

```json
{
  "indicator": "unemployment",
  "currentValue": "3.9",
  "trend": "decreasing", 
  "confidence": "75"
}
```

### `GET /health`
Check server and AI provider status

## 🔧 Troubleshooting

### Common Issues

**Server won't start:**
- Check your `.env` file exists and has valid `GEMINI_API_KEY`
- Ensure port 3000 isn't already in use

**AI explanations not loading:**
- Verify your Gemini API key is active
- Check browser console for network errors
- Ensure server is running on http://localhost:3000

**Rate limiting:**
- Gemini has generous free tier limits
- Monitor your usage at [Google AI Studio](https://makersuite.google.com/)

### Testing Your Setup

1. Start the server: `npm run dev`
2. Visit: http://localhost:3000/health
3. Should see: `{"status":"ok","ai_provider":"Google Gemini","model":"gemini-pro"}`

## 🌟 What's New

- **Dual AI Integration**: Economic explanations + personalized coaching
- **Interactive Coaching**: Click buttons for real-time AI advice
- **Enhanced UI**: New coaching sections with orange accent colors
- **Better Performance**: Gemini's faster response times improve UX
- **Cost Optimization**: Switch from paid OpenAI to free Gemini tier

## 📈 Usage Examples

The AI will provide insights like:

**CPI Analysis:**
> "The current CPI reading of 3.2% with an increasing trend suggests persistent inflationary pressures above the Fed's 2% target. This level typically prompts continued monetary tightening discussions. Watch for core CPI excluding food and energy for underlying inflation momentum."

**Coaching Insight:**
> "Your 85% confidence level is quite high given the current CPI volatility. Consider moderating to 65-70% confidence as inflation data has shown increased month-to-month variability. This calibration adjustment could improve your scoring potential."

---

🚀 **Ready to forecast with AI-powered insights!** 