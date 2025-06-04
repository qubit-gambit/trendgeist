const { v4: uuidv4 } = require('uuid');

// Global payment manager for handling subscriptions and token purchases
class GlobalPaymentManager {
    constructor() {
        // Initialize Stripe only if API key is available
        if (process.env.STRIPE_SECRET_KEY) {
            this.stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            this.isEnabled = true;
            console.log('✅ Stripe payments initialized');
        } else {
            this.stripe = null;
            this.isEnabled = false;
            console.warn('⚠️  STRIPE_SECRET_KEY not provided - payment features will be disabled');
        }
        
        this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        this.appUrl = process.env.APP_URL || 'https://qubit-gambit.github.io/trendgeist';
        
        this.supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'SGD', 'AED'];
        this.defaultCurrency = 'USD'; // Settles to Pakistani bank in USD
    }

    // =============================================================================
    // SUBSCRIPTION PLANS (Global SaaS Pricing)
    // =============================================================================

    getSubscriptionPlans() {
        return {
            basic: {
                id: 'basic_monthly',
                name: 'Trendgeist Basic',
                price_usd: 9.99,
                price_pkr: 2800, // Approximate PKR equivalent
                features: [
                    '10 AI predictions per month',
                    'Basic economic data',
                    '500 prediction tokens',
                    'Community access'
                ],
                stripe_price_id: process.env.STRIPE_BASIC_PRICE_ID
            },
            pro: {
                id: 'pro_monthly', 
                name: 'Trendgeist Pro',
                price_usd: 29.99,
                price_pkr: 8400,
                features: [
                    'Unlimited AI predictions',
                    'Premium FRED data access',
                    '2000 prediction tokens monthly',
                    'Advanced yield curve analysis',
                    'Priority support'
                ],
                stripe_price_id: process.env.STRIPE_PRO_PRICE_ID
            },
            expert: {
                id: 'expert_monthly',
                name: 'Trendgeist Expert', 
                price_usd: 99.99,
                price_pkr: 28000,
                features: [
                    'Everything in Pro',
                    'Custom AI model training',
                    '10000 prediction tokens monthly',
                    'API access',
                    'White-label predictions',
                    'Dedicated account manager'
                ],
                stripe_price_id: process.env.STRIPE_EXPERT_PRICE_ID
            }
        };
    }

    // =============================================================================
    // TOKEN PACKAGES (For Prediction Markets)
    // =============================================================================

    getTokenPackages() {
        return {
            starter: {
                id: 'tokens_1000',
                name: '1,000 Prediction Tokens',
                tokens: 1000,
                price_usd: 4.99,
                price_pkr: 1400,
                bonus: 0
            },
            popular: {
                id: 'tokens_5000',
                name: '5,000 Prediction Tokens',
                tokens: 5000,
                price_usd: 19.99,
                price_pkr: 5600,
                bonus: 500, // 10% bonus
                badge: 'Most Popular'
            },
            value: {
                id: 'tokens_15000', 
                name: '15,000 Prediction Tokens',
                tokens: 15000,
                price_usd: 49.99,
                price_pkr: 14000,
                bonus: 3000, // 20% bonus
                badge: 'Best Value'
            },
            whale: {
                id: 'tokens_50000',
                name: '50,000 Prediction Tokens',
                tokens: 50000,
                price_usd: 149.99,
                price_pkr: 42000,
                bonus: 15000, // 30% bonus
                badge: 'Whale Package'
            }
        };
    }

    // =============================================================================
    // PAYMENT PROCESSING
    // =============================================================================

    async createPaymentSession(paymentData) {
        try {
            // Check if payments are enabled
            if (!this.isEnabled) {
                throw new Error('Payment processing is currently disabled. Please contact support.');
            }

            const { type, plan_id, user_id, currency = 'USD', return_url } = paymentData;

            let sessionData = {
                payment_method_types: ['card'],
                mode: type === 'subscription' ? 'subscription' : 'payment',
                customer_email: paymentData.email,
                client_reference_id: user_id,
                success_url: `${return_url}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${return_url}/payment/cancel`,
                currency: currency.toLowerCase(),
                metadata: {
                    user_id,
                    type,
                    plan_id,
                    created_at: new Date().toISOString()
                }
            };

            if (type === 'subscription') {
                // Subscription payment
                const plans = this.getSubscriptionPlans();
                const plan = plans[plan_id];
                
                if (!plan) {
                    throw new Error('Invalid subscription plan');
                }

                sessionData.line_items = [{
                    price: plan.stripe_price_id,
                    quantity: 1
                }];

                // Add trial period for new customers
                sessionData.subscription_data = {
                    trial_period_days: 7,
                    metadata: {
                        plan_id,
                        user_id
                    }
                };

            } else if (type === 'tokens') {
                // Token purchase
                const packages = this.getTokenPackages();
                const tokenPackage = packages[plan_id];
                
                if (!tokenPackage) {
                    throw new Error('Invalid token package');
                }

                const price = this.convertPrice(tokenPackage.price_usd, currency);

                sessionData.line_items = [{
                    price_data: {
                        currency: currency.toLowerCase(),
                        product_data: {
                            name: tokenPackage.name,
                            description: `${tokenPackage.tokens + tokenPackage.bonus} prediction tokens for Trendgeist`,
                            images: ['https://qubit-gambit.github.io/trendgeist/assets/tokens-icon.png']
                        },
                        unit_amount: Math.round(price * 100) // Stripe expects cents
                    },
                    quantity: 1
                }];
            }

            const session = await this.stripe.checkout.sessions.create(sessionData);
            
            return {
                success: true,
                session_id: session.id,
                checkout_url: session.url,
                currency,
                amount: sessionData.line_items[0].price_data?.unit_amount || null
            };

        } catch (error) {
            console.error('Payment session creation error:', error);
            throw new Error(`Payment processing failed: ${error.message}`);
        }
    }

    // =============================================================================
    // WEBHOOK PROCESSING (Handle successful payments)
    // =============================================================================

    async handleWebhook(event) {
        try {
            // Check if payments are enabled
            if (!this.isEnabled) {
                console.warn('Webhook received but payments are disabled');
                return;
            }

            switch (event.type) {
                case 'checkout.session.completed':
                    await this.handleSuccessfulPayment(event.data.object);
                    break;
                    
                case 'invoice.payment_succeeded':
                    await this.handleSubscriptionPayment(event.data.object);
                    break;
                    
                case 'customer.subscription.deleted':
                    await this.handleSubscriptionCancellation(event.data.object);
                    break;
                    
                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }
        } catch (error) {
            console.error('Webhook processing error:', error);
            throw error;
        }
    }

    async handleSuccessfulPayment(session) {
        const { client_reference_id: userId, metadata } = session;
        const { type, plan_id } = metadata;

        if (type === 'tokens') {
            // Add tokens to user account
            await this.addTokensToUser(userId, plan_id);
        } else if (type === 'subscription') {
            // Activate subscription
            await this.activateSubscription(userId, plan_id, session.subscription);
        }

        // Log successful payment for analytics
        await this.logPayment({
            user_id: userId,
            session_id: session.id,
            amount: session.amount_total,
            currency: session.currency,
            type,
            plan_id,
            status: 'completed'
        });
    }

    // =============================================================================
    // CURRENCY CONVERSION (For Global Pricing)
    // =============================================================================

    convertPrice(usdPrice, targetCurrency) {
        // Simple conversion rates (in production, use live rates API)
        const rates = {
            'USD': 1.0,
            'EUR': 0.85,
            'GBP': 0.73,
            'CAD': 1.35,
            'AUD': 1.45,
            'JPY': 110.0,
            'SGD': 1.35,
            'AED': 3.67,
            'PKR': 280.0 // For local display only
        };

        return usdPrice * (rates[targetCurrency] || 1.0);
    }

    getUserCurrency(countryCode) {
        const currencyMap = {
            'US': 'USD', 'CA': 'CAD', 'GB': 'GBP', 'EU': 'EUR',
            'AU': 'AUD', 'JP': 'JPY', 'SG': 'SGD', 'AE': 'AED',
            'PK': 'USD', // Pakistanis often prefer USD pricing
            'IN': 'USD', 'BD': 'USD', 'LK': 'USD'
        };

        return currencyMap[countryCode] || 'USD';
    }

    // =============================================================================
    // USER ACCOUNT MANAGEMENT
    // =============================================================================

    async addTokensToUser(userId, packageId) {
        const packages = this.getTokenPackages();
        const tokenPackage = packages[packageId];
        
        if (!tokenPackage) return false;

        const totalTokens = tokenPackage.tokens + tokenPackage.bonus;

        // Update user's token balance in database
        const pool = require('../database/config');
        await pool.query(
            'UPDATE users SET prediction_tokens = prediction_tokens + $1, total_purchased = total_purchased + $2 WHERE id = $3',
            [totalTokens, tokenPackage.price_usd, userId]
        );

        return { tokens_added: totalTokens, new_balance: null };
    }

    async activateSubscription(userId, planId, stripeSubscriptionId) {
        const pool = require('../database/config');
        
        await pool.query(`
            UPDATE users 
            SET subscription_plan = $1, 
                subscription_status = 'active',
                stripe_subscription_id = $2,
                subscription_start = NOW(),
                subscription_end = NOW() + INTERVAL '1 month'
            WHERE id = $3
        `, [planId, stripeSubscriptionId, userId]);
    }

    async logPayment(paymentData) {
        const pool = require('../database/config');
        
        await pool.query(`
            INSERT INTO payments (user_id, session_id, amount, currency, type, plan_id, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [
            paymentData.user_id,
            paymentData.session_id, 
            paymentData.amount,
            paymentData.currency,
            paymentData.type,
            paymentData.plan_id,
            paymentData.status
        ]);
    }

    // =============================================================================
    // ANALYTICS & REPORTING (For Pakistani Business Insights)
    // =============================================================================

    async getPaymentAnalytics(userId = null) {
        const pool = require('../database/config');
        
        const whereClause = userId ? 'WHERE user_id = $1' : '';
        const params = userId ? [userId] : [];

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_payments,
                SUM(amount) as total_revenue_cents,
                AVG(amount) as avg_payment_cents,
                COUNT(DISTINCT user_id) as unique_customers,
                COUNT(CASE WHEN type = 'subscription' THEN 1 END) as subscriptions,
                COUNT(CASE WHEN type = 'tokens' THEN 1 END) as token_purchases,
                COUNT(CASE WHEN currency = 'USD' THEN 1 END) as usd_payments,
                DATE_TRUNC('month', created_at) as month
            FROM payments 
            ${whereClause}
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY month DESC
            LIMIT 12
        `, params);

        return result.rows.map(row => ({
            ...row,
            total_revenue_usd: (row.total_revenue_cents / 100).toFixed(2),
            avg_payment_usd: (row.avg_payment_cents / 100).toFixed(2)
        }));
    }

    // =============================================================================
    // PAKISTANI SETTLEMENT INFO
    // =============================================================================

    getPakistaniSettlementInfo() {
        return {
            supported_methods: [
                'Stripe (USD → Pakistani Bank)',
                'PayPal (USD → Jazz/Easy/Bank)',
                'Wise (Multi-currency → PKR)',
                'Payoneer (USD → Bank/Card)'
            ],
            settlement_time: '3-5 business days',
            fees: {
                stripe: '2.9% + $0.30 per transaction',
                conversion: '1-3% USD to PKR',
                withdrawal: '$1-5 bank transfer fee'
            },
            required_documents: [
                'CNIC/Passport',
                'Bank account details',
                'Business registration (if applicable)',
                'Tax registration'
            ],
            tax_obligations: {
                income_tax: 'Report USD income to FBR',
                withholding: 'May apply on foreign payments',
                consultant: 'Recommend chartered accountant'
            }
        };
    }
}

module.exports = new GlobalPaymentManager(); 