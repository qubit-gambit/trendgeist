const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const paymentManager = require('../utils/payments');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// =============================================================================
// PRICING & PLANS
// =============================================================================

// Get subscription plans
router.get('/plans', (req, res) => {
    try {
        const plans = paymentManager.getSubscriptionPlans();
        const currency = req.query.currency || 'USD';
        
        // Convert prices to user's currency
        const convertedPlans = Object.keys(plans).reduce((acc, key) => {
            const plan = plans[key];
            acc[key] = {
                ...plan,
                price_local: paymentManager.convertPrice(plan.price_usd, currency),
                currency: currency
            };
            return acc;
        }, {});

        res.json({
            success: true,
            plans: convertedPlans,
            currency
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get token packages
router.get('/tokens', (req, res) => {
    try {
        const packages = paymentManager.getTokenPackages();
        const currency = req.query.currency || 'USD';
        
        // Convert prices to user's currency
        const convertedPackages = Object.keys(packages).reduce((acc, key) => {
            const pkg = packages[key];
            acc[key] = {
                ...pkg,
                price_local: paymentManager.convertPrice(pkg.price_usd, currency),
                currency: currency
            };
            return acc;
        }, {});

        res.json({
            success: true,
            packages: convertedPackages,
            currency
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// CHECKOUT SESSION CREATION
// =============================================================================

// Create payment session for subscription
router.post('/create-subscription', authenticateToken, async (req, res) => {
    try {
        const { plan_id, currency = 'USD' } = req.body;
        const user = req.user;

        const session = await paymentManager.createPaymentSession({
            type: 'subscription',
            plan_id,
            user_id: user.id,
            email: user.email,
            currency,
            return_url: process.env.FRONTEND_URL || 'https://qubit-gambit.github.io/trendgeist'
        });

        res.json(session);
    } catch (error) {
        console.error('Subscription creation error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Create payment session for tokens
router.post('/create-token-purchase', authenticateToken, async (req, res) => {
    try {
        const { package_id, currency = 'USD' } = req.body;
        const user = req.user;

        const session = await paymentManager.createPaymentSession({
            type: 'tokens',
            plan_id: package_id,
            user_id: user.id,
            email: user.email,
            currency,
            return_url: process.env.FRONTEND_URL || 'https://qubit-gambit.github.io/trendgeist'
        });

        res.json(session);
    } catch (error) {
        console.error('Token purchase error:', error);
        res.status(400).json({ error: error.message });
    }
});

// =============================================================================
// PAYMENT STATUS & HISTORY
// =============================================================================

// Get payment session status
router.get('/session/:session_id', authenticateToken, async (req, res) => {
    try {
        const { session_id } = req.params;
        const session = await stripe.checkout.sessions.retrieve(session_id);
        
        res.json({
            success: true,
            status: session.payment_status,
            amount: session.amount_total,
            currency: session.currency
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get user's payment history
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const analytics = await paymentManager.getPaymentAnalytics(userId);
        
        res.json({
            success: true,
            payments: analytics
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user's current subscription
router.get('/subscription', authenticateToken, async (req, res) => {
    try {
        const pool = require('../database/config');
        const result = await pool.query(
            'SELECT subscription_plan, subscription_status, subscription_start, subscription_end FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const subscription = result.rows[0];
        const plans = paymentManager.getSubscriptionPlans();
        const currentPlan = plans[subscription.subscription_plan];

        res.json({
            success: true,
            subscription: {
                ...subscription,
                plan_details: currentPlan || null
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

// Cancel subscription
router.post('/cancel-subscription', authenticateToken, async (req, res) => {
    try {
        const pool = require('../database/config');
        const result = await pool.query(
            'SELECT stripe_subscription_id FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0 || !result.rows[0].stripe_subscription_id) {
            return res.status(404).json({ error: 'No active subscription found' });
        }

        const subscriptionId = result.rows[0].stripe_subscription_id;
        
        // Cancel subscription in Stripe
        await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
        });

        // Update database
        await pool.query(
            'UPDATE users SET subscription_status = $1 WHERE id = $2',
            ['canceling', req.user.id]
        );

        res.json({
            success: true,
            message: 'Subscription will be canceled at the end of billing period'
        });
    } catch (error) {
        console.error('Subscription cancellation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// STRIPE WEBHOOKS
// =============================================================================

// Stripe webhook endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        await paymentManager.handleWebhook(event);
        res.json({ received: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// =============================================================================
// CURRENCY & LOCALIZATION
// =============================================================================

// Get user's suggested currency based on location
router.get('/currency', (req, res) => {
    try {
        const countryCode = req.headers['cf-ipcountry'] || req.query.country || 'US';
        const currency = paymentManager.getUserCurrency(countryCode);
        
        res.json({
            success: true,
            country: countryCode,
            currency,
            supported_currencies: paymentManager.supportedCurrencies
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// ANALYTICS (Admin only)
// =============================================================================

// Get payment analytics (admin)
router.get('/analytics', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin (you'll need to implement admin check)
        const analytics = await paymentManager.getPaymentAnalytics();
        const settlementInfo = paymentManager.getPakistaniSettlementInfo();
        
        res.json({
            success: true,
            analytics,
            settlement_info: settlementInfo
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// PAKISTANI SETTLEMENT INFO
// =============================================================================

// Get settlement information for Pakistani businesses
router.get('/settlement-info', (req, res) => {
    try {
        const info = paymentManager.getPakistaniSettlementInfo();
        res.json({
            success: true,
            settlement_info: info
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 