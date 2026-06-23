-- =============================================================
-- SEED: Danh mục sản phẩm, content, source
-- Admin user ID: 80dad059-5ff4-427c-a899-ddd624191851
-- =============================================================

-- ---------------------------------------------------------------
-- 1. PRODUCT LINES (dòng sản phẩm)
-- ---------------------------------------------------------------
INSERT INTO product_lines (id, name, brand_type, video_category) VALUES
  (gen_random_uuid(), 'Traffic',    'DO_DA',    'TRAFFIC'),
  (gen_random_uuid(), 'GMV',        'DO_DA',    'GMV'),
  (gen_random_uuid(), 'Profit',     'DO_DA',    'PROFIT'),
  (gen_random_uuid(), 'Nhẫn',       'TRANG_SUC', 'GMV'),
  (gen_random_uuid(), 'Dây chuyền', 'TRANG_SUC', 'TRAFFIC'),
  (gen_random_uuid(), 'Vòng tay',   'TRANG_SUC', 'GMV'),
  (gen_random_uuid(), 'Bông tai',   'TRANG_SUC', 'PROFIT'),
  (gen_random_uuid(), 'Ví da',      'DO_DA',    'GMV'),
  (gen_random_uuid(), 'Thắt lưng',  'DO_DA',    'TRAFFIC'),
  (gen_random_uuid(), 'Túi xách',   'DO_DA',    'PROFIT')
ON CONFLICT (name, brand_type) DO NOTHING;

-- ---------------------------------------------------------------
-- 2. MATERIALS (chất liệu)
-- ---------------------------------------------------------------
INSERT INTO materials (id, name, brand_type) VALUES
  (gen_random_uuid(), 'Da bò thật',    'DO_DA'),
  (gen_random_uuid(), 'Da PU',         'DO_DA'),
  (gen_random_uuid(), 'Da canvas',     'DO_DA'),
  (gen_random_uuid(), 'Da cá sấu',     'DO_DA'),
  (gen_random_uuid(), 'Nylon cao cấp', 'DO_DA'),
  (gen_random_uuid(), 'Da microfiber', 'DO_DA'),
  (gen_random_uuid(), 'Bạc 925',       'TRANG_SUC'),
  (gen_random_uuid(), 'Vàng 18k',      'TRANG_SUC'),
  (gen_random_uuid(), 'Vàng 10k',      'TRANG_SUC'),
  (gen_random_uuid(), 'Đá CZ',         'TRANG_SUC'),
  (gen_random_uuid(), 'Đá Moissanite', 'TRANG_SUC')
ON CONFLICT (name, brand_type) DO NOTHING;

-- ---------------------------------------------------------------
-- 3. PRODUCTS (~12 sản phẩm)
-- ---------------------------------------------------------------
-- TRANG_SUC products
INSERT INTO products (id, sku, name, brand_type, price, market, price_segment, priority_score, material_id, product_line_id, added_by_id, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'TS-NH-001', 'Nhẫn bạc thái hoa mai nữ',
   'TRANG_SUC', 185000, 'VIETNAM', 'Thấp', 80,
   (SELECT id FROM materials WHERE name = 'Bạc thái' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Nhẫn' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-NH-002', 'Nhẫn bạc 925 đính CZ hình tim',
   'TRANG_SUC', 250000, 'VIETNAM', 'Trung', 75,
   (SELECT id FROM materials WHERE name = 'Bạc 925' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Nhẫn' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-NH-003', 'Nhẫn vàng 10k nhẵn trơn unisex',
   'TRANG_SUC', 750000, 'VIETNAM', 'Cao', 60,
   (SELECT id FROM materials WHERE name = 'Vàng 10k' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Nhẫn' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-DC-001', 'Dây chuyền bạc nữ mặt tròn trơn',
   'TRANG_SUC', 220000, 'VIETNAM', 'Thấp', 85,
   (SELECT id FROM materials WHERE name = 'Bạc nữ' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Dây chuyền' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-DC-002', 'Dây chuyền vàng 10k mặt hoa mai',
   'TRANG_SUC', 980000, 'VIETNAM', 'Cao', 55,
   (SELECT id FROM materials WHERE name = 'Vàng 10k' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Dây chuyền' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-VT-001', 'Vòng tay bạc thái trơn unisex',
   'TRANG_SUC', 165000, 'VIETNAM', 'Thấp', 70,
   (SELECT id FROM materials WHERE name = 'Bạc thái' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Vòng tay' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-VT-002', 'Vòng tay đá Moissanite bạc 925',
   'TRANG_SUC', 450000, 'VIETNAM', 'Trung', 65,
   (SELECT id FROM materials WHERE name = 'Đá Moissanite' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Vòng tay' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TS-BT-001', 'Bông tai bạc đính đá CZ giọt nước',
   'TRANG_SUC', 195000, 'VIETNAM', 'Thấp', 72,
   (SELECT id FROM materials WHERE name = 'Đá CZ' AND brand_type = 'TRANG_SUC' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Bông tai' AND brand_type = 'TRANG_SUC' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW())

ON CONFLICT (sku) DO NOTHING;

-- DO_DA products
INSERT INTO products (id, sku, name, brand_type, price, market, price_segment, priority_score, material_id, product_line_id, added_by_id, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'DD-VI-001', 'Ví da bò nam ngắn gập đôi',
   'DO_DA', 350000, 'VIETNAM', 'Trung', 88,
   (SELECT id FROM materials WHERE name = 'Da bò thật' AND brand_type = 'DO_DA' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Ví da' AND brand_type = 'DO_DA' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DD-VI-002', 'Ví da PU nữ mini nhiều ngăn',
   'DO_DA', 180000, 'VIETNAM', 'Thấp', 82,
   (SELECT id FROM materials WHERE name = 'Da PU' AND brand_type = 'DO_DA' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Ví da' AND brand_type = 'DO_DA' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DD-TL-001', 'Thắt lưng da cá sấu khóa kim loại',
   'DO_DA', 520000, 'VIETNAM', 'Cao', 55,
   (SELECT id FROM materials WHERE name = 'Da cá sấu' AND brand_type = 'DO_DA' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Thắt lưng' AND brand_type = 'DO_DA' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DD-TL-002', 'Thắt lưng da bò unisex classic',
   'DO_DA', 320000, 'VIETNAM', 'Trung', 78,
   (SELECT id FROM materials WHERE name = 'Da bò thật' AND brand_type = 'DO_DA' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Thắt lưng' AND brand_type = 'DO_DA' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DD-TX-001', 'Túi da canvas đeo chéo mini',
   'DO_DA', 420000, 'VIETNAM', 'Trung', 68,
   (SELECT id FROM materials WHERE name = 'Da canvas' AND brand_type = 'DO_DA' LIMIT 1),
   (SELECT id FROM product_lines WHERE name = 'Túi xách' AND brand_type = 'DO_DA' LIMIT 1),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW())

ON CONFLICT (sku) DO NOTHING;

-- ---------------------------------------------------------------
-- 4. CONTENTS (~12 kịch bản video)
-- ---------------------------------------------------------------
INSERT INTO contents (id, brand_type, market, title, body, script, content_line_id, status, view_count, added_by_id, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'TRANG_SUC', 'VIETNAM',
   'Review nhẫn bạc thái hoa mai – đẹp giá rẻ',
   'Video review chi tiết nhẫn bạc thái hình hoa mai, phù hợp quà tặng ngày lễ.',
   'Hook 3s: [Cầm nhẫn sáng dưới đèn] "Chỉ 185k mà đẹp đến vậy?" | Giới thiệu: chất liệu bạc thái, thiết kế hoa mai | CTA: Link bio',
   (SELECT id FROM content_lines WHERE name = 'A1' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'VIETNAM',
   'So sánh bạc 925 vs bạc thái – nên chọn loại nào?',
   'Phân tích ưu nhược điểm 2 dòng bạc phổ biến nhất hiện nay.',
   'Hook: "Bạc 925 hay bạc thái? Đừng mua nhầm!" | Demo: đeo thử cả 2 | Kết: recommend theo ngân sách',
   (SELECT id FROM content_lines WHERE name = 'A2' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'VIETNAM',
   'Thử thách: đeo bạc thật 30 ngày – kết quả bất ngờ',
   'Trend thử thách đeo trang sức liên tục 30 ngày và ghi nhận kết quả.',
   'Hook: "30 ngày đeo không tháo, bạc có đen không?" | Timeline 7-15-30 ngày | Verdict: tips bảo quản',
   (SELECT id FROM content_lines WHERE name = 'A3' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'VIETNAM',
   'Unboxing dây chuyền vàng 10k mặt hoa – quà tặng ý nghĩa',
   'Mở hộp và đánh giá dây chuyền vàng 10k phù hợp làm quà tặng sinh nhật.',
   'Hook: [Hộp quà sang trọng] | Unboxing từng lớp | Review: chất lượng, độ sáng, trọng lượng | CTA',
   (SELECT id FROM content_lines WHERE name = 'A1' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'VIETNAM',
   'Top 5 món trang sức làm quà Valentine dưới 500k',
   'Gợi ý 5 món trang sức bạc ý nghĩa làm quà Valentine cho người yêu.',
   'Hook: "Valentine này tặng gì cho bạn gái?" | List 5 sản phẩm kèm giá | CTA: order sớm kẻo hết',
   (SELECT id FROM content_lines WHERE name = 'A2' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'VIETNAM',
   'ASMR giới thiệu vòng tay đá Moissanite – sang không cần hàng hiệu',
   'Video ASMR thư giãn giới thiệu vòng tay đá Moissanite cao cấp.',
   'Không lời | Tiếng đặt vòng lên mặt gương | Cận cảnh sparkle đá | Text overlay: thông số kỹ thuật',
   (SELECT id FROM content_lines WHERE name = 'A5' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'VIETNAM',
   'Cách chọn ví da nam chất lượng – 5 điều cần biết',
   'Hướng dẫn chi tiết cách nhận biết và chọn mua ví da nam thật chất lượng.',
   'Hook: "Mua ví da mà không biết 5 điều này là phí tiền" | Tips: ngửi mùi, kiểm tra đường may, logo | Demo sản phẩm',
   (SELECT id FROM content_lines WHERE name = 'A2' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'VIETNAM',
   'Behind the scene: xem thợ làm ví da bò thủ công',
   'Video hậu trường quá trình sản xuất ví da bò thủ công tại xưởng.',
   'Hook: ASMR tiếng cắt da | Timeline: chọn da → cắt → may → hoàn thiện | Proud moment: sản phẩm hoàn chỉnh',
   (SELECT id FROM content_lines WHERE name = 'A3' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'VIETNAM',
   'Review thắt lưng da cá sấu – có xứng đáng với giá 520k?',
   'Đánh giá thực tế thắt lưng da cá sấu sau 2 tuần sử dụng hàng ngày.',
   'Hook: "520k cho thắt lưng da cá sấu – có đáng không?" | Test: độ bền, màu sắc, khoá | Verdict',
   (SELECT id FROM content_lines WHERE name = 'A4' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'VIETNAM',
   'Túi canvas da mini – item hot nhất street style 2024',
   'Review túi đeo chéo da canvas đang được giới trẻ yêu thích nhất hiện nay.',
   'Hook: [Show street style] | Feature: size, ngăn, quai | OOTD combo 3 outfit | CTA',
   (SELECT id FROM content_lines WHERE name = 'A1' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'VIETNAM',
   'ASMR đập hộp ví da bò mới – texture cực đỉnh',
   'ASMR mở hộp và cảm nhận chất liệu da bò cao cấp trong bộ sưu tập mới.',
   'Không lời | Tiếng mở hộp, lật trang da | Cận cảnh texture da | Slow motion gấp/mở ví',
   (SELECT id FROM content_lines WHERE name = 'A5' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'VIETNAM',
   'Ví da hay ví vải – cái nào bền hơn sau 1 năm dùng?',
   'So sánh độ bền thực tế giữa ví da bò và ví vải canvas sau 1 năm sử dụng.',
   'Hook: "1 năm sau tôi ngạc nhiên về kết quả này" | Show 2 ví cũ | Analysis: mòn, màu, form | Kết luận',
   (SELECT id FROM content_lines WHERE name = 'A4' LIMIT 1),
   'AVAILABLE', 0, '80dad059-5ff4-427c-a899-ddd624191851', NOW(), NOW());

-- ---------------------------------------------------------------
-- 5. SOURCES (~12 nguồn video)
-- ---------------------------------------------------------------
INSERT INTO sources (id, brand_type, type, name, link, code, product_id, added_by_id, is_active, created_at, updated_at)
VALUES
  -- PRODUCT_STOCK
  (gen_random_uuid(), 'TRANG_SUC', 'PRODUCT_STOCK',
   'Video kho nhẫn bạc thái – góc studio ring light',
   'https://drive.google.com/file/d/stock_nhan_bac_thai_001', 'SRC-TS-001',
   (SELECT id FROM products WHERE sku = 'TS-NH-001'),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'PRODUCT_STOCK',
   'Clip macro dây chuyền vàng 10k – ánh sáng ring light',
   'https://drive.google.com/file/d/stock_dc_vang_10k_002', 'SRC-TS-002',
   (SELECT id FROM products WHERE sku = 'TS-DC-002'),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'PRODUCT_STOCK',
   'Video kho vòng tay Moissanite – full angles 4K',
   'https://drive.google.com/file/d/stock_vong_tay_moiss_001', 'SRC-TS-003',
   (SELECT id FROM products WHERE sku = 'TS-VT-002'),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'PRODUCT_STOCK',
   'Video kho ví da bò nam – full angles B-roll',
   'https://drive.google.com/file/d/stock_vi_da_bo_001', 'SRC-DD-001',
   (SELECT id FROM products WHERE sku = 'DD-VI-001'),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'PRODUCT_STOCK',
   'Clip 4K thắt lưng da cá sấu – texture detail close-up',
   'https://drive.google.com/file/d/stock_that_lung_ca_sau_001', 'SRC-DD-002',
   (SELECT id FROM products WHERE sku = 'DD-TL-001'),
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  -- COLLECTED
  (gen_random_uuid(), 'TRANG_SUC', 'COLLECTED',
   'TikTok viral – review trang sức handmade 2M views',
   'https://www.tiktok.com/@creator123/video/trang_suc_viral', 'SRC-COL-001',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'COLLECTED',
   'Pinterest inspo – trang sức minimalist trend 2024',
   'https://www.pinterest.com/pin/minimalist_jewelry_inspo', 'SRC-COL-002',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'COLLECTED',
   'Facebook viral – review ví da hàng Việt 500k views',
   'https://www.facebook.com/reel/da_viet_viral_review', 'SRC-COL-003',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'COLLECTED',
   'YouTube – luxury leather goods unboxing compilation',
   'https://www.youtube.com/watch?v=leather_unboxing_comp', 'SRC-COL-004',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  -- OUTRO
  (gen_random_uuid(), 'TRANG_SUC', 'OUTRO',
   'Outro chính thức TRANG SỨC – logo animation 5s',
   'https://drive.google.com/file/d/outro_trang_suc_logo_5s', 'SRC-OUT-001',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'OUTRO',
   'Outro chính thức ĐỒ DA – logo animation 5s',
   'https://drive.google.com/file/d/outro_do_da_logo_5s', 'SRC-OUT-002',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'TRANG_SUC', 'OUTRO',
   'Outro CTA "Link bio để đặt hàng" – TRANG SỨC phiên bản 2',
   'https://drive.google.com/file/d/outro_cta_link_bio_ts_v2', 'SRC-OUT-003',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  -- WORKSHOP
  (gen_random_uuid(), 'TRANG_SUC', 'WORKSHOP',
   'Behind the scene – xưởng mạ bạc tại Hà Nội',
   'https://drive.google.com/file/d/workshop_xuong_ma_bac_hn', 'SRC-WS-001',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW()),

  (gen_random_uuid(), 'DO_DA', 'WORKSHOP',
   'Hậu trường xưởng làm đồ da thủ công – timelapse 4K',
   'https://drive.google.com/file/d/workshop_xuong_do_da_tl_4k', 'SRC-WS-002',
   NULL,
   '80dad059-5ff4-427c-a899-ddd624191851', true, NOW(), NOW());
