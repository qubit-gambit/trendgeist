// Trendgeist JavaScript - Main Application Logic

// =============================================================================
// FRED API Integration Classes
// =============================================================================

class FREDClient {
    constructor(apiKey, options = {}) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.stlouisfed.org/fred';
        this.cache = new Map();
        this.rateLimiter = { requests: [], canMakeRequest: () => true }; // Simplified for demo
        this.defaultCacheDuration = options.cacheDuration || 3600000;
    }

    async makeRequest(endpoint, params = {}) {
        const cacheKey = `${endpoint}_${JSON.stringify(params)}`;
        const cached = this.getCachedData(cacheKey);
        if (cached) return cached;

        const url = new URL(`${this.baseURL}/${endpoint}`);
        url.searchParams.append('api_key', this.apiKey);
        url.searchParams.append('file_type', 'json');
        
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        });

        try {
            const response = await fetch(url.toString());
            if (!response.ok) {
                throw new Error(`FRED API error: ${response.status}`);
            }
            const data = await response.json();
            this.setCachedData(cacheKey, data);
            return data;
        } catch (error) {
            console.error('FRED API request failed:', error);
            throw error;
        }
    }

    async getSeries(seriesId, options = {}) {
        const params = {
            series_id: seriesId,
            limit: options.limit || 12,
            sort_order: 'desc'
        };
        return await this.makeRequest('series/observations', params);
    }

    getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.defaultCacheDuration) {
            return cached.data;
        }
        return null;
    }

    setCachedData(key, data) {
        this.cache.set(key, { data: data, timestamp: Date.now() });
    }
}

class TrendgeistDataManager {
    constructor() {
        this.fredClient = null;
        this.isInitialized = false;
    }

    async initialize(apiKey) {
        if (!apiKey || apiKey === 'YOUR_ACTUAL_FRED_API_KEY_HERE') {
            this.showAPIKeyNeeded();
            return false;
        }

        try {
            this.fredClient = new FREDClient(apiKey);
            // Test the connection
            await this.fredClient.getSeries('CPIAUCSL', { limit: 1 });
            this.isInitialized = true;
            console.log('✅ FRED API connected successfully');
            this.showSuccessMessage();
            return true;
        } catch (error) {
            console.error('FRED API connection failed:', error);
            this.showConnectionError();
            return false;
        }
    }

    async updatePredictionCards() {
        if (!this.isInitialized) return;

        try {
            // Get real CPI data
            const cpiData = await this.fredClient.getSeries('CPIAUCSL', { limit: 3 });
            const unemploymentData = await this.fredClient.getSeries('UNRATE', { limit: 3 });
            const fedRateData = await this.fredClient.getSeries('FEDFUNDS', { limit: 3 });

            // Update CPI card
            await this.updateCPICard(cpiData);
            await this.updateUnemploymentCard(unemploymentData);
            await this.updateFedCard(fedRateData);

            // Update AI coaching with real data insights
            this.updateAICoaching(cpiData, unemploymentData, fedRateData);

        } catch (error) {
            console.error('Failed to update with real data:', error);
        }
    }

    async updateCPICard(cpiData) {
        const observations = cpiData.observations.filter(obs => obs.value !== '.');
        if (observations.length < 2) return;

        const latest = parseFloat(observations[0].value);
        const previous = parseFloat(observations[1].value);
        const monthlyChange = ((latest - previous) / previous * 100).toFixed(2);
        const trend = monthlyChange > 0 ? 'increasing' : 'decreasing';

        const cpiCard = document.querySelector('.prediction-card');
        if (cpiCard) {
            const question = cpiCard.querySelector('.question');
            question.textContent = `Will CPI increase by more than 0.3% month-over-month? (Last: +${monthlyChange}%, Current: ${latest.toFixed(1)})`;
            
            // Add real data context with AI explanation
            const explanation = await getAIExplanation('cpi', latest.toFixed(1), trend);
            this.addDataContext(cpiCard, {
                latest: latest,
                change: monthlyChange,
                trend: monthlyChange > 0.2 ? 'Rising' : monthlyChange < 0 ? 'Falling' : 'Stable',
                aiExplanation: explanation
            });

            // Add coaching insight functionality
            this.addCoachingButton(cpiCard, 'cpi', latest.toFixed(1), trend);
        }
    }

    async updateUnemploymentCard(unemploymentData) {
        const observations = unemploymentData.observations.filter(obs => obs.value !== '.');
        if (observations.length < 2) return;

        const latest = parseFloat(observations[0].value);
        const previous = parseFloat(observations[1].value);
        const trend = latest > previous ? 'increasing' : 'decreasing';
        
        const cards = document.querySelectorAll('.prediction-card');
        
        if (cards[1]) {
            const question = cards[1].querySelector('.question');
            question.textContent = `Will unemployment rate stay below 4.0% in the next report? (Current: ${latest}%)`;
            
            const explanation = await getAIExplanation('unemployment', latest, trend);
            this.addDataContext(cards[1], {
                latest: latest,
                status: latest < 4 ? 'Low' : latest > 6 ? 'High' : 'Moderate',
                trend: 'Federal Reserve target range',
                aiExplanation: explanation
            });

            this.addCoachingButton(cards[1], 'unemployment', latest, trend);
        }
    }

    async updateFedCard(fedRateData) {
        const observations = fedRateData.observations.filter(obs => obs.value !== '.');
        if (observations.length < 2) return;

        const latest = parseFloat(observations[0].value);
        const previous = parseFloat(observations[1].value);
        const trend = latest > previous ? 'increasing' : 'decreasing';
        
        const cards = document.querySelectorAll('.prediction-card');
        
        if (cards[2]) {
            const question = cards[2].querySelector('.question');
            question.textContent = `Will the Federal Reserve hold rates steady at ${latest}% at the next FOMC meeting?`;
            
            const explanation = await getAIExplanation('fed_rate', latest, trend);
            this.addDataContext(cards[2], {
                latest: latest,
                level: latest > 5 ? 'Restrictive' : latest < 2 ? 'Accommodative' : 'Neutral',
                trend: 'FOMC policy stance',
                aiExplanation: explanation
            });

            this.addCoachingButton(cards[2], 'fed_rate', latest, trend);
        }
    }

    addDataContext(card, data) {
        let contextDiv = card.querySelector('.real-data-context');
        if (!contextDiv) {
            contextDiv = document.createElement('div');
            contextDiv.className = 'real-data-context';
            contextDiv.style.cssText = `
                margin-top: 12px;
                padding: 10px;
                background: rgba(59, 130, 246, 0.1);
                border-left: 3px solid var(--blue-light);
                border-radius: 0 6px 6px 0;
                font-size: 0.8rem;
            `;
            card.querySelector('.prediction-form').appendChild(contextDiv);
        }

        contextDiv.innerHTML = `
            <div style="color: var(--blue-light); font-weight: 600; margin-bottom: 4px;">
                📊 Live FRED Data
            </div>
            <div style="color: var(--text-secondary);">
                Current: <span style="color: var(--primary-orange); font-weight: 600;">${data.latest}</span> • 
                Status: <span style="color: var(--text-primary);">${data.trend || data.status || data.level}</span>
            </div>
            ${data.aiExplanation ? `
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(59, 130, 246, 0.2);">
                    <div style="color: var(--blue-light); font-weight: 600; margin-bottom: 4px;">
                        🤖 Gemini AI Analysis
                    </div>
                    <div style="color: var(--text-secondary); line-height: 1.4;">
                        ${data.aiExplanation}
                    </div>
                </div>
            ` : ''}
        `;
    }

    addCoachingButton(card, indicator, currentValue, trend) {
        let coachingDiv = card.querySelector('.coaching-section');
        if (!coachingDiv) {
            coachingDiv = document.createElement('div');
            coachingDiv.className = 'coaching-section';
            coachingDiv.style.cssText = `
                margin-top: 12px;
                padding: 8px;
                background: rgba(254, 127, 45, 0.1);
                border-left: 3px solid var(--primary-orange);
                border-radius: 0 6px 6px 0;
                font-size: 0.8rem;
            `;
            card.querySelector('.prediction-form').appendChild(coachingDiv);
        }

        coachingDiv.innerHTML = `
            <button class="coaching-btn" style="
                background: var(--primary-orange);
                color: white;
                border: none;
                border-radius: 4px;
                padding: 6px 12px;
                font-size: 0.75rem;
                cursor: pointer;
                font-weight: 600;
            " data-indicator="${indicator}" data-value="${currentValue}" data-trend="${trend}">
                🎯 Get AI Coaching
            </button>
            <div class="coaching-result" style="margin-top: 8px; display: none;"></div>
        `;

        // Add click event listener
        const button = coachingDiv.querySelector('.coaching-btn');
        button.addEventListener('click', async () => {
            const confidenceSlider = card.querySelector('.slider-input');
            const confidence = confidenceSlider ? confidenceSlider.value : 50;
            
            button.textContent = 'Getting insights...';
            button.disabled = true;

            const insight = await getCoachingInsight(indicator, currentValue, trend, confidence);
            const resultDiv = coachingDiv.querySelector('.coaching-result');
            
            if (insight) {
                resultDiv.innerHTML = `
                    <div style="color: var(--primary-orange); font-weight: 600; margin-bottom: 4px;">
                        💡 AI Coach Says:
                    </div>
                    <div style="color: var(--text-secondary); line-height: 1.4;">
                        ${insight}
                    </div>
                `;
                resultDiv.style.display = 'block';
            }

            button.textContent = '🎯 Get AI Coaching';
            button.disabled = false;
        });
    }

    updateAICoaching(cpiData, unemploymentData, fedRateData) {
        const insights = document.querySelectorAll('.coach-insight');
        
        if (insights[0]) {
            const cpiObs = cpiData.observations.filter(obs => obs.value !== '.');
            const latest = parseFloat(cpiObs[0].value);
            const previous = parseFloat(cpiObs[1].value);
            const change = ((latest - previous) / previous * 100).toFixed(2);
            
            insights[0].innerHTML = `
                <strong>Real-Time CPI Analysis (Powered by Gemini AI):</strong> Latest CPI reading shows ${change}% monthly change. 
                Based on current inflation trends from FRED data, ${change > 0.3 ? 'consider moderate confidence (60-70%) as volatility is elevated' : 'higher confidence (75-85%) may be appropriate given stable readings'}.
            `;
        }

        if (insights[1]) {
            const unemploymentObs = unemploymentData.observations.filter(obs => obs.value !== '.');
            const currentRate = parseFloat(unemploymentObs[0].value);
            
            insights[1].innerHTML = `
                <strong>Employment Market Reality (AI Enhanced):</strong> Current unemployment at ${currentRate}% (FRED live data). 
                ${currentRate < 4 ? 'Tight labor market suggests continued employment strength' : 'Rising unemployment may signal economic cooling'}. 
                Click "Get AI Coaching" for personalized confidence calibration.
            `;
        }
    }

    showAPIKeyNeeded() {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid #ef4444;
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            color: #ef4444;
            font-family: 'Quicksand', sans-serif;
        `;
        errorDiv.innerHTML = `
            <h4 style="margin: 0 0 8px 0;">⚠️ FRED API Key Required</h4>
            <p style="margin: 0 0 12px 0;">To access real economic data, you need a free FRED API key.</p>
            <a href="https://fred.stlouisfed.org/docs/api/api_key.html" 
               target="_blank" 
               style="color: var(--primary-orange); text-decoration: none; font-weight: 600;">
               → Get Your Free API Key Here
            </a>
            <p style="margin: 12px 0 0 0; font-size: 0.8rem;">
               Then add your key to the JavaScript code and reload the page.
            </p>
        `;
        
        const coachSection = document.querySelector('.ai-coach');
        if (coachSection) {
            coachSection.appendChild(errorDiv);
        }
    }

    showSuccessMessage() {
        setTimeout(() => {
            showToast('🎉 Connected to live economic data from Federal Reserve!', 'success');
        }, 1000);
    }

    showConnectionError() {
        showToast('⚠️ Could not connect to FRED API. Check your API key.', 'info');
    }
}

// =============================================================================
// FRED Integration Initialization
// =============================================================================

async function initializeFREDIntegration() {
    // 🔑 Your FRED API Key - Replace with your actual key
    const FRED_API_KEY = '023c0cac1b685792419d62efef9a950e';
    
    const dataManager = new TrendgeistDataManager();
    const initialized = await dataManager.initialize(FRED_API_KEY);
    
    if (initialized) {
        // Update with real data every 30 minutes
        await dataManager.updatePredictionCards();
        setInterval(() => dataManager.updatePredictionCards(), 1800000);
    }
    
    return dataManager;
}

// =============================================================================
// Tab Switching Functionality
// =============================================================================

function switchTab(tabName, clickedElement) {
    console.log('switchTab called with:', tabName);
    
    try {
        // Hide all tab contents
        const allTabs = document.querySelectorAll('.tab-content');
        console.log('Found tab contents:', allTabs.length);
        allTabs.forEach(tab => {
            tab.classList.remove('active');
            tab.style.display = 'none'; // Force hide
        });
        
        // Remove active class from all nav buttons
        const allNavTabs = document.querySelectorAll('.nav-tab');
        allNavTabs.forEach(tab => tab.classList.remove('active'));
        
        // Show the selected tab
        const targetTab = document.getElementById(tabName + '-tab');
        console.log('Looking for tab:', tabName + '-tab', 'Found:', targetTab);
        
        if (targetTab) {
            targetTab.classList.add('active');
            targetTab.style.display = 'block'; // Force show
            console.log('Tab switched successfully to:', tabName);
        } else {
            console.error('Tab not found:', tabName + '-tab');
            // Show first tab as fallback
            const firstTab = document.querySelector('.tab-content');
            if (firstTab) {
                firstTab.classList.add('active');
                firstTab.style.display = 'block';
            }
        }
        
        // Add active class to clicked button
        if (clickedElement) {
            clickedElement.classList.add('active');
        }
        
        // Show toast message
        const messages = {
            'predictions': 'Live predictions with real Federal Reserve data! 🎯',
            'leaderboard': 'See how you stack up against 2,847 players! 🏆',
            'analytics': 'Real-time economic dashboard powered by FRED API 📊',
            'education': 'Level up your economics knowledge! 🎓',
            'community': 'Join the discussion with fellow forecasters! 💬'
        };
        
        if (messages[tabName]) {
            showToast(messages[tabName], 'info');
        } else {
            showToast(`Switched to ${tabName} tab`, 'info');
        }
        
    } catch (error) {
        console.error('Error in switchTab:', error);
        showToast('Error switching tabs. Please refresh the page.', 'error');
    }
}

// =============================================================================
// UI Interaction Handlers
// =============================================================================

// Update confidence sliders
function initializeConfidenceSliders() {
    document.querySelectorAll('.slider-input').forEach(slider => {
        const track = slider.parentElement.querySelector('.slider-track');
        const valueDisplay = slider.parentElement.parentElement.querySelector('.confidence-value');
        
        slider.addEventListener('input', function() {
            const value = this.value;
            track.style.width = value + '%';
            valueDisplay.textContent = value + '%';
        });
    });
}

// Handle prediction submissions
function initializePredictionHandlers() {
    document.querySelectorAll('.submit-btn').forEach(button => {
        button.addEventListener('click', function() {
            const card = this.closest('.prediction-card');
            const confidence = card.querySelector('.confidence-value').textContent;
            
            this.textContent = 'Submitted ✓';
            this.disabled = true;
            
            showToast(`Prediction submitted with ${confidence} confidence`, 'success');
            
            setTimeout(() => {
                const coachingMessages = [
                    `Based on your ${confidence} confidence and current FRED data trends, you're positioned for optimal scoring.`,
                    `Real economic volatility suggests ${parseInt(confidence) > 80 ? 'moderating confidence to 65-75%' : 'maintaining current confidence level'} for better calibration.`,
                    `Your confidence level aligns well with current economic uncertainty from Federal Reserve data.`
                ];
                
                showToast(coachingMessages[Math.floor(Math.random() * coachingMessages.length)], 'info');
            }, 2000);
        });
    });
}

// =============================================================================
// Modal Functionality
// =============================================================================

// Signup Modal Functions
function openSignupModal() {
    document.getElementById('signupModal').classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeSignupModal() {
    document.getElementById('signupModal').classList.remove('show');
    document.body.style.overflow = 'auto';
}

// Signin Modal Functions
function openSigninModal() {
    document.getElementById('signinModal').classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeSigninModal() {
    document.getElementById('signinModal').classList.remove('show');
    document.body.style.overflow = 'auto';
}

// Close modals when clicking outside
function initializeModalHandlers() {
    document.getElementById('signupModal').addEventListener('click', function(e) {
        if (e.target === this) closeSignupModal();
    });

    document.getElementById('signinModal').addEventListener('click', function(e) {
        if (e.target === this) closeSigninModal();
    });

    // Modal form submissions
    document.getElementById('modalSignupForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('modalSubmitBtn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Account...';
        
        setTimeout(() => {
            submitBtn.textContent = 'Account Created! ✅';
            submitBtn.style.background = 'var(--blue-light)';
            
            setTimeout(() => {
                closeSignupModal();
                showToast('Welcome to Trendgeist! Check your email to verify your account.', 'success');
                this.reset();
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Account & Start Forecasting';
                submitBtn.style.background = 'var(--primary-orange)';
            }, 1500);
        }, 2000);
    });

    // Sign in form submission
    document.getElementById('modalSigninForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('signinSubmitBtn');
        const email = document.getElementById('signinEmail').value;
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing In...';
        
        setTimeout(() => {
            submitBtn.textContent = 'Welcome Back! ✅';
            submitBtn.style.background = 'var(--blue-light)';
            
            setTimeout(() => {
                closeSigninModal();
                showToast(`Welcome back! Your prediction streak continues...`, 'success');
                
                const headerActions = document.querySelector('.header-actions');
                headerActions.innerHTML = `
                    <span style="color: var(--text-secondary); font-size: 0.9rem; margin-right: 12px;">
                        Welcome, ${email.split('@')[0]}
                    </span>
                    <button class="sign-in-btn" onclick="signOut()">Sign Out</button>
                `;
                
                this.reset();
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign In';
                submitBtn.style.background = 'var(--primary-orange)';
            }, 1500);
        }, 1500);
    });

    // Username validation for modal
    document.getElementById('modalUsername').addEventListener('input', function() {
        this.value = this.value.replace(/[^a-zA-Z0-9_]/g, '');
    });
}

// Sign out function
function signOut() {
    const headerActions = document.querySelector('.header-actions');
    headerActions.innerHTML = `
        <button class="sign-in-btn" onclick="openSigninModal()">Sign In</button>
        <button class="sign-up-btn" onclick="openSignupModal()">Sign Up</button>
    `;
    showToast('You have been signed out. See you next time!', 'info');
}

// =============================================================================
// Toast Notification System
// =============================================================================

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// =============================================================================
// AI Explanations Integration (Google Gemini)
// =============================================================================

async function getAIExplanation(indicator, currentValue, trend) {
    try {
        const response = await fetch('http://localhost:3000/api/explain-indicator', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                indicator,
                currentValue,
                trend
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch explanation');
        }

        const data = await response.json();
        return data.explanation;
    } catch (error) {
        console.error('Error fetching AI explanation:', error);
        return null;
    }
}

async function getCoachingInsight(indicator, currentValue, trend, confidence) {
    try {
        const response = await fetch('http://localhost:3000/api/coaching-insight', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                indicator,
                currentValue,
                trend,
                confidence
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch coaching insight');
        }

        const data = await response.json();
        return data.insight;
    } catch (error) {
        console.error('Error fetching coaching insight:', error);
        return null;
    }
}

// AI Coaching function for HTML buttons
async function getAICoaching(button, indicatorType) {
    const card = button.closest('.prediction-card');
    const confidence = 75; // Default confidence for terminal interface
    
    // Map indicator types to API format
    const indicatorMap = {
        'cpi': { indicator: 'cpi', value: '3.2', trend: 'increasing' },
        'jobs': { indicator: 'unemployment', value: '3.9', trend: 'decreasing' },
        'fed': { indicator: 'fed_rate', value: '5.25', trend: 'stable' },
        'gdp': { indicator: 'gdp', value: '2.1', trend: 'increasing' }
    };
    
    const { indicator, value, trend } = indicatorMap[indicatorType] || indicatorMap['cpi'];
    
    // Create or update result div
    let resultDiv = card.querySelector('.ai-result');
    if (!resultDiv) {
        resultDiv = document.createElement('div');
        resultDiv.className = 'ai-result';
        resultDiv.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: var(--terminal-secondary);
            border: 1px solid var(--terminal-border);
            font-size: 9px;
            line-height: 1.3;
        `;
        card.appendChild(resultDiv);
    }
    
    button.textContent = '🤖 ANALYZING...';
    button.disabled = true;
    
    try {
        const insight = await getCoachingInsight(indicator, value, trend, confidence);
        
        if (insight) {
            resultDiv.innerHTML = `
                <div style="color: var(--terminal-orange); font-weight: bold; margin-bottom: 4px;">
                    💡 GEMINI AI ANALYSIS:
                </div>
                <div style="color: var(--terminal-white); line-height: 1.4;">
                    ${insight}
                </div>
            `;
            resultDiv.style.display = 'block';
            
            // Show success toast
            showToast('🎯 AI analysis complete!', 'success');
        } else {
            resultDiv.innerHTML = `
                <div style="color: var(--terminal-red); font-weight: bold;">
                    ⚠️ AI ANALYSIS UNAVAILABLE
                </div>
            `;
            resultDiv.style.display = 'block';
            showToast('Unable to connect to AI service', 'error');
        }
    } catch (error) {
        console.error('Error getting AI coaching:', error);
        resultDiv.innerHTML = `
            <div style="color: var(--terminal-red); font-weight: bold;">
                ⚠️ CONNECTION ERROR
            </div>
        `;
        resultDiv.style.display = 'block';
        showToast('Error connecting to AI service', 'error');
    }
    
    button.textContent = '🤖 AI ANALYSIS';
    button.disabled = false;
}

// Inflation Analysis function
async function getInflationAnalysis() {
    const button = document.querySelector('.analysis-btn');
    const resultDiv = document.getElementById('inflationAnalysisResult');
    
    button.textContent = '🤖 ANALYZING INFLATION TRENDS...';
    button.disabled = true;
    
    try {
        // Gather current inflation data for comprehensive analysis
        const inflationData = {
            current_cpi: 3.2,
            core_cpi: 3.8,
            mom_change: 0.1,
            trend: 'cooling',
            fed_target: 2.0,
            recent_history: [
                { month: 'JUN 2024', cpi: 3.2, core: 3.8, mom: 0.1 },
                { month: 'MAY 2024', cpi: 3.1, core: 3.9, mom: 0.2 },
                { month: 'APR 2024', cpi: 3.3, core: 4.1, mom: 0.3 },
                { month: 'MAR 2024', cpi: 3.6, core: 4.3, mom: 0.4 },
                { month: 'FEB 2024', cpi: 3.8, core: 4.5, mom: 0.3 },
                { month: 'JAN 2024', cpi: 4.1, core: 4.8, mom: 0.5 }
            ],
            components: {
                housing: { weight: 33.2, impact: 1.8 },
                energy: { weight: 7.3, impact: -0.8 },
                food: { weight: 13.4, impact: 0.2 },
                services: { weight: 58.9, impact: 2.1 }
            }
        };

        const response = await fetch('http://localhost:3000/api/explain-indicator', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                indicator: 'inflation_analysis',
                currentValue: JSON.stringify(inflationData),
                trend: 'comprehensive_analysis'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch inflation analysis');
        }

        const data = await response.json();
        
        if (data.explanation) {
            resultDiv.innerHTML = `
                <div class="ai-header">
                    🤖 GEMINI AI INFLATION FORECAST & ANALYSIS
                </div>
                <div class="ai-content">
                    ${data.explanation}
                </div>
            `;
            resultDiv.style.display = 'block';
            
            // Add flash animation to updated components
            document.querySelectorAll('.trend-metrics .metric-item').forEach(item => {
                item.classList.add('trend-update');
                setTimeout(() => item.classList.remove('trend-update'), 800);
            });
            
            showToast('📊 Comprehensive inflation analysis generated!', 'success');
        } else {
            throw new Error('No analysis received');
        }
    } catch (error) {
        console.error('Error getting inflation analysis:', error);
        resultDiv.innerHTML = `
            <div class="ai-header">
                ⚠️ ANALYSIS UNAVAILABLE
            </div>
            <div class="ai-content">
                Unable to generate inflation forecast at this time. Please check AI service connection.
            </div>
        `;
        resultDiv.style.display = 'block';
        showToast('Error generating inflation analysis', 'error');
    }
    
    button.textContent = '🤖 GENERATE AI INFLATION FORECAST';
    button.disabled = false;
}

// Update inflation data with real-time changes
function updateInflationData() {
    const currentRow = document.querySelector('[data-month="current"]');
    if (currentRow) {
        // Simulate slight changes in current data
        const cpiCell = currentRow.querySelector('.table-cell.price');
        const momCell = currentRow.querySelector('.table-cell.change');
        
        if (cpiCell && momCell) {
            // Add flash effect for data updates
            currentRow.classList.add('data-update');
            setTimeout(() => currentRow.classList.remove('data-update'), 800);
        }
    }
    
    // Update trend metrics with slight variations
    const metricValues = document.querySelectorAll('.metric-value');
    metricValues.forEach(metric => {
        metric.parentElement.classList.add('trend-update');
        setTimeout(() => metric.parentElement.classList.remove('trend-update'), 800);
    });
}

// Phillips Curve Analysis function
async function getPhillipsCurveAnalysis() {
    const button = document.querySelector('.analysis-btn[onclick="getPhillipsCurveAnalysis()"]');
    const resultDiv = document.getElementById('phillipsAnalysisResult');
    
    button.textContent = '🤖 ANALYZING PHILLIPS CURVE...';
    button.disabled = true;
    
    try {
        // Comprehensive economic data for Phillips Curve analysis
        const economicData = {
            current_indicators: {
                unemployment: 3.9,
                cpi_inflation: 3.2,
                gdp_growth: 2.1,
                core_pce: 2.9
            },
            historical_data: [
                { period: 'JUN 2024', unemployment: 3.9, cpi: 3.2, relationship: 'inverse', status: 'holding' },
                { period: 'MAY 2024', unemployment: 4.0, cpi: 3.1, relationship: 'inverse', status: 'holding' },
                { period: 'APR 2024', unemployment: 3.8, cpi: 3.3, relationship: 'inverse', status: 'holding' },
                { period: 'MAR 2024', unemployment: 3.7, cpi: 3.6, relationship: 'inverse', status: 'holding' },
                { period: 'FEB 2024', unemployment: 3.9, cpi: 3.8, relationship: 'weak', status: 'breaking' },
                { period: 'JAN 2024', unemployment: 4.1, cpi: 4.1, relationship: 'neutral', status: 'unclear' }
            ],
            correlations: {
                unemployment_vs_cpi: -0.73,
                gdp_vs_unemployment: -0.68,
                gdp_vs_cpi: 0.42,
                phillips_validity: 78
            },
            theory_status: {
                phillips_curve: { status: 'holding', confidence: 78 },
                okuns_law: { status: 'holding', confidence: 71 }
            }
        };

        const response = await fetch('http://localhost:3000/api/explain-indicator', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                indicator: 'phillips_curve_analysis',
                currentValue: JSON.stringify(economicData),
                trend: 'comprehensive_economic_theory_test'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch Phillips Curve analysis');
        }

        const data = await response.json();
        
        if (data.explanation) {
            resultDiv.innerHTML = `
                <div class="ai-header">
                    🤖 GEMINI AI PHILLIPS CURVE & ECONOMIC THEORY ANALYSIS
                </div>
                <div class="ai-content">
                    ${data.explanation}
                </div>
            `;
            resultDiv.style.display = 'block';
            
            // Add flash animation to theory status and correlation items
            document.querySelectorAll('.theory-item').forEach(item => {
                item.classList.add('theory-update');
                setTimeout(() => item.classList.remove('theory-update'), 1000);
            });
            
            document.querySelectorAll('.correlation-item').forEach(item => {
                item.classList.add('correlation-update');
                setTimeout(() => item.classList.remove('correlation-update'), 1000);
            });
            
            showToast('📊 Phillips Curve analysis complete!', 'success');
        } else {
            throw new Error('No analysis received');
        }
    } catch (error) {
        console.error('Error getting Phillips Curve analysis:', error);
        resultDiv.innerHTML = `
            <div class="ai-header">
                ⚠️ ANALYSIS UNAVAILABLE
            </div>
            <div class="ai-content">
                Unable to generate Phillips Curve analysis at this time. Please check AI service connection.
            </div>
        `;
        resultDiv.style.display = 'block';
        showToast('Error generating Phillips Curve analysis', 'error');
    }
    
    button.textContent = '🤖 GENERATE PHILLIPS CURVE AI ANALYSIS';
    button.disabled = false;
}

// Update Phillips Curve data with real-time changes
function updatePhillipsCurveData() {
    const currentRow = document.querySelector('.phillips-row.current');
    if (currentRow) {
        // Add flash effect for data updates
        currentRow.classList.add('data-update');
        setTimeout(() => currentRow.classList.remove('data-update'), 800);
    }
    
    // Update correlation values with slight variations
    const correlationValues = document.querySelectorAll('.correlation-value');
    correlationValues.forEach(value => {
        value.parentElement.classList.add('correlation-update');
        setTimeout(() => value.parentElement.classList.remove('correlation-update'), 800);
    });
    
    // Update theory status indicators
    const theoryItems = document.querySelectorAll('.theory-item');
    theoryItems.forEach(item => {
        item.classList.add('theory-update');
        setTimeout(() => item.classList.remove('theory-update'), 800);
    });
}

// =============================================================================
// Terminal Interface Functions
// =============================================================================

// Update terminal time
function updateTerminalTime() {
    const now = new Date();
    const timeString = now.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/New_York'
    }) + ' EST';
    
    const timeElement = document.getElementById('terminalTime');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// Terminal tab switching
function switchTerminalTab(tabName, element) {
    // Remove active class from all tabs
    document.querySelectorAll('.terminal-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
    });
    
    // Hide/show main terminal layout based on tab
    const mainLayout = document.querySelector('.terminal-main');
    
    if (tabName === 'analysis') {
        // Hide main layout and show analysis tab
        mainLayout.style.display = 'none';
        const analysisTab = document.getElementById('analysis-tab');
        if (analysisTab) {
            analysisTab.style.display = 'block';
            analysisTab.classList.add('active');
        }
    } else if (tabName === 'yields') {
        // Hide main layout and show yields tab
        mainLayout.style.display = 'none';
        const yieldsTab = document.getElementById('yields-tab');
        if (yieldsTab) {
            yieldsTab.style.display = 'block';
            yieldsTab.classList.add('active');
        }
        // Initialize yield curve analysis
        initializeYieldCurveAnalysis();
    } else if (tabName === 'leaderboard') {
        // Hide main layout and show leaderboard tab
        mainLayout.style.display = 'none';
        const leaderboardTab = document.getElementById('leaderboard-tab');
        if (leaderboardTab) {
            leaderboardTab.style.display = 'block';
            leaderboardTab.classList.add('active');
        }
        // Initialize leaderboard interactions
        initializeLeaderboardInteractions();
    } else if (tabName === 'community') {
        // Hide main layout and show community tab
        mainLayout.style.display = 'none';
        const communityTab = document.getElementById('community-tab');
        if (communityTab) {
            communityTab.style.display = 'block';
            communityTab.classList.add('active');
        }
        // Initialize community forum
        initializeCommunityForum();
    } else {
        // Show main layout and hide other tabs
        mainLayout.style.display = 'flex';
        const analysisTab = document.getElementById('analysis-tab');
        const yieldsTab = document.getElementById('yields-tab');
        const leaderboardTab = document.getElementById('leaderboard-tab');
        const communityTab = document.getElementById('community-tab');
        if (analysisTab) {
            analysisTab.style.display = 'none';
            analysisTab.classList.remove('active');
        }
        if (yieldsTab) {
            yieldsTab.style.display = 'none';
            yieldsTab.classList.remove('active');
        }
        if (leaderboardTab) {
            leaderboardTab.style.display = 'none';
            leaderboardTab.classList.remove('active');
        }
        if (communityTab) {
            communityTab.style.display = 'none';
            communityTab.classList.remove('active');
        }
    }
    
    // Add active class to clicked tab
    element.classList.add('active');
    
    // Show toast message
    const messages = {
        'indicators': 'Real-time economic indicators dashboard 📊',
        'predictions': 'Live prediction markets with AI coaching 🎯',
        'analysis': 'Advanced economic analysis with AI insights 🧠',
        'yields': 'US Treasury yield curve analysis & recession indicators 🏛️',
        'leaderboard': 'Global forecaster rankings with achievements 🏆',
        'community': 'Community discussions and insights 💬'
    };
    
    showToast(messages[tabName] || `Switched to ${tabName}`, 'info');
}

// Initialize leaderboard interactions
function initializeLeaderboardInteractions() {
    // Add click handlers for leaderboard rows
    document.querySelectorAll('.leaderboard-row:not(.header)').forEach(row => {
        row.addEventListener('click', function() {
            const playerName = this.querySelector('.player-name').textContent;
            const rank = this.querySelector('.rank-number').textContent;
            const tokens = this.querySelector('.token-amount').textContent;
            
            if (playerName === 'YOU') {
                showToast(`🌟 Your current stats: Rank #${rank} • ${tokens} tokens • Keep climbing!`, 'info');
            } else {
                showToast(`👀 Viewing ${playerName}'s profile • Rank #${rank} • ${tokens} tokens`, 'info');
            }
        });
    });
    
    // Add click handlers for achievements
    document.querySelectorAll('.achievement').forEach(achievement => {
        achievement.addEventListener('click', function() {
            const name = this.querySelector('.achievement-name').textContent;
            const isUnlocked = this.classList.contains('unlocked');
            
            if (isUnlocked) {
                showToast(`🎉 Achievement unlocked: ${name}`, 'success');
            } else {
                showToast(`🎯 Working towards: ${name}`, 'info');
            }
        });
    });
    
    // Add hover effects for badges
    document.querySelectorAll('.badge').forEach(badge => {
        badge.addEventListener('mouseenter', function() {
            const badgeClass = Array.from(this.classList).find(cls => cls !== 'badge');
            const badgeDescriptions = {
                'prophet': 'Achieved 95%+ accuracy',
                'perfect': 'Perfect prediction streak',
                'veteran': '1+ year active player',
                'sniper': 'Precision predictions',
                'streak': 'Long win streaks',
                'analyst': 'Data-driven predictions',
                'consistent': 'Daily active player',
                'momentum': 'Rising fast',
                'gambler': 'High-risk predictions',
                'newcomer': 'New player bonus'
            };
            
            if (badgeDescriptions[badgeClass]) {
                this.title = badgeDescriptions[badgeClass];
            }
        });
    });
    
    // Simulate real-time leaderboard updates
    setTimeout(() => {
        updateLeaderboardStats();
    }, 5000);
}

// Update leaderboard stats with simulated changes
function updateLeaderboardStats() {
    // Update global stats
    const statValues = document.querySelectorAll('.stat-value');
    if (statValues.length >= 4) {
        // Simulate small increases
        const tokens = statValues[0];
        const predictions = statValues[1];
        const accuracy = statValues[2];
        const daysLeft = statValues[3];
        
        // Add flash effect to show updates
        tokens.parentElement.classList.add('flash-positive');
        predictions.parentElement.classList.add('flash-positive');
        
        setTimeout(() => {
            tokens.parentElement.classList.remove('flash-positive');
            predictions.parentElement.classList.remove('flash-positive');
        }, 800);
    }
    
    // Update some player token changes
    const tokenChanges = document.querySelectorAll('.token-change');
    tokenChanges.forEach((change, index) => {
        if (Math.random() > 0.7) { // 30% chance of update
            const currentValue = parseInt(change.textContent.replace(/[+\-,]/g, ''));
            const newValue = currentValue + Math.floor(Math.random() * 100) - 50;
            const sign = newValue >= 0 ? '+' : '';
            
            change.textContent = `${sign}${newValue.toLocaleString()}`;
            change.className = `token-change ${newValue >= 0 ? 'positive' : 'negative'}`;
            
            // Add flash effect
            change.classList.add('flash-positive');
            setTimeout(() => change.classList.remove('flash-positive'), 500);
        }
    });
    
    // Schedule next update
    setTimeout(() => {
        updateLeaderboardStats();
    }, 15000);
}

// Simulate real-time data updates
function updateDataGrid() {
    const dataRows = document.querySelectorAll('.data-row:not(.header)');
    
    dataRows.forEach((row, index) => {
        const changeCell = row.querySelector('.data-cell.change');
        const priceCell = row.querySelector('.data-cell.price');
        
        if (changeCell && priceCell) {
            // Simulate random price changes
            const isPositive = Math.random() > 0.5;
            const changeValue = (Math.random() * 0.2).toFixed(1);
            
            // Update change cell
            changeCell.textContent = isPositive ? `+${changeValue}%` : `-${changeValue}%`;
            changeCell.className = `data-cell change ${isPositive ? 'positive' : 'negative'}`;
            
            // Add flash effect
            changeCell.style.background = isPositive ? 'rgba(0, 255, 65, 0.2)' : 'rgba(255, 0, 64, 0.2)';
            setTimeout(() => {
                changeCell.style.background = '';
            }, 500);
        }
    });
}

// Initialize terminal interface
function initializeTerminal() {
    // Update time every second
    updateTerminalTime();
    setInterval(updateTerminalTime, 1000);
    
    // Update data grid every 30 seconds
    setInterval(updateDataGrid, 30000);
    
    // Update inflation data every 45 seconds
    setInterval(updateInflationData, 45000);
    
    // Update Phillips Curve data every 60 seconds
    setInterval(updatePhillipsCurveData, 60000);
    
    // Initialize yield curve analysis
    initializeYieldCurveAnalysis();
    
    // Add yield curve analysis button
    setTimeout(() => {
        addYieldCurveAnalysisButton();
    }, 1000);
    
    // Add hover effects to data rows
    document.querySelectorAll('.data-row:not(.header)').forEach(row => {
        row.addEventListener('click', function() {
            const symbol = this.querySelector('.data-cell.symbol').textContent;
            showToast(`Viewing details for ${symbol}`, 'info');
        });
    });
    
    // Add click handlers for inflation trend rows
    document.querySelectorAll('.table-row:not(.header)').forEach(row => {
        row.addEventListener('click', function() {
            const month = this.querySelector('.table-cell').textContent;
            showToast(`Historical data for ${month}`, 'info');
        });
    });
    
    // Add hover handlers for component analysis
    document.querySelectorAll('.component-item').forEach(item => {
        item.addEventListener('click', function() {
            const component = this.querySelector('.component-name').textContent;
            showToast(`${component} component analysis`, 'info');
        });
    });
    
    // Add click handlers for Phillips Curve analysis
    document.querySelectorAll('.phillips-row:not(.header)').forEach(row => {
        row.addEventListener('click', function() {
            const period = this.querySelector('.phillips-cell').textContent;
            showToast(`Phillips Curve data for ${period}`, 'info');
        });
    });
    
    // Add hover handlers for correlation metrics
    document.querySelectorAll('.correlation-item').forEach(item => {
        item.addEventListener('click', function() {
            const correlation = this.querySelector('.correlation-label').textContent;
            showToast(`Correlation analysis: ${correlation}`, 'info');
        });
    });
    
    // Add click handlers for economic theory status
    document.querySelectorAll('.theory-item').forEach(item => {
        item.addEventListener('click', function() {
            const theory = this.querySelector('.theory-title').textContent;
            showToast(`Economic theory: ${theory}`, 'info');
        });
    });
}

// =============================================================================
// Application Initialization
// =============================================================================

// Initialize everything when page loads
window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('Trendgeist Terminal initializing...');
        
        // Initialize terminal interface
        initializeTerminal();
        
        // Initialize sentiment analysis
        initializeSentimentAnalysis();
        
        // Initialize community forum
        initializeCommunityForum();
        
        // Welcome message
        setTimeout(() => {
            showToast('🚀 Trendgeist Terminal Online - Real-time data loading...', 'success');
        }, 1000);

        // Initialize FRED integration
        const dataManager = await initializeFREDIntegration();
        
        // If FRED is working, show enhanced message
        if (dataManager && dataManager.isInitialized) {
            setTimeout(() => {
                showToast('✨ Live economic data connected! AI coaching ready.', 'success');
            }, 3000);
        }
        
        console.log('Trendgeist Terminal initialization complete');
        
    } catch (error) {
        console.error('Terminal initialization error:', error);
        showToast('⚠️ Some systems offline. Check connections.', 'error');
    }
});

// Global functions for HTML onclick handlers
window.switchTerminalTab = switchTerminalTab;
window.getAICoaching = getAICoaching;
window.getInflationAnalysis = getInflationAnalysis;
window.getPhillipsCurveAnalysis = getPhillipsCurveAnalysis;

// Market Sentiment Analysis Functions
function initializeSentimentAnalysis() {
    // Update sentiment data every 30 seconds
    setInterval(updateSentimentData, 30000);
    
    // Add click handlers for sentiment components
    document.querySelectorAll('.component-item').forEach(item => {
        item.addEventListener('click', function() {
            const componentName = this.querySelector('.component-name').textContent;
            showToast(`📊 ${componentName} sentiment analysis`, 'info');
        });
    });
    
    // Add click handlers for sentiment sources
    document.querySelectorAll('.sentiment-source').forEach(source => {
        source.addEventListener('click', function() {
            const sourceName = this.querySelector('.source-name').textContent;
            const score = this.querySelector('.source-score').textContent;
            showToast(`${sourceName} sentiment: ${score}`, 'info');
        });
    });
    
    // Add click handlers for flow items
    document.querySelectorAll('.flow-item').forEach(item => {
        item.addEventListener('click', function() {
            const flowLabel = this.querySelector('.flow-label').textContent;
            const flowValue = this.querySelector('.flow-value').textContent;
            showToast(`💰 ${flowLabel}: ${flowValue}`, 'info');
        });
    });
}

// Update sentiment data with real-time changes
function updateSentimentData() {
    // Update Fear & Greed Index
    updateFearGreedMeter();
    
    // Update social sentiment scores
    updateSocialSentiment();
    
    // Update institutional flow
    updateInstitutionalFlow();
    
    // Update options flow
    updateOptionsFlow();
}

// Update Fear & Greed Meter
function updateFearGreedMeter() {
    const needle = document.querySelector('.meter-needle');
    const meterNumber = document.querySelector('.meter-number');
    const meterLabel = document.querySelector('.meter-label');
    const indicators = document.querySelectorAll('.indicator');
    
    if (!needle || !meterNumber || !meterLabel) return;
    
    // Generate new fear/greed value (simulate market changes)
    const currentValue = parseInt(meterNumber.textContent);
    const change = (Math.random() - 0.5) * 10; // -5 to +5 change
    const newValue = Math.max(0, Math.min(100, Math.round(currentValue + change)));
    
    // Update needle position (0-100 maps to -90deg to +90deg)
    const rotation = (newValue / 100) * 180 - 90;
    needle.style.transform = `rotate(${rotation}deg)`;
    needle.classList.add('updating');
    
    // Update number and label
    meterNumber.textContent = newValue;
    
    // Update label based on value
    let label, activeIndex;
    if (newValue <= 20) {
        label = 'EXTREME FEAR';
        activeIndex = 0;
    } else if (newValue <= 40) {
        label = 'FEAR';
        activeIndex = 1;
    } else if (newValue <= 60) {
        label = 'NEUTRAL';
        activeIndex = 2;
    } else if (newValue <= 80) {
        label = 'GREED';
        activeIndex = 3;
    } else {
        label = 'EXTREME GREED';
        activeIndex = 4;
    }
    
    meterLabel.textContent = label;
    
    // Update active indicator
    indicators.forEach((indicator, index) => {
        indicator.classList.toggle('active', index === activeIndex);
    });
    
    // Remove animation class
    setTimeout(() => {
        needle.classList.remove('updating');
    }, 1000);
    
    // Update sentiment components with new values
    updateSentimentComponents();
}

// Update sentiment components
function updateSentimentComponents() {
    const components = document.querySelectorAll('.sentiment-components .component-item');
    
    components.forEach(component => {
        const value = component.querySelector('.component-value');
        const impact = component.querySelector('.component-impact');
        const name = component.querySelector('.component-name').textContent;
        
        // Simulate component updates
        const changePercent = (Math.random() - 0.5) * 0.4; // -0.2 to +0.2
        
        if (name === 'VIX') {
            const currentVix = parseFloat(value.textContent);
            const newVix = Math.max(10, Math.min(50, currentVix + changePercent)).toFixed(1);
            value.textContent = newVix;
            value.className = `component-value ${newVix > 20 ? 'fear' : newVix < 15 ? 'greed' : 'neutral'}`;
        } else if (name === 'PUT/CALL') {
            const currentRatio = parseFloat(value.textContent);
            const newRatio = Math.max(0.5, Math.min(1.5, currentRatio + changePercent * 0.1)).toFixed(2);
            value.textContent = newRatio;
            value.className = `component-value ${newRatio > 1.0 ? 'fear' : 'greed'}`;
        }
        
        // Add flash effect
        component.classList.add('sentiment-update');
        setTimeout(() => component.classList.remove('sentiment-update'), 1000);
    });
}

// Update social sentiment
function updateSocialSentiment() {
    const sources = document.querySelectorAll('.sentiment-source');
    
    sources.forEach(source => {
        const score = source.querySelector('.source-score');
        const metrics = source.querySelectorAll('.metric-value');
        
        // Simulate score changes
        const currentScore = parseFloat(score.textContent);
        const change = (Math.random() - 0.5) * 0.2; // -0.1 to +0.1
        const newScore = Math.max(-1, Math.min(1, currentScore + change)).toFixed(2);
        
        score.textContent = newScore > 0 ? `+${newScore}` : newScore;
        
        // Update score styling
        if (newScore > 0.2) {
            score.className = 'source-score bullish';
        } else if (newScore < -0.2) {
            score.className = 'source-score bearish';
        } else {
            score.className = 'source-score neutral';
        }
        
        // Update some metrics randomly
        metrics.forEach(metric => {
            if (Math.random() > 0.7) { // 30% chance of update
                const parent = metric.closest('.metric');
                const label = parent.querySelector('.metric-label').textContent;
                
                if (label === 'VOLUME' && metric.textContent.includes('K')) {
                    const current = parseInt(metric.textContent.replace('K', ''));
                    const newValue = Math.max(100, current + Math.floor((Math.random() - 0.5) * 100));
                    metric.textContent = `${newValue}K`;
                } else if (label.includes('BULLISH') || label.includes('NEGATIVE')) {
                    const current = parseInt(metric.textContent.replace('%', ''));
                    const newValue = Math.max(0, Math.min(100, current + Math.floor((Math.random() - 0.5) * 10)));
                    metric.textContent = `${newValue}%`;
                }
                
                // Add flash effect
                parent.classList.add('sentiment-update');
                setTimeout(() => parent.classList.remove('sentiment-update'), 800);
            }
        });
    });
}

// Update institutional flow
function updateInstitutionalFlow() {
    const flowItems = document.querySelectorAll('.flow-item');
    
    flowItems.forEach(item => {
        const value = item.querySelector('.flow-value');
        const change = item.querySelector('.flow-change');
        
        if (Math.random() > 0.6) { // 40% chance of update
            // Simulate flow changes
            const currentValue = parseFloat(value.textContent.replace(/[$BMK]/g, ''));
            const changePercent = (Math.random() - 0.5) * 0.3; // -15% to +15%
            const newValue = currentValue * (1 + changePercent);
            
            // Format the new value
            let formattedValue;
            if (Math.abs(newValue) >= 1) {
                formattedValue = `${newValue >= 0 ? '+' : ''}$${Math.abs(newValue).toFixed(1)}B`;
            } else {
                formattedValue = `${newValue >= 0 ? '+' : ''}$${Math.abs(newValue * 1000).toFixed(0)}M`;
            }
            
            value.textContent = formattedValue;
            
            // Add flash effect
            item.classList.add('sentiment-update');
            setTimeout(() => item.classList.remove('sentiment-update'), 800);
        }
    });
}

// Update options flow
function updateOptionsFlow() {
    const optionItems = document.querySelectorAll('.option-item');
    
    optionItems.forEach(item => {
        if (Math.random() > 0.7) { // 30% chance of update
            const value = item.querySelector('.option-value');
            const type = item.querySelector('.option-type').textContent;
            
            if (type.includes('VOLUME')) {
                const current = parseFloat(value.textContent.replace('M', ''));
                const newValue = Math.max(0.5, current + (Math.random() - 0.5) * 0.5).toFixed(1);
                value.textContent = `${newValue}M`;
            } else if (type.includes('RATIO')) {
                const current = parseFloat(value.textContent);
                const newValue = Math.max(0.3, Math.min(2.0, current + (Math.random() - 0.5) * 0.1)).toFixed(2);
                value.textContent = newValue;
                
                // Update trend based on ratio
                const trend = item.querySelector('.option-trend');
                if (trend && trend.textContent !== 'ALERTS') {
                    trend.textContent = newValue < 0.8 ? 'BULLISH' : newValue > 1.2 ? 'BEARISH' : 'NEUTRAL';
                    trend.className = `option-trend ${newValue < 0.8 ? 'bullish' : 'neutral'}`;
                }
            }
            
            // Add flash effect
            item.classList.add('sentiment-update');
            setTimeout(() => item.classList.remove('sentiment-update'), 800);
        }
    });
}

// =============================================================================
// Yield Curve Analysis Functions
// =============================================================================

// Initialize yield curve analysis
function initializeYieldCurveAnalysis() {
    // Update yield curve data every 45 seconds
    setInterval(updateYieldCurveData, 45000);
    
    // Add click handlers for yield points
    document.querySelectorAll('.yield-point').forEach(point => {
        point.addEventListener('click', function() {
            const maturity = this.querySelector('.maturity').textContent;
            const yield = this.querySelector('.yield-value').textContent;
            const change = this.querySelector('.yield-change').textContent;
            showToast(`📊 ${maturity} Treasury: ${yield} (${change})`, 'info');
        });
    });
    
    // Add click handlers for curve points
    document.querySelectorAll('.curve-point').forEach(point => {
        point.addEventListener('click', function() {
            const maturity = this.getAttribute('data-maturity');
            const yield = this.getAttribute('data-yield');
            showToast(`🎯 ${maturity} yield: ${yield}%`, 'info');
        });
    });
    
    // Add click handlers for inversion alerts
    document.querySelectorAll('.inversion-item').forEach(item => {
        item.addEventListener('click', function() {
            const pair = this.querySelector('.inversion-pair').textContent;
            const spread = this.querySelector('.inversion-spread').textContent;
            const status = this.querySelector('.inversion-status').textContent;
            showToast(`⚠️ ${pair} spread: ${spread} • Status: ${status}`, 'info');
        });
    });
    
    // Add click handlers for historical context
    document.querySelectorAll('.context-item').forEach(item => {
        item.addEventListener('click', function() {
            const label = this.querySelector('.context-label').textContent;
            const value = this.querySelector('.context-value').textContent;
            showToast(`📈 ${label}: ${value}`, 'info');
        });
    });
    
    // Initialize real-time curve animation
    animateYieldCurve();
}

// Update yield curve data with realistic changes
function updateYieldCurveData() {
    const yields = [
        { selector: '.yield-point:nth-child(1)', maturity: '3M', baseYield: 5.45 },
        { selector: '.yield-point:nth-child(2)', maturity: '6M', baseYield: 5.38 },
        { selector: '.yield-point:nth-child(3)', maturity: '1Y', baseYield: 5.12 },
        { selector: '.yield-point:nth-child(4)', maturity: '2Y', baseYield: 4.85 },
        { selector: '.yield-point:nth-child(5)', maturity: '5Y', baseYield: 4.42 },
        { selector: '.yield-point:nth-child(6)', maturity: '10Y', baseYield: 4.38 },
        { selector: '.yield-point:nth-child(7)', maturity: '30Y', baseYield: 4.52 }
    ];
    
    yields.forEach((yieldData, index) => {
        const yieldPoint = document.querySelector(yieldData.selector);
        if (!yieldPoint) return;
        
        // Generate realistic yield changes (smaller for longer maturities)
        const volatility = index < 3 ? 0.05 : 0.02; // Short-term more volatile
        const change = (Math.random() - 0.5) * volatility;
        const newYield = Math.max(0.1, yieldData.baseYield + change);
        
        // Update yield value
        const yieldValueEl = yieldPoint.querySelector('.yield-value');
        const yieldChangeEl = yieldPoint.querySelector('.yield-change');
        
        if (yieldValueEl && yieldChangeEl) {
            const oldYield = parseFloat(yieldValueEl.textContent.replace('%', ''));
            const changeValue = newYield - oldYield;
            
            yieldValueEl.textContent = newYield.toFixed(2) + '%';
            yieldChangeEl.textContent = (changeValue >= 0 ? '+' : '') + changeValue.toFixed(2);
            yieldChangeEl.className = `yield-change ${changeValue >= 0 ? 'positive' : 'negative'}`;
            
            // Add flash effect
            yieldPoint.classList.add('updating');
            setTimeout(() => yieldPoint.classList.remove('updating'), 800);
        }
    });
    
    // Update curve visualization
    updateCurveVisualization();
    
    // Update inversion status
    updateInversionAlerts();
    
    // Update recession probability
    updateRecessionProbability();
}

// Update curve visualization points
function updateCurveVisualization() {
    const curvePoints = document.querySelectorAll('.curve-point');
    const yields = [];
    
    // Get current yield values
    document.querySelectorAll('.yield-value').forEach(el => {
        yields.push(parseFloat(el.textContent.replace('%', '')));
    });
    
    if (yields.length !== curvePoints.length) return;
    
    // Update curve points positions and data
    curvePoints.forEach((point, index) => {
        const yield = yields[index];
        const bottom = ((yield - 3) / 3) * 100; // Scale to chart height
        const clampedBottom = Math.max(5, Math.min(95, bottom));
        
        point.style.bottom = clampedBottom + '%';
        point.setAttribute('data-yield', yield.toFixed(2) + '%');
        
        // Add update animation
        point.classList.add('updating');
        setTimeout(() => point.classList.remove('updating'), 1000);
    });
    
    // Update curve shape classification
    updateCurveShape(yields);
}

// Update curve shape classification
function updateCurveShape(yields) {
    const curveShape = document.querySelector('.curve-shape');
    const recessionProb = document.querySelector('.probability-value');
    
    if (!curveShape || !recessionProb || yields.length < 7) return;
    
    const [threeMonth, sixMonth, oneYear, twoYear, fiveYear, tenYear, thirtyYear] = yields;
    
    // Check for inversions
    const threeMonthTenYearInverted = threeMonth > tenYear;
    const twoYearTenYearInverted = twoYear > tenYear;
    const shortLongSpread = tenYear - twoYear;
    
    let shape, probability;
    
    if (threeMonthTenYearInverted || twoYearTenYearInverted) {
        shape = 'INVERTED';
        probability = Math.min(85, 45 + Math.abs(shortLongSpread) * 10);
        curveShape.className = 'curve-shape inverted';
    } else if (Math.abs(shortLongSpread) < 0.3) {
        shape = 'FLAT';
        probability = Math.min(40, 20 + Math.abs(shortLongSpread) * 20);
        curveShape.className = 'curve-shape flat';
    } else if (shortLongSpread > 2.0) {
        shape = 'STEEP';
        probability = Math.max(5, 15 - shortLongSpread * 5);
        curveShape.className = 'curve-shape steep';
    } else {
        shape = 'NORMAL';
        probability = Math.max(8, 20 - shortLongSpread * 8);
        curveShape.className = 'curve-shape normal';
    }
    
    curveShape.textContent = shape;
    recessionProb.textContent = Math.round(probability) + '%';
    
    // Update recession probability color based on risk
    if (probability > 60) {
        recessionProb.style.color = 'var(--terminal-red)';
    } else if (probability > 30) {
        recessionProb.style.color = 'var(--terminal-yellow)';
    } else {
        recessionProb.style.color = 'var(--terminal-green)';
    }
}

// Update inversion alerts
function updateInversionAlerts() {
    const yields = [];
    document.querySelectorAll('.yield-value').forEach(el => {
        yields.push(parseFloat(el.textContent.replace('%', '')));
    });
    
    if (yields.length < 7) return;
    
    const [threeMonth, sixMonth, oneYear, twoYear, fiveYear, tenYear, thirtyYear] = yields;
    
    // Update inversion items
    const inversionItems = document.querySelectorAll('.inversion-item');
    
    // 3M-10Y inversion
    if (inversionItems[0]) {
        const spread = threeMonth - tenYear;
        const spreadEl = inversionItems[0].querySelector('.inversion-spread');
        const statusEl = inversionItems[0].querySelector('.inversion-status');
        
        spreadEl.textContent = (spread >= 0 ? '+' : '') + Math.round(spread * 100) + ' bps';
        
        if (spread > 0) {
            statusEl.textContent = 'INVERTED';
            inversionItems[0].className = 'inversion-item critical';
        } else {
            statusEl.textContent = 'NORMAL';
            inversionItems[0].className = 'inversion-item normal';
        }
    }
    
    // 2Y-10Y inversion
    if (inversionItems[1]) {
        const spread = twoYear - tenYear;
        const spreadEl = inversionItems[1].querySelector('.inversion-spread');
        const statusEl = inversionItems[1].querySelector('.inversion-status');
        
        spreadEl.textContent = (spread >= 0 ? '+' : '') + Math.round(spread * 100) + ' bps';
        
        if (spread > 0) {
            statusEl.textContent = 'INVERTED';
            inversionItems[1].className = 'inversion-item warning';
        } else {
            statusEl.textContent = 'NORMAL';
            inversionItems[1].className = 'inversion-item normal';
        }
    }
    
    // 5Y-30Y spread
    if (inversionItems[2]) {
        const spread = fiveYear - thirtyYear;
        const spreadEl = inversionItems[2].querySelector('.inversion-spread');
        const statusEl = inversionItems[2].querySelector('.inversion-status');
        
        spreadEl.textContent = (spread >= 0 ? '+' : '') + Math.round(spread * 100) + ' bps';
        statusEl.textContent = 'NORMAL';
        inversionItems[2].className = 'inversion-item normal';
    }
    
    // Add flash effects to updated items
    inversionItems.forEach(item => {
        item.classList.add('updating');
        setTimeout(() => item.classList.remove('updating'), 1000);
    });
}

// Update recession probability based on current curve
function updateRecessionProbability() {
    const yields = [];
    document.querySelectorAll('.yield-value').forEach(el => {
        yields.push(parseFloat(el.textContent.replace('%', '')));
    });
    
    if (yields.length < 7) return;
    
    const [threeMonth, , , twoYear, , tenYear] = yields;
    
    // Calculate recession probability using multiple factors
    let probability = 10; // Base probability
    
    // 3M-10Y inversion factor (most predictive)
    if (threeMonth > tenYear) {
        probability += Math.min(50, (threeMonth - tenYear) * 100);
    }
    
    // 2Y-10Y inversion factor
    if (twoYear > tenYear) {
        probability += Math.min(30, (twoYear - tenYear) * 80);
    }
    
    // Duration of inversion (simulated)
    const inversionDays = 47; // Current simulated duration
    if (inversionDays > 30) {
        probability += Math.min(20, inversionDays / 5);
    }
    
    // Cap at 95%
    probability = Math.min(95, probability);
    
    const probEl = document.querySelector('.probability-value');
    if (probEl) {
        probEl.textContent = Math.round(probability) + '%';
        
        // Add flash effect
        probEl.parentElement.classList.add('yield-update');
        setTimeout(() => {
            probEl.parentElement.classList.remove('yield-update');
        }, 1000);
    }
}

// Animate yield curve with realistic movements
function animateYieldCurve() {
    const curvePoints = document.querySelectorAll('.curve-point');
    
    curvePoints.forEach((point, index) => {
        // Add subtle breathing animation to show live data
        point.style.animation = `pulse-curve 3s ease-in-out infinite`;
        point.style.animationDelay = `${index * 0.2}s`;
    });
}

// Get yield curve AI analysis
async function getYieldCurveAnalysis() {
    try {
        // Gather comprehensive yield curve data
        const yieldCurveData = {
            current_yields: {
                '3M': 5.45,
                '6M': 5.38,
                '1Y': 5.12,
                '2Y': 4.85,
                '5Y': 4.42,
                '10Y': 4.38,
                '30Y': 4.52
            },
            inversions: {
                '3M_10Y': { spread: 107, status: 'inverted', duration_days: 47 },
                '2Y_10Y': { spread: 47, status: 'inverted', duration_days: 12 },
                '5Y_30Y': { spread: -10, status: 'normal', duration_days: 0 }
            },
            curve_shape: 'inverted',
            recession_probability: 67,
            historical_context: {
                last_normal: 'MAR 2022',
                steepest_recent: 'MAR 2020',
                average_recession_lag: '12-18 months',
                fed_pivot_expected: 'Q4 2024'
            }
        };

        const response = await fetch('http://localhost:3000/api/explain-indicator', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                indicator: 'yield_curve_analysis',
                currentValue: JSON.stringify(yieldCurveData),
                trend: 'comprehensive_curve_analysis'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch yield curve analysis');
        }

        const data = await response.json();
        return data.explanation;
    } catch (error) {
        console.error('Error getting yield curve analysis:', error);
        return null;
    }
}

// Add yield curve analysis button functionality
function addYieldCurveAnalysisButton() {
    const curveAnalysis = document.querySelector('.yield-curve-analysis');
    if (!curveAnalysis) return;
    
    // Create analysis button
    const analysisButton = document.createElement('button');
    analysisButton.className = 'analysis-btn';
    analysisButton.style.cssText = `
        width: 100%;
        background: var(--terminal-orange);
        color: var(--terminal-bg);
        border: none;
        padding: 8px 12px;
        font-size: 9px;
        font-weight: bold;
        cursor: pointer;
        font-family: inherit;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 8px;
    `;
    analysisButton.textContent = '🤖 GENERATE YIELD CURVE AI ANALYSIS';
    
    // Create result container
    const resultDiv = document.createElement('div');
    resultDiv.className = 'analysis-result';
    resultDiv.style.cssText = `
        margin-top: 8px;
        padding: 8px;
        background: var(--terminal-secondary);
        border: 1px solid var(--terminal-border);
        border-left: 3px solid var(--terminal-blue);
        font-size: 9px;
        line-height: 1.4;
        display: none;
    `;
    
    // Add click handler
    analysisButton.addEventListener('click', async function() {
        this.textContent = '🤖 ANALYZING YIELD CURVE...';
        this.disabled = true;
        
        try {
            const analysis = await getYieldCurveAnalysis();
            
            if (analysis) {
                resultDiv.innerHTML = `
                    <div class="ai-header" style="color: var(--terminal-orange); font-weight: bold; margin-bottom: 6px;">
                        🤖 GEMINI AI YIELD CURVE ANALYSIS
                    </div>
                    <div class="ai-content" style="color: var(--terminal-white);">
                        ${analysis}
                    </div>
                `;
                resultDiv.style.display = 'block';
                
                // Add flash animation to yield curve elements
                document.querySelectorAll('.yield-point').forEach(point => {
                    point.classList.add('yield-update');
                    setTimeout(() => point.classList.remove('yield-update'), 800);
                });
                
                showToast('📊 Yield curve analysis complete!', 'success');
            } else {
                throw new Error('No analysis received');
            }
        } catch (error) {
            console.error('Error getting yield curve analysis:', error);
            resultDiv.innerHTML = `
                <div class="ai-header" style="color: var(--terminal-red); font-weight: bold;">
                    ⚠️ ANALYSIS UNAVAILABLE
                </div>
                <div class="ai-content" style="color: var(--terminal-white);">
                    Unable to generate yield curve analysis at this time. Please check AI service connection.
                </div>
            `;
            resultDiv.style.display = 'block';
            showToast('Error generating yield curve analysis', 'error');
        }
        
        this.textContent = '🤖 GENERATE YIELD CURVE AI ANALYSIS';
        this.disabled = false;
    });
    
    // Append to curve analysis container
    curveAnalysis.appendChild(analysisButton);
    curveAnalysis.appendChild(resultDiv);
}

// =============================================================================
// Enhanced Terminal Interface Functions
// =============================================================================

// =============================================================================
// Community Forum Functions
// =============================================================================

// Initialize community forum functionality
function initializeCommunityForum() {
    // Initialize category switching
    initializeCategoryFilters();
    
    // Initialize thread filters
    initializeThreadFilters();
    
    // Initialize new post functionality
    initializeNewPostForm();
    
    // Initialize thread interactions
    initializeThreadInteractions();
    
    // Initialize online users updates
    initializeOnlineUsers();
    
    // Start real-time updates
    setTimeout(() => {
        updateForumStats();
    }, 3000);
}

// Initialize category filter functionality
function initializeCategoryFilters() {
    const categoryItems = document.querySelectorAll('.category-item');
    
    categoryItems.forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all categories
            categoryItems.forEach(cat => cat.classList.remove('active'));
            
            // Add active class to clicked category
            this.classList.add('active');
            
            const category = this.dataset.category;
            const categoryName = this.querySelector('.category-name').textContent;
            
            // Filter threads by category
            filterThreadsByCategory(category);
            
            showToast(`📁 Viewing ${categoryName} discussions`, 'info');
        });
    });
}

// Initialize thread filter functionality
function initializeThreadFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active class from all filters
            filterBtns.forEach(filter => filter.classList.remove('active'));
            
            // Add active class to clicked filter
            this.classList.add('active');
            
            const filter = this.dataset.filter;
            
            // Apply filter
            applyThreadFilter(filter);
            
            showToast(`🔍 Sorting by ${filter}`, 'info');
        });
    });
}

// Initialize new post form functionality
function initializeNewPostForm() {
    const newPostBtn = document.querySelector('.new-post-btn');
    const newPostForm = document.getElementById('newPostForm');
    const submitBtn = document.querySelector('.submit-post-btn');
    const cancelBtn = document.querySelector('.cancel-post-btn');
    
    if (newPostBtn) {
        newPostBtn.addEventListener('click', toggleNewPost);
    }
    
    if (submitBtn) {
        submitBtn.addEventListener('click', submitNewPost);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', toggleNewPost);
    }
}

// Initialize thread interaction functionality
function initializeThreadInteractions() {
    const threadItems = document.querySelectorAll('.thread-item');
    
    threadItems.forEach(thread => {
        thread.addEventListener('click', function(e) {
            // Don't trigger if clicking on stats
            if (e.target.closest('.thread-stats')) return;
            
            const title = this.querySelector('.thread-title').textContent;
            const author = this.querySelector('.author-name').textContent;
            
            // Simulate opening thread
            showToast(`📖 Opening: ${title} by ${author}`, 'info');
            
            // Add visual feedback
            this.style.background = 'rgba(255, 165, 0, 0.1)';
            setTimeout(() => {
                this.style.background = '';
            }, 300);
        });
        
        // Add hover effects
        thread.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(4px)';
            this.style.transition = 'transform 0.2s ease';
        });
        
        thread.addEventListener('mouseleave', function() {
            this.style.transform = 'translateX(0)';
        });
    });
    
    // Initialize load more functionality
    const loadMoreBtn = document.querySelector('.load-more-btn');
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', loadMoreThreads);
    }
}

// Initialize online users functionality
function initializeOnlineUsers() {
    const onlineUsers = document.querySelectorAll('.online-user');
    
    onlineUsers.forEach(user => {
        user.addEventListener('click', function() {
            const userName = this.querySelector('.user-name').textContent;
            const userStatus = this.querySelector('.user-status').textContent;
            
            showToast(`👤 ${userName}: ${userStatus}`, 'info');
        });
    });
}

// Toggle new post form visibility
function toggleNewPost() {
    const form = document.getElementById('newPostForm');
    const btn = document.querySelector('.new-post-btn');
    
    if (form.style.display === 'none' || !form.style.display) {
        form.style.display = 'block';
        btn.textContent = '❌ CANCEL';
        
        // Focus on title input
        const titleInput = form.querySelector('.post-title-input');
        if (titleInput) {
            setTimeout(() => titleInput.focus(), 100);
        }
    } else {
        form.style.display = 'none';
        btn.textContent = '✍️ START NEW DISCUSSION';
        
        // Clear form
        clearNewPostForm();
    }
}

// Submit new post
function submitNewPost() {
    const titleInput = document.querySelector('.post-title-input');
    const categorySelect = document.querySelector('.post-category-select');
    const contentInput = document.querySelector('.post-content-input');
    
    const title = titleInput.value.trim();
    const category = categorySelect.value;
    const content = contentInput.value.trim();
    
    // Validate inputs
    if (!title) {
        showToast('❌ Please enter a discussion title', 'error');
        titleInput.focus();
        return;
    }
    
    if (!content) {
        showToast('❌ Please enter discussion content', 'error');
        contentInput.focus();
        return;
    }
    
    // Simulate posting
    const submitBtn = document.querySelector('.submit-post-btn');
    submitBtn.textContent = 'POSTING...';
    submitBtn.disabled = true;
    
    setTimeout(() => {
        // Create new thread element
        createNewThread(title, category, content);
        
        // Reset form
        clearNewPostForm();
        toggleNewPost();
        
        // Reset button
        submitBtn.textContent = 'POST DISCUSSION';
        submitBtn.disabled = false;
        
        showToast('🎉 Discussion posted successfully!', 'success');
    }, 1500);
}

// Clear new post form
function clearNewPostForm() {
    const titleInput = document.querySelector('.post-title-input');
    const contentInput = document.querySelector('.post-content-input');
    const categorySelect = document.querySelector('.post-category-select');
    
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    if (categorySelect) categorySelect.selectedIndex = 0;
}

// Create new thread element
function createNewThread(title, category, content) {
    const threadsList = document.querySelector('.threads-list');
    if (!threadsList) return;
    
    const categoryIcons = {
        'general': '💼',
        'predictions': '🎯',
        'markets': '📈',
        'fed': '🏛️',
        'strategy': '🧠'
    };
    
    const categoryNames = {
        'general': 'GENERAL',
        'predictions': 'PREDICTIONS',
        'markets': 'MARKETS',
        'fed': 'FED',
        'strategy': 'STRATEGY'
    };
    
    const newThread = document.createElement('div');
    newThread.className = 'thread-item new-thread';
    newThread.innerHTML = `
        <div class="thread-meta">
            <div class="thread-status">🆕 NEW</div>
            <div class="thread-category">${categoryIcons[category]} ${categoryNames[category]}</div>
            <div class="thread-time">Just now</div>
        </div>
        <div class="thread-title">${title}</div>
        <div class="thread-preview">${content.substring(0, 120)}${content.length > 120 ? '...' : ''}</div>
        <div class="thread-footer">
            <div class="thread-author">
                <div class="author-avatar">🌟</div>
                <div class="author-name">YOU</div>
                <div class="author-badge newcomer">NEWCOMER</div>
            </div>
            <div class="thread-stats">
                <span class="stat-replies">0 replies</span>
                <span class="stat-likes">👍 0</span>
                <span class="stat-views">1 view</span>
            </div>
        </div>
    `;
    
    // Add to top of threads list
    threadsList.insertBefore(newThread, threadsList.firstChild);
    
    // Add click handler
    newThread.addEventListener('click', function(e) {
        if (e.target.closest('.thread-stats')) return;
        showToast(`📖 Opening your discussion: ${title}`, 'info');
    });
    
    // Add flash effect
    newThread.style.background = 'rgba(0, 255, 65, 0.1)';
    setTimeout(() => {
        newThread.style.background = '';
        newThread.classList.remove('new-thread');
    }, 3000);
}

// Filter threads by category
function filterThreadsByCategory(category) {
    const threads = document.querySelectorAll('.thread-item');
    
    threads.forEach(thread => {
        const threadCategory = thread.querySelector('.thread-category');
        if (!threadCategory) return;
        
        const categoryText = threadCategory.textContent.toLowerCase();
        
        if (category === 'general' || categoryText.includes(category.substring(0, 3))) {
            thread.style.display = 'block';
            thread.style.animation = 'fadeIn 0.3s ease';
        } else {
            thread.style.display = 'none';
        }
    });
}

// Apply thread filter (recent, hot, top)
function applyThreadFilter(filter) {
    const threads = document.querySelectorAll('.thread-item');
    const threadsArray = Array.from(threads);
    
    // Sort threads based on filter
    let sortedThreads;
    
    switch (filter) {
        case 'hot':
            sortedThreads = threadsArray.sort((a, b) => {
                const aHot = a.classList.contains('hot') ? 1 : 0;
                const bHot = b.classList.contains('hot') ? 1 : 0;
                return bHot - aHot;
            });
            break;
        case 'top':
            sortedThreads = threadsArray.sort((a, b) => {
                const aLikes = parseInt(a.querySelector('.stat-likes').textContent.match(/\d+/)?.[0] || 0);
                const bLikes = parseInt(b.querySelector('.stat-likes').textContent.match(/\d+/)?.[0] || 0);
                return bLikes - aLikes;
            });
            break;
        default: // recent
            sortedThreads = threadsArray.sort((a, b) => {
                const aTime = a.querySelector('.thread-time').textContent;
                const bTime = b.querySelector('.thread-time').textContent;
                // Simple time comparison (in real app would use actual timestamps)
                return aTime.includes('hour') ? -1 : 1;
            });
    }
    
    // Reorder threads in DOM
    const threadsList = document.querySelector('.threads-list');
    const loadMoreSection = document.querySelector('.load-more-section');
    
    sortedThreads.forEach(thread => {
        threadsList.insertBefore(thread, loadMoreSection);
    });
}

// Load more threads
function loadMoreThreads() {
    const loadMoreBtn = document.querySelector('.load-more-btn');
    
    loadMoreBtn.textContent = 'LOADING...';
    loadMoreBtn.disabled = true;
    
    setTimeout(() => {
        // Simulate loading more threads
        const threadsList = document.querySelector('.threads-list');
        const loadMoreSection = document.querySelector('.load-more-section');
        
        // Add a few more simulated threads
        const newThreadsData = [
            {
                category: '💼 GENERAL',
                time: '2 days ago',
                title: 'Understanding Economic Cycles: A Beginner\'s Guide',
                preview: 'Can someone explain the different phases of economic cycles and how they relate to market movements? I\'m trying to understand...',
                author: 'LearningEcon',
                badge: 'newcomer',
                replies: 23,
                likes: 15,
                views: 445
            },
            {
                category: '📈 MARKETS',
                time: '3 days ago',
                title: 'Tech Sector Rotation: Signs of a Shift?',
                preview: 'Seeing unusual volume patterns in tech vs value stocks. Could this be the start of a major sector rotation? Looking at the data...',
                author: 'SectorAnalyst',
                badge: 'expert',
                replies: 18,
                likes: 11,
                views: 332
            }
        ];
        
        newThreadsData.forEach(threadData => {
            const newThread = document.createElement('div');
            newThread.className = 'thread-item';
            newThread.innerHTML = `
                <div class="thread-meta">
                    <div class="thread-category">${threadData.category}</div>
                    <div class="thread-time">${threadData.time}</div>
                </div>
                <div class="thread-title">${threadData.title}</div>
                <div class="thread-preview">${threadData.preview}</div>
                <div class="thread-footer">
                    <div class="thread-author">
                        <div class="author-avatar">📊</div>
                        <div class="author-name">${threadData.author}</div>
                        <div class="author-badge ${threadData.badge}">${threadData.badge.toUpperCase()}</div>
                    </div>
                    <div class="thread-stats">
                        <span class="stat-replies">${threadData.replies} replies</span>
                        <span class="stat-likes">👍 ${threadData.likes}</span>
                        <span class="stat-views">${threadData.views} views</span>
                    </div>
                </div>
            `;
            
            threadsList.insertBefore(newThread, loadMoreSection);
            
            // Add click handler
            newThread.addEventListener('click', function(e) {
                if (e.target.closest('.thread-stats')) return;
                showToast(`📖 Opening: ${threadData.title}`, 'info');
            });
        });
        
        loadMoreBtn.textContent = 'LOAD MORE DISCUSSIONS';
        loadMoreBtn.disabled = false;
        
        showToast('📚 Loaded more discussions', 'success');
    }, 1000);
}

// Update forum stats with real-time changes
function updateForumStats() {
    const statValues = document.querySelectorAll('.forum-stat .stat-value');
    
    if (statValues.length >= 4) {
        // Simulate small increases in forum activity
        const members = statValues[0];
        const discussions = statValues[1];
        const posts = statValues[2];
        const online = statValues[3];
        
        // Random small increases
        if (Math.random() > 0.7) {
            const currentDiscussions = parseInt(discussions.textContent.replace(',', ''));
            discussions.textContent = (currentDiscussions + 1).toLocaleString();
            discussions.parentElement.classList.add('flash-positive');
            setTimeout(() => discussions.parentElement.classList.remove('flash-positive'), 500);
        }
        
        if (Math.random() > 0.5) {
            const currentPosts = parseInt(posts.textContent.replace(',', ''));
            posts.textContent = (currentPosts + Math.floor(Math.random() * 3) + 1).toLocaleString();
            posts.parentElement.classList.add('flash-positive');
            setTimeout(() => posts.parentElement.classList.remove('flash-positive'), 500);
        }
        
        // Update online count
        const currentOnline = parseInt(online.textContent);
        const newOnline = Math.max(15, currentOnline + Math.floor(Math.random() * 6) - 3);
        online.textContent = newOnline;
        
        // Update online users list
        updateOnlineUsersList(newOnline);
    }
    
    // Schedule next update
    setTimeout(() => {
        updateForumStats();
    }, 30000);
}

// Update online users list
function updateOnlineUsersList(count) {
    const onlineHeader = document.querySelector('.online-header');
    if (onlineHeader) {
        onlineHeader.textContent = `👥 ONLINE NOW (${count})`;
    }
    
    const moreUsersText = document.querySelector('.online-users-more');
    if (moreUsersText) {
        const visibleUsers = 5;
        const hiddenUsers = Math.max(0, count - visibleUsers);
        moreUsersText.textContent = `+${hiddenUsers} more forecasters online`;
    }
}