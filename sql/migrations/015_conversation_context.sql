-- Migration 015: Create conversation_context table
CREATE TABLE conversation_context (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER UNIQUE NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    gender VARCHAR(20), -- 'male' / 'female' / null
    occasion VARCHAR(50), -- 'work' / 'casual' / 'event' / 'sport' / null
    style VARCHAR(50), -- 'minimal' / 'elegant' / 'dynamic' / 'unique' / null
    max_price INTEGER,
    min_price INTEGER,
    excluded_product_ids INTEGER[] DEFAULT '{}',
    recipient VARCHAR(50), -- 'self' / 'girlfriend' / 'boyfriend' / 'other'
    target_gender VARCHAR(20), -- 'male' / 'female' / null
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by conversation_id (redundant due to UNIQUE but good practice)
CREATE INDEX idx_conversation_context_id ON conversation_context(conversation_id);
