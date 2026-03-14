-- Thêm Categories mới
INSERT INTO categories (name, slug) VALUES 
('Áo Sơ Mi', 'ao-so-mi'),
('Quần Jean', 'quan-jean'),
('Váy & Đầm', 'vay-dam'),
('Phụ Kiện', 'phu-kien')
ON CONFLICT (slug) DO NOTHING;

-- Lấy IDs của categories vừa tạo (hoặc đã có)
-- Lưu ý: Trong script này mình sẽ hard-code slug cho chắc chắn khi INSERT products

-- Áo Sơ Mi
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'ao-so-mi'), 'Áo Sơ Mi Trắng Công Sở', 'ao-so-mi-trang-cong-so', 'Áo sơ mi trắng chất liệu cotton cao cấp, thoáng mát, phong cách lịch lãm.', 450000, true),
((SELECT id FROM categories WHERE slug = 'ao-so-mi'), 'Áo Sơ Mi Flannel Caro', 'ao-so-mi-flannel-caro', 'Áo sơ mi flannel họa tiết caro trẻ trung, phù hợp mặc khoác ngoài.', 380000, true)
ON CONFLICT (slug) DO NOTHING;

-- Quần Jean
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'quan-jean'), 'Quần Jean Slim Fit Xanh Đậm', 'quan-jean-slim-fit-xanh', 'Quần jean form slim fit tôn dáng, chất denim co giãn tốt.', 550000, true),
((SELECT id FROM categories WHERE slug = 'quan-jean'), 'Quần Jean Rách Gối Cá Tính', 'quan-jean-rach-goi', 'Quần jean rách gối phong cách bụi bặm, thời trang đường phố.', 620000, true)
ON CONFLICT (slug) DO NOTHING;

-- Váy & Đầm
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'vay-dam'), 'Đầm Dự Tiệc Trễ Vai', 'dam-du-tiec-tre-vai', 'Đầm dự tiệc thiết kế trễ vai sang trọng, quyến rũ cho phái đẹp.', 850000, true),
((SELECT id FROM categories WHERE slug = 'vay-dam'), 'Chân Váy Midi Xếp Ly', 'chan-vay-midi-xep-ly', 'Chân váy midi xếp ly nhẹ nhàng, dễ dàng phối hợp với nhiều kiểu áo.', 320000, true)
ON CONFLICT (slug) DO NOTHING;

-- Phụ Kiện
INSERT INTO products (category_id, name, slug, description, base_price, is_active) VALUES
((SELECT id FROM categories WHERE slug = 'phu-kien'), 'Thắt Lưng Da Cao Cấp', 'that-lung-da-cao-cap', 'Thắt lưng làm từ da thật, khóa kim loại không gỉ bền đẹp.', 250000, true),
((SELECT id FROM categories WHERE slug = 'phu-kien'), 'Mũ Lưỡi Trai Unisex', 'mu-luoi-trai-unisex', 'Mũ lưỡi trai phong cách năng động, bảo vệ bạn khỏi ánh nắng.', 150000, true)
ON CONFLICT (slug) DO NOTHING;

-- Thêm Ảnh cho tất cả sản phẩm mới (Dùng ảnh từ Unsplash)
INSERT INTO product_images (product_id, url, is_primary) VALUES
((SELECT id FROM products WHERE slug = 'ao-so-mi-trang-cong-so'), 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'ao-so-mi-flannel-caro'), 'https://images.unsplash.com/photo-1598033129183-c4f50c717658?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'quan-jean-slim-fit-xanh'), 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'quan-jean-rach-goi'), 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'dam-du-tiec-tre-vai'), 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'chan-vay-midi-xep-ly'), 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'that-lung-da-cao-cap'), 'https://images.unsplash.com/photo-1624222247344-550fb8ecf7c4?auto=format&fit=crop&w=800&q=80', true),
((SELECT id FROM products WHERE slug = 'mu-luoi-trai-unisex'), 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=800&q=80', true);

-- Thêm Variants (Kích thước và Màu sắc)
INSERT INTO product_variants (product_id, size_id, color_id, stock, price, sku)
SELECT 
  p.id, 
  s.id, 
  c.id, 
  50, 
  p.base_price,
  p.slug || '-' || s.name || '-' || c.name
FROM products p, sizes s, colors c
WHERE p.is_active = true 
  AND s.id IN (1, 2, 3) 
  AND c.id IN (1, 2)
  AND NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = p.id AND size_id = s.id AND color_id = c.id);
