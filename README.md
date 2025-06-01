# 📊 Trendgeist - Economic Forecasting Platform

A professional economic forecasting platform with real Federal Reserve data integration, AI coaching, and competitive predictions.

## 🚀 Quick Start

### File Structure
```
trendgeist/
├── index.html      # Main HTML structure
├── styles.css      # All CSS styling
├── script.js       # JavaScript functionality
└── README.md       # This file
```

### Setup Instructions

1. **Download Files**
   - Save `index.html`, `styles.css`, and `script.js` in the same folder
   - Ensure all files are in the same directory

2. **Launch Application**
   - Open `index.html` in your web browser
   - Or serve via local server (recommended)

## 🔧 Local Server Setup (Recommended)

### Using Python
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

### Using Node.js
```bash
npx http-server
```

### Using PHP
```bash
php -S localhost:8000
```

Then visit: `http://localhost:8000`

## ⚡ Features

### 🎯 Live Predictions
- Real-time economic forecasting
- Consumer Price Index (CPI)
- Non-Farm Payrolls
- Federal Reserve decisions
- Confidence-based scoring

### 🤖 AI Performance Coach
- Personalized insights based on your prediction history
- Real-time market analysis using FRED data
- Calibration recommendations
- Pattern recognition

### 🏆 Leaderboard System
- Global rankings
- Category expertise tracking
- Streak monitoring
- Performance analytics

### 📊 Market Analytics
- Live economic indicators
- Real-time FRED data integration
- Economic calendar
- Market sentiment analysis

### 🎓 Education Center
- Economics learning modules
- Federal Reserve deep dive
- Forecasting techniques
- Professional development

### 💬 Community Features
- Discussion forums
- Hot topics
- Expert insights
- Peer learning

## 🔑 FRED API Integration

### What is FRED?
Federal Reserve Economic Data (FRED) is a database of economic data from the Federal Reserve Bank of St. Louis.

### API Features
- **800,000+** economic time series
- **Real-time updates** when new data is released
- **Free access** with API key
- **120 requests/minute** rate limit
- **No daily limits**

### Key Data Sources
- Consumer Price Index (CPI)
- Unemployment rates
- Federal funds rate
- GDP data
- Employment statistics
- Housing data
- Manufacturing indices

## 📱 Browser Compatibility

- ✅ Chrome 80+
- ✅ Firefox 75+
- ✅ Safari 13+
- ✅ Edge 80+

## 🎨 Customization

### Color Scheme
Edit CSS variables in `styles.css`:
```css
:root {
    --primary-orange: #fe7f2d;
    --primary-blue: #2563eb;
    --bg-primary: #000000;
    /* ... */
}
```

### Typography
The platform uses:
- **Quicksand** - UI elements and body text
- **Roboto Mono** - Numbers and data displays

### Adding New Tabs
1. Add tab button in HTML:
```html
<button class="nav-tab" onclick="switchTab('newtab', this)">🆕 New Tab</button>
```

2. Add tab content:
```html
<div id="newtab-tab" class="tab-content">
    <!-- Your content here -->
</div>
```

3. Update JavaScript messages in `script.js`

## 🔧 Troubleshooting

### Tabs Not Switching
- Check browser console (F12) for errors
- Ensure all files are in same directory
- Verify JavaScript is enabled

### FRED API Not Working
- Verify API key is correct (32 characters)
- Check browser console for error messages
- Ensure internet connection is active
- Try refreshing the page

### Styling Issues
- Ensure `styles.css` is loading correctly
- Check file paths are correct
- Clear browser cache

## 📈 Performance Tips

### Optimization
- FRED data is cached for 30 minutes
- Use local server for better performance
- Enable browser caching for production

### Rate Limiting
- Built-in respect for FRED's 120/minute limit
- Automatic caching prevents unnecessary requests
- Smart retry logic for failed requests

## 🚀 Production Deployment

### For Production Use:
1. **Environment Variables**
   ```javascript
   const FRED_API_KEY = process.env