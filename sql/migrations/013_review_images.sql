-- Migration: Add images column to reviews table
-- Author: Antigravity

ALTER TABLE reviews 
ADD COLUMN images JSONB DEFAULT '[]'::jsonb;

-- Indices for better performance if needed
CREATE INDEX idx_reviews_images ON reviews USING gin(images);
