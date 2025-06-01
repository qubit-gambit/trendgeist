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
            this.updateCPICard(cpiData);
            this.updateUnemploymentCard(unemploymentData);
            this.updateFedCard(fedRateData);

            // Update AI coaching with real data insights
            this.updateAICoaching(cpiData, unemploymentData, fedRateData);

        } catch (error) {
            console.error('Failed to update with real data:', error);
        }
    }

    updateCPICard(cpiData) {
        const observations = cpiData.observations.filter(obs => obs.value !== '.');
        if (observations.length < 2) return;

        const latest = parseFloat(observations[0].value);
        const previous = parseFloat(observations[1].value);
        const monthlyChange = ((latest - previous) / previous * 100).toFixed(2);

        const cpiCard = document.querySelector('.prediction-card');
        if (cpiCard) {
            const question = cpiCard.querySelector('.question');
            question.textContent = `Will CPI increase by more than 0.3% month-over-month? (Last: +${monthlyChange}%, Current: ${latest.toFixed(1)})`;
            
            // Add real data context
            this.addDataContext(cpiCard, {
                latest: latest,
                change: monthlyChange,
                trend: monthlyChange > 0.2 ? 'Rising' : monthlyChange < 0 ? 'Falling' : 'Stable'
            });
        }
    }

    updateUnemploymentCard(unemploymentData) {
        const observations = unemploymentData.observations.filter(obs => obs.value !== '.');
        if (observations.length < 1) return;

        const latest = parseFloat(observations[0].value);
        const cards = document.querySelectorAll('.prediction-card');
        
        if (cards[1]) {
            const question = cards[1].querySelector('.question');
            question.textContent = `Will unemployment rate stay below 4.0% in the next report? (Current: ${latest}%)`;
            
            this.addDataContext(cards[1], {
                latest: latest,
                status: latest < 4 ? 'Low' : latest > 6 ? 'High' : 'Moderate',
                trend: 'Federal Reserve target range'
            });
        }
    }

    updateFedCard(fedRateData) {
        const observations = fedRateData.observations.filter(obs => obs.value !== '.');
        if (observations.length < 1) return;

        const latest = parseFloat(observations[0].value);
        const cards = document.querySelectorAll('.prediction-card');
        
        if (cards[2]) {
            const question = cards[2].querySelector('.question');
            question.textContent = `Will the Federal Reserve hold rates steady at ${latest}% at the next FOMC meeting?`;
            
            this.addDataContext(cards[2], {
                latest: latest,
                level: latest > 5 ? 'Restrictive' : latest < 2 ? 'Accommodative' : 'Neutral',
                trend: 'FOMC policy stance'
            });
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
        `;
    }

    updateAICoaching(cpiData, unemploymentData, fedRateData) {
        const insights = document.querySelectorAll('.coach-insight');
        
        if (insights[0]) {
            const cpiObs = cpiData.observations.filter(obs => obs.value !== '.');
            const latest = parseFloat(cpiObs[0].value);
            const previous = parseFloat(cpiObs[1].value);
            const change = ((latest - previous) / previous * 100).toFixed(2);
            
            insights[0].innerHTML = `
                <strong>Real-Time CPI Analysis:</strong> Latest CPI reading shows ${change}% monthly change. 
                Based on current inflation trends from FRED data, ${change > 0.3 ? 'consider moderate confidence (60-70%) as volatility is elevated' : 'higher confidence (75-85%) may be appropriate given stable readings'}.
            `;
        }

        if (insights[1]) {
            const unemploymentObs = unemploymentData.observations.filter(obs => obs.value !== '.');
            const currentRate = parseFloat(unemploymentObs[0].value);
            
            insights[1].innerHTML = `
                <strong>Employment Market Reality:</strong> Current unemployment at ${currentRate}% (FRED live data). 
                ${currentRate < 4 ? 'Tight labor market suggests continued employment strength' : 'Rising unemployment may signal economic cooling'}. 
                Historical accuracy on employment data: adjust your confidence accordingly.
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
// Application Initialization
// =============================================================================

// Initialize everything when page loads
window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('Trendgeist initializing...');
        
        // Initialize UI components
        initializeConfidenceSliders();
        initializePredictionHandlers();
        initializeModalHandlers();
        
        // Welcome message
        setTimeout(() => {
            showToast('Welcome to Trendgeist! 🚀 Connecting to live economic data...', 'info');
        }, 1000);

        // Initialize FRED integration
        const dataManager = await initializeFREDIntegration();
        
        // If FRED is working, show enhanced coaching
        if (dataManager && dataManager.isInitialized) {
            setTimeout(() => {
                showToast('✨ AI coach now enhanced with real Federal Reserve data!', 'success');
            }, 3000);
        }
        
        console.log('Trendgeist initialization complete');
        
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('⚠️ Some features may not be available. Please refresh the page.', 'error');
    }
});

// Global functions for HTML onclick handlers
window.switchTab = switchTab;
window.openSignupModal = openSignupModal;
window.closeSignupModal = closeSignupModal;
window.openSigninModal = openSigninModal;
window.closeSigninModal = closeSigninModal;
window.signOut = signOut;