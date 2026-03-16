-- Migration 016: Add feedback fields to conversation_context
ALTER TABLE conversation_context
ADD COLUMN IF NOT EXISTS disliked_product_ids INTEGER[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS disliked_reasons TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS liked_product_ids INTEGER[] DEFAULT '{}';
