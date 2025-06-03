-- =============================================================================
-- TRENDGEIST PAYMENTS DATABASE SCHEMA
-- Supports global payments with Pakistani settlement
-- =============================================================================

-- Add payment-related columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_start TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS prediction_tokens INTEGER DEFAULT 1000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_purchased DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_preference VARCHAR(3) DEFAULT 'USD';

-- Payments table - tracks all transactions
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(100) UNIQUE,
    stripe_payment_intent_id VARCHAR(100),
    amount INTEGER NOT NULL, -- Amount in cents
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(20) NOT NULL, -- 'subscription', 'tokens'
    plan_id VARCHAR(50), -- subscription plan or token package ID
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'refunded'
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Subscription history table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(100) UNIQUE,
    plan_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'active', 'canceled', 'past_due', 'unpaid'
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    canceled_at TIMESTAMP,
    trial_start TIMESTAMP,
    trial_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Token transactions table
CREATE TABLE IF NOT EXISTS token_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- 'purchase', 'spend', 'bonus', 'refund'
    amount INTEGER NOT NULL, -- Positive for credit, negative for debit
    description TEXT,
    payment_id UUID REFERENCES payments(id),
    prediction_id UUID, -- Reference to prediction if spending tokens
    balance_after INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Payment methods table (for saved cards, etc.)
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_method_id VARCHAR(100) UNIQUE,
    type VARCHAR(20) DEFAULT 'card',
    card_brand VARCHAR(20),
    card_last4 VARCHAR(4),
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Revenue analytics table (for Pakistani business insights)
CREATE TABLE IF NOT EXISTS revenue_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE,
    total_revenue_cents INTEGER DEFAULT 0,
    subscription_revenue_cents INTEGER DEFAULT 0,
    token_revenue_cents INTEGER DEFAULT 0,
    total_customers INTEGER DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    active_subscriptions INTEGER DEFAULT 0,
    currency_breakdown JSONB, -- {USD: 1000, EUR: 500, etc}
    country_breakdown JSONB, -- Revenue by country
    created_at TIMESTAMP DEFAULT NOW()
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_token_transactions_user_id ON token_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_type ON token_transactions(type);
CREATE INDEX IF NOT EXISTS idx_token_transactions_created_at ON token_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_default ON payment_methods(is_default);

CREATE INDEX IF NOT EXISTS idx_revenue_analytics_date ON revenue_analytics(date);

-- =============================================================================
-- FUNCTIONS FOR TOKEN MANAGEMENT
-- =============================================================================

-- Function to add tokens to user balance
CREATE OR REPLACE FUNCTION add_tokens_to_user(
    p_user_id UUID,
    p_amount INTEGER,
    p_description TEXT DEFAULT 'Token purchase',
    p_payment_id UUID DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_new_balance INTEGER;
BEGIN
    -- Update user's token balance
    UPDATE users 
    SET prediction_tokens = prediction_tokens + p_amount
    WHERE id = p_user_id
    RETURNING prediction_tokens INTO v_new_balance;
    
    -- Record transaction
    INSERT INTO token_transactions (
        user_id, type, amount, description, payment_id, balance_after
    ) VALUES (
        p_user_id, 'purchase', p_amount, p_description, p_payment_id, v_new_balance
    );
    
    RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;

-- Function to spend tokens
CREATE OR REPLACE FUNCTION spend_tokens(
    p_user_id UUID,
    p_amount INTEGER,
    p_description TEXT DEFAULT 'Prediction bet',
    p_prediction_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Check current balance
    SELECT prediction_tokens INTO v_current_balance
    FROM users WHERE id = p_user_id;
    
    -- Check if user has enough tokens
    IF v_current_balance < p_amount THEN
        RETURN FALSE;
    END IF;
    
    -- Deduct tokens
    UPDATE users 
    SET prediction_tokens = prediction_tokens - p_amount
    WHERE id = p_user_id
    RETURNING prediction_tokens INTO v_new_balance;
    
    -- Record transaction
    INSERT INTO token_transactions (
        user_id, type, amount, description, prediction_id, balance_after
    ) VALUES (
        p_user_id, 'spend', -p_amount, p_description, p_prediction_id, v_new_balance
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS FOR ANALYTICS
-- =============================================================================

-- Monthly revenue view
CREATE OR REPLACE VIEW monthly_revenue AS
SELECT 
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS total_payments,
    SUM(amount) AS total_revenue_cents,
    SUM(amount) / 100.0 AS total_revenue_usd,
    AVG(amount) AS avg_payment_cents,
    COUNT(DISTINCT user_id) AS unique_customers,
    COUNT(CASE WHEN type = 'subscription' THEN 1 END) AS subscription_payments,
    COUNT(CASE WHEN type = 'tokens' THEN 1 END) AS token_payments
FROM payments 
WHERE status = 'completed'
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- User subscription summary view
CREATE OR REPLACE VIEW user_subscriptions AS
SELECT 
    u.id,
    u.username,
    u.email,
    u.subscription_plan,
    u.subscription_status,
    u.subscription_start,
    u.subscription_end,
    u.prediction_tokens,
    u.total_purchased,
    s.current_period_start,
    s.current_period_end,
    CASE 
        WHEN u.subscription_end > NOW() THEN 'active'
        WHEN u.subscription_end <= NOW() THEN 'expired'
        ELSE 'inactive'
    END AS computed_status
FROM users u
LEFT JOIN subscriptions s ON u.stripe_subscription_id = s.stripe_subscription_id;

-- =============================================================================
-- SAMPLE DATA FOR TESTING
-- =============================================================================

-- Insert sample revenue data for demo
INSERT INTO revenue_analytics (date, total_revenue_cents, subscription_revenue_cents, token_revenue_cents, total_customers, new_customers, active_subscriptions, currency_breakdown, country_breakdown)
VALUES 
    (CURRENT_DATE - INTERVAL '30 days', 5999, 2999, 3000, 15, 8, 3, '{"USD": 4999, "EUR": 1000}', '{"US": 3000, "CA": 1000, "GB": 999, "PK": 1000}'),
    (CURRENT_DATE - INTERVAL '29 days', 7899, 5999, 1900, 18, 3, 5, '{"USD": 6899, "EUR": 1000}', '{"US": 4000, "CA": 1500, "GB": 1399, "PK": 1000}'),
    (CURRENT_DATE - INTERVAL '28 days', 12450, 8999, 3451, 22, 4, 7, '{"USD": 10450, "EUR": 2000}', '{"US": 6000, "CA": 2000, "GB": 2450, "PK": 2000}');

-- =============================================================================
-- PAKISTANI COMPLIANCE NOTES
-- =============================================================================

/*
IMPORTANT FOR PAKISTANI BUSINESSES:

1. FOREIGN EXCHANGE COMPLIANCE:
   - Report all USD receipts to State Bank of Pakistan
   - Maintain records of all international transactions
   - Consider RERA (Roshan Digital Account) for easier compliance

2. TAX OBLIGATIONS:
   - Income tax on foreign earnings (varies by bracket)
   - Potential withholding tax on foreign payments
   - GST may apply on digital services (currently 16%)
   - Consult CA for proper tax planning

3. BANK REQUIREMENTS:
   - USD account for foreign receipts
   - Proper documentation for large transfers
   - Consider multiple banks for better rates

4. REPORTING:
   - Monthly foreign exchange reporting if > $10,000
   - Annual tax returns with foreign income disclosure
   - Keep detailed transaction records

5. RECOMMENDED SETUP:
   - Stripe Atlas for US LLC (easier global payments)
   - Pakistani bank account for USD settlement
   - Local accounting software integration
   - Regular consultation with Pakistani tax advisor
*/ 