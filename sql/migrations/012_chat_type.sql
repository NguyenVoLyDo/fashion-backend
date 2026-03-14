-- Add type to chat_conversations to distinguish between support and stylist bots
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'support';
UPDATE chat_conversations SET type = 'support' WHERE type IS NULL;
