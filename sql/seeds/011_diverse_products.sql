-- Add Categories if not exists
INSERT INTO categories (name, slug) VALUES 
('Áo Khoác', 'ao-khoac'),
('Giày Dép', 'giay-dep'),
('Thời Trang Nữ', 'thoi-trang-nu'),
('Thời Trang Nam', 'thoi-trang-nam')
ON CONFLICT (slug) DO NOTHING;

-- Diverse Products

-- 1. Young Female (Trendy/Bold)
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'thoi-trang-nu'), 'Áo Crop Top Baby Tee', 'ao-crop-top-baby-tee', 'Áo thun dáng ngắn baby tee cực trendy, họa tiết bắt mắt cho bạn nữ năng động.', 180000, true),
((SELECT id FROM categories WHERE slug = 'thoi-trang-nu'), 'Chân Váy Tennis Caro', 'chan-vay-tennis-caro', 'Chân váy tennis họa tiết caro trẻ trung, phong cách học đường.', 220000, true),
((SELECT id FROM categories WHERE slug = 'phu-kien'), 'Túi Kẹp Nách Y2K', 'tui-kep-nach-y2k', 'Túi xách kẹp nách phong cách Y2K đang cực hot, chất liệu da PU bóng.', 250000, true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Professional/Mature Female (Elegant/High-end)
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'thoi-trang-nu'), 'Áo Blazer Oversize Thanh Lịch', 'ao-blazer-oversize', 'Áo blazer form oversize, đường may chuẩn xác, cực kỳ phù hợp cho phong cách công sở hiện đại.', 650000, true),
((SELECT id FROM categories WHERE slug = 'thoi-trang-nu'), 'Sơ Mi Lụa Satin', 'so-mi-lua-satin', 'Sơ mi chất lụa satin mềm mại, óng ả, mang lại vẻ sang trọng cho phái đẹp.', 490000, true),
((SELECT id FROM categories WHERE slug = 'giay-dep'), 'Giày Cao Gót Mũi Nhọn 7cm', 'giay-cao-got-mui-nhon', 'Giày cao gót mũi nhọn sang trọng, đế chắc chắn, tôn dáng.', 550000, true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Young Male (Streetwear/Active)
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'ao-khoac'), 'Áo Hoodie Streetwear Đậm Chất', 'ao-hoodie-streetwear', 'Áo hoodie nỉ bông dày dặn, in hình graphic độc đáo, phong cách đường phố.', 450000, true),
((SELECT id FROM categories WHERE slug = 'quan-jean'), 'Quần Jogger Kaki Túi Hộp', 'quan-jogger-tui-hop', 'Quần jogger kaki túi hộp (cargo pants) cực ngầu cho các bạn nam.', 390000, true),
((SELECT id FROM categories WHERE slug = 'giay-dep'), 'Giày Sneaker Chunky Trắng', 'giay-sneaker-chunky', 'Giày sneaker đế thô (chunky) trẻ trung, dễ phối đồ.', 950000, true)
ON CONFLICT (slug) DO NOTHING;

-- 4. Mature Male (Classic/Professional)
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'thoi-trang-nam'), 'Áo Polo Cotton Basic', 'ao-polo-cotton-basic', 'Áo polo chất liệu cotton cá sấu, thấm hút mồ hôi, lịch sự nhưng vẫn thoải mái.', 320000, true),
((SELECT id FROM categories WHERE slug = 'thoi-trang-nam'), 'Quần Tây Âu Dáng Slim', 'quan-tay-au-slim', 'Quần tây chất vải không nhăn, form slim tôn dáng, phù hợp dự tiệc và đi làm.', 480000, true),
((SELECT id FROM categories WHERE slug = 'giay-dep'), 'Giày Da Oxford Classic', 'giay-da-oxford-classic', 'Giày da Oxford cổ điển, chất da bò thật, hoàn thiện tinh xảo.', 1250000, true)
ON CONFLICT (slug) DO NOTHING;

-- Images for new products
INSERT INTO product_images (product_id, url, is_primary) VALUES
((SELECT id FROM products WHERE slug = 'ao-crop-top-baby-tee'), 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'chan-vay-tennis-caro'), 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'tui-kep-nach-y2k'), 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'ao-blazer-oversize'), 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'so-mi-lua-satin'), 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'giay-cao-got-mui-nhon'), 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'ao-hoodie-streetwear'), 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'quan-jogger-tui-hop'), 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'giay-sneaker-chunky'), 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'ao-polo-cotton-basic'), 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'quan-tay-au-slim'), 'https://images.unsplash.com/photo-1594932224010-74f4109405f6?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'giay-da-oxford-classic'), 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?auto=format&fit=crop&w=800&q=80', true);

-- Variants (S-M-L / Trắng-Đen-Xám)
INSERT INTO product_variants (product_id, size_id, color_id, stock, price, sku)
SELECT 
  p.id, 
  s.id, 
  c.id, 
  100, 
  p.base_price,
  p.slug || '-' || s.name || '-' || c.name
FROM products p, sizes s, colors c
WHERE p.is_active = true 
  AND s.id IN (1, 2, 3) 
  AND c.id IN (1, 2, 3)
  EXCEPT 
  SELECT product_id, size_id, color_id, stock, price, sku FROM product_variants;
