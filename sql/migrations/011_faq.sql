CREATE TABLE faqs (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_faqs_category ON faqs(category);
CREATE INDEX idx_faqs_is_active ON faqs(is_active);

-- Seed data from knowledge base
INSERT INTO faqs (question, answer, category, sort_order) VALUES
('Tôi có thể đổi size sau khi đặt hàng không?', 'Bạn có thể đổi size miễn phí nếu đơn hàng chưa được xử lý (trạng thái "Chờ xác nhận"). Liên hệ ngay với CSKH để được hỗ trợ. Sau khi đơn đã giao, áp dụng chính sách đổi trả thông thường.', 'Đổi trả', 1),
('Size của shop có chuẩn không? Tôi nên chọn size nào?', 'Shop dùng size chuẩn Việt Nam. Tham khảo bảng size trên trang sản phẩm. Nếu bạn ở giữa 2 size, nên chọn size lớn hơn. CSKH luôn sẵn sàng tư vấn size cụ thể.', 'Sản phẩm', 2),
('Sản phẩm có đúng màu như ảnh không?', 'Màu sắc có thể chênh lệch nhẹ do ánh sáng chụp ảnh và màn hình hiển thị. Shop cố gắng chụp ảnh trung thực nhất. Nếu màu sắc sai lệch đáng kể so với ảnh, đây là lý do hợp lệ để đổi trả.', 'Sản phẩm', 3),
('Tôi quên mật khẩu, làm sao để lấy lại?', 'Hiện tại chưa có tính năng quên mật khẩu tự động. Vui lòng liên hệ CSKH qua chat để được hỗ trợ reset mật khẩu thủ công.', 'Tài khoản', 4),
('Tôi có thể mua hàng mà không cần tạo tài khoản không?', 'Hiện tại cần tạo tài khoản để đặt hàng. Đăng ký chỉ mất 1 phút và giúp bạn theo dõi đơn hàng dễ dàng hơn.', 'Tài khoản', 5),
('Điểm thưởng tích lũy như thế nào?', 'Mỗi 10.000₫ chi tiêu = 1 điểm thưởng. 1 điểm = 100₫ giảm giá cho đơn hàng tiếp theo. Điểm được cộng sau khi đơn hàng hoàn thành. Có 4 hạng thành viên: Đồng (0đ), Bạc (1.000đ), Vàng (5.000đ), Bạch Kim (20.000đ).', 'Thành viên', 6),
('Mã giảm giá có thể dùng kết hợp với điểm thưởng không?', 'Hiện tại chỉ được dùng 1 trong 2: hoặc mã giảm giá hoặc điểm thưởng cho mỗi đơn hàng.', 'Thanh toán', 7),
('Tôi đặt hàng rồi nhưng chưa nhận được email xác nhận?', 'Email xác nhận được gửi trong vòng 5 phút sau khi đặt hàng. Vui lòng kiểm tra hộp thư spam/junk. Nếu vẫn không thấy, liên hệ CSKH với mã đơn hàng để được hỗ trợ.', 'Đơn hàng', 8),
('Shop có giao hàng ra nước ngoài không?', 'Hiện tại chỉ giao hàng trong lãnh thổ Việt Nam.', 'Vận chuyển', 9),
('Tôi có thể theo dõi đơn hàng ở đâu?', 'Đăng nhập vào tài khoản → mục "Đơn hàng của tôi" để xem trạng thái real-time. Hoặc hỏi trực tiếp Support Bot với mã đơn hàng.', 'Đơn hàng', 10);
