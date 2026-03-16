-- Create user_style_preferences table
CREATE TABLE IF NOT EXISTS user_style_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(50) NOT NULL,
    value TEXT NOT NULL,
    confidence FLOAT DEFAULT 1.0,
    source VARCHAR(20) DEFAULT 'inferred', -- 'explicit' or 'inferred'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_style_prefs_user_id ON user_style_preferences(user_id);
