-- =====================================================================
--  DESIGN COPYCAT AI — SƠ ĐỒ CƠ SỞ DỮ LIỆU (MySQL 8 / MariaDB 10.4+)
--  Server tự chạy file này khi khởi động nếu DB_AUTO_MIGRATE=true.
--  Mọi câu lệnh đều idempotent (IF NOT EXISTS) nên chạy lại vô hại.
--
--  ĐƠN VỊ TIỀN: **USD CENTS**, lưu dạng số nguyên (BIGINT). $49.99 = 4999.
--  Mọi cột tiền đều mang hậu tố `_usd_cents`. Không bao giờ lưu số thực —
--  Stripe cũng nhận `unit_amount` bằng cent nên hai bên khớp nhau tuyệt đối,
--  và cộng trừ số nguyên thì không có sai số làm tròn tích luỹ trong sổ cái.
--
--  LƯU Ý VỀ TÊN GỌI: đơn vị tiêu dùng của khách nay gọi là ĐIỂM trên toàn bộ
--  giao diện, nhưng tên cột và tên bảng vẫn giữ tiền tố `token_`
--  (users.token_balance, generations.token_cost, bảng token_transactions,
--  token_packages...). Giữ nguyên là có chủ đích: đổi tên cột trên cơ sở dữ liệu
--  đang chạy thật đòi hỏi dừng dịch vụ và sửa đồng loạt cả server, trong khi
--  khách không bao giờ nhìn thấy tên cột. Đọc `token_*` = "điểm".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. KHÁCH HÀNG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email           VARCHAR(190)    NOT NULL,
  password_hash   VARCHAR(255)    NOT NULL,
  full_name       VARCHAR(190)    NULL,
  phone           VARCHAR(32)     NULL,
  role            ENUM('user','admin') NOT NULL DEFAULT 'user',
  status          ENUM('active','banned') NOT NULL DEFAULT 'active',

  -- --- Tiếp thị liên kết (affiliate) ---
  -- Vai trò affiliate là một CỜ RIÊNG chứ không phải một giá trị của cột `role`:
  -- `role` được đồng bộ lại từ ADMIN_EMAILS mỗi lần đọc phiên đăng nhập (xem
  -- lib/auth.ts), nên nhét 'affiliate' vào đó sẽ bị ghi đè ngay. Tách ra còn cho
  -- phép một admin đồng thời là affiliate.
  is_affiliate    TINYINT(1)      NOT NULL DEFAULT 0,
  -- Mã trong link giới thiệu (…/?ref=MÃ). Sinh khi admin cấp quyền, giữ nguyên
  -- kể cả khi bị thu hồi rồi cấp lại — link đã phát ra ngoài vẫn phải sống.
  affiliate_code  VARCHAR(32)     NULL,
  -- Người giới thiệu ra tài khoản này. Gán MỘT LẦN lúc đăng ký và không bao giờ
  -- đổi: đổi về sau là chuyển hoa hồng của người này sang người khác.
  referred_by     BIGINT UNSIGNED NULL,
  referred_at     DATETIME        NULL,
  -- Token MUA THÊM (gói lẻ). Không hết hạn, chỉ dùng khi hạn mức tháng đã cạn.
  token_balance   INT             NOT NULL DEFAULT 0,

  -- --- Thuê bao tháng (ghi đè phẳng vào đây để thao tác trừ token chỉ khoá 1 dòng) ---
  subscription_expires_at DATETIME NULL,
  -- Hạn mức token được cấp mỗi tháng theo gói đang dùng
  monthly_allowance   INT         NOT NULL DEFAULT 0,
  -- Hạn mức còn lại của chu kỳ tháng hiện tại. KHÔNG cộng dồn sang tháng sau.
  monthly_tokens      INT         NOT NULL DEFAULT 0,
  -- Thời điểm kết thúc chu kỳ tháng hiện tại; qua mốc này hạn mức được cấp lại.
  monthly_period_end  DATETIME    NULL,

  -- Số liệu tích luỹ, phục vụ báo cáo nhanh không phải quét bảng ledger.
  total_topup_usd_cents BIGINT    NOT NULL DEFAULT 0,
  total_tokens_in INT             NOT NULL DEFAULT 0,
  total_tokens_out INT            NOT NULL DEFAULT 0,
  last_login_at   DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_affiliate_code (affiliate_code),
  KEY idx_users_referred_by (referred_by),
  KEY idx_users_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 1b. GÓI THUÊ BAO THÁNG
--     Khách bắt buộc mua gói này trước khi được tạo ảnh. Giá gói đã gồm chi phí
--     duy trì, nhân sự và một hạn mức token dùng trong tháng.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(50)  NOT NULL,           -- vd: MONTHLY_1, MONTHLY_12
  name          VARCHAR(120) NOT NULL,
  months        INT          NOT NULL,           -- chu kỳ: 1, 3, 6, 12
  price_usd_cents BIGINT     NOT NULL,           -- tổng tiền cho cả chu kỳ (cent)
  -- Hạn mức token cấp lại MỖI THÁNG (không cộng dồn sang tháng sau)
  monthly_token_allowance INT NOT NULL,
  description   VARCHAR(255) NULL,
  is_popular    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 1c. THUÊ BAO ĐÃ MUA — lịch sử, dùng để đối soát và gia hạn
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  plan_id       INT UNSIGNED    NULL,
  -- Snapshot thông tin gói lúc mua, để đổi bảng giá không làm sai lịch sử
  plan_code     VARCHAR(50)     NULL,
  plan_name     VARCHAR(120)    NOT NULL,
  months        INT             NOT NULL,
  price_usd_cents BIGINT        NOT NULL,
  monthly_token_allowance INT   NOT NULL,
  status        ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  order_id      BIGINT UNSIGNED NULL,
  started_at    DATETIME        NOT NULL,
  expires_at    DATETIME        NOT NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subs_user (user_id, created_at),
  KEY idx_subs_status (status, expires_at),
  CONSTRAINT fk_subs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. GÓI TOKEN LẺ  (mua thêm khi đã dùng hết hạn mức tháng)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token_packages (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(50)  NOT NULL,          -- vd: STARTER, CREATOR
  name          VARCHAR(120) NOT NULL,          -- vd: Starter
  price_usd_cents BIGINT     NOT NULL,          -- giá bán, tính bằng cent
  base_tokens   INT          NOT NULL,          -- điểm cơ bản
  bonus_tokens  INT          NOT NULL DEFAULT 0,-- token thưởng thêm
  description   VARCHAR(255) NULL,
  is_popular    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_packages_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. BẢNG GIÁ MODEL  (ảnh 1 = giá vốn, ảnh 2 = số token thu của khách)
--    Thêm nhà cung cấp / model mới trong tương lai = thêm 1 dòng ở đây.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_pricing (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(80)  NOT NULL,   -- khoá nội bộ, vd: nano-banana-pro-4k
  provider       VARCHAR(50)  NOT NULL DEFAULT 'kie',   -- adapter xử lý, vd: kie
  provider_model VARCHAR(120) NOT NULL,   -- slug gửi lên API bên thứ 3, vd: nano-banana-pro
  label          VARCHAR(120) NOT NULL,   -- tên hiển thị cho khách
  family         VARCHAR(80)  NOT NULL,   -- nhóm model, vd: nano-banana-pro
  resolution     VARCHAR(16)  NOT NULL,   -- 1K / 2K / 4K
  api_cost_usd   DECIMAL(10,4) NOT NULL,  -- giá vốn/ảnh theo bảng giá nhà cung cấp
  token_cost     INT          NOT NULL,   -- số token trừ của khách mỗi ảnh
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  -- Model làm mốc quy "số điểm" ra "số ảnh" trên thẻ gói điểm (trang giới thiệu
  -- và trang Mua điểm). Chỉ MỘT dòng được bật; admin đổi ở tab Bảng giá.
  is_estimate_reference TINYINT(1) NOT NULL DEFAULT 0,
  sort_order     INT          NOT NULL DEFAULT 0,
  notes          VARCHAR(255) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pricing_code (code),
  KEY idx_pricing_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. ĐƠN NẠP TIỀN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(32)     NOT NULL,   -- mã ghi trong nội dung chuyển khoản, vd: NAP7K3Q2M
  user_id         BIGINT UNSIGNED NOT NULL,
  -- subscription = mua/gia hạn gói tháng | token_package = mua thêm token lẻ
  order_type      ENUM('subscription','token_package') NOT NULL DEFAULT 'token_package',
  plan_id         INT UNSIGNED    NULL,
  subscription_months INT         NULL,
  package_id      INT UNSIGNED    NULL,
  -- Snapshot thông tin gói tại thời điểm đặt, để đổi bảng giá không làm sai lịch sử.
  package_code    VARCHAR(50)     NULL,
  package_name    VARCHAR(120)    NOT NULL,
  amount_usd_cents BIGINT         NOT NULL,   -- số tiền khách phải trả (cent)
  -- Nâng gói: số tiền được khấu trừ từ phần chưa dùng của gói cũ.
  -- Giá niêm yết của gói mới = amount_usd_cents + credit_usd_cents.
  credit_usd_cents BIGINT         NOT NULL DEFAULT 0,
  is_upgrade      TINYINT(1)      NOT NULL DEFAULT 0,
  base_tokens     INT             NOT NULL,
  bonus_tokens    INT             NOT NULL DEFAULT 0,
  total_tokens    INT             NOT NULL,
  status          ENUM('pending','paid','cancelled','expired') NOT NULL DEFAULT 'pending',
  payment_method  VARCHAR(40)     NOT NULL DEFAULT 'stripe',
  -- Phiên Stripe Checkout đang gắn với đơn này. Lưu lại để (1) khách quay lại
  -- trang đơn thì mở đúng phiên cũ thay vì tạo phiên mới, và (2) server hỏi
  -- thẳng Stripe được trạng thái đơn khi webhook tới muộn hoặc chưa cấu hình.
  stripe_session_id  VARCHAR(190) NULL,
  stripe_payment_intent VARCHAR(190) NULL,
  -- Nguồn xác nhận: stripe / manual / external
  paid_source     VARCHAR(40)     NULL,
  payment_ref     VARCHAR(190)    NULL,       -- mã giao dịch phía cổng thanh toán
  paid_amount_usd_cents BIGINT    NULL,       -- số tiền thực nhận (cent)
  paid_at         DATETIME        NULL,
  -- Thời điểm đã GIAO HÀNG (cộng token / kích hoạt gói). Tách khỏi `status` để hệ
  -- thống ngoài chỉ cần đổi status = 'paid', server tự phát hiện và xử lý phần còn
  -- lại. NULL + status='paid' = đơn đang chờ giao hàng.
  fulfilled_at    DATETIME        NULL,
  approved_by     BIGINT UNSIGNED NULL,       -- admin duyệt tay
  note            VARCHAR(500)    NULL,
  expires_at      DATETIME        NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_code (code),
  KEY idx_orders_user (user_id, created_at),
  KEY idx_orders_status (status, created_at),
  KEY idx_orders_stripe_session (stripe_session_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. SỔ CÁI TOKEN — mọi biến động số dư đều phải có 1 dòng ở đây
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token_transactions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  -- topup: mua token lẻ | spend: tạo ảnh | refund: hoàn khi lỗi | adjust: admin sửa tay
  -- grant: cấp hạn mức đầu chu kỳ tháng | expire: xoá hạn mức thừa khi sang tháng mới
  type          ENUM('topup','spend','refund','adjust','grant','expire') NOT NULL,
  -- monthly: hạn mức tháng (reset, không cộng dồn) | purchased: token mua thêm (không hết hạn)
  bucket        ENUM('monthly','purchased') NOT NULL DEFAULT 'purchased',
  amount        INT             NOT NULL,   -- dương = cộng, âm = trừ
  balance_after INT             NOT NULL,   -- số dư của đúng nguồn ở cột bucket
  ref_type      VARCHAR(40)     NULL,       -- 'order' | 'generation' | NULL
  ref_id        BIGINT UNSIGNED NULL,
  description   VARCHAR(255)    NULL,
  created_by    BIGINT UNSIGNED NULL,       -- admin thực hiện (nếu là adjust)
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tx_user (user_id, created_at),
  KEY idx_tx_type (type, created_at),
  KEY idx_tx_ref (ref_type, ref_id),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. LỆNH TẠO ẢNH
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generations (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  batch_id         VARCHAR(40)     NULL,     -- gom nhiều ảnh của cùng 1 lần bấm nút
  model_code       VARCHAR(80)     NOT NULL,
  model_label      VARCHAR(120)    NOT NULL,
  provider         VARCHAR(50)     NOT NULL,
  provider_model   VARCHAR(120)    NOT NULL,
  resolution       VARCHAR(16)     NOT NULL,
  aspect_ratio     VARCHAR(16)     NOT NULL,
  prompt           TEXT            NULL,
  -- Ảnh đầu vào đã lưu trên server: {"reference": "...", "products": ["..."]}
  input_images     JSON            NULL,
  -- Ảnh này là bản thứ mấy trong số mấy bản của cùng một ảnh mẫu, cùng một lần
  -- bấm nút. Prompt cần biết để dặn bản thứ 2 trở đi "khác đi nhưng vẫn đúng
  -- sản phẩm" — xem buildPrompt trong providers/kie.ts.
  variant_index    INT             NOT NULL DEFAULT 1,
  variant_total    INT             NOT NULL DEFAULT 1,
  -- Tab trình duyệt đã tạo ảnh này. Khách mở nhiều tab để chạy song song nhiều
  -- bộ ảnh khác nhau, mỗi tab chỉ được thấy việc của chính nó.
  client_session   VARCHAR(64)     NULL,
  token_cost       INT             NOT NULL, -- token đã trừ của khách
  -- Tách rõ token lấy từ nguồn nào, để khi lỗi thì hoàn về đúng nguồn đó
  monthly_cost     INT             NOT NULL DEFAULT 0, -- lấy từ hạn mức tháng
  purchased_cost   INT             NOT NULL DEFAULT 0, -- lấy từ token mua thêm
  api_cost_usd     DECIMAL(10,4)   NOT NULL, -- giá vốn ước tính
  status           ENUM('queued','processing','success','failed','refunded') NOT NULL DEFAULT 'queued',
  provider_task_id VARCHAR(190)    NULL,
  result_url       VARCHAR(1000)   NULL,     -- link gốc từ nhà cung cấp
  result_path      VARCHAR(500)    NULL,     -- đường dẫn file đã tải về server
  error_message    VARCHAR(1000)   NULL,
  duration_ms      INT             NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME        NULL,
  -- Khách đã ẩn ảnh này khỏi trang Lịch sử của họ. Cố ý XOÁ MỀM: dòng này là
  -- chứng từ kế toán (điểm đã trừ, giá vốn đã trả cho nhà cung cấp), xoá cứng
  -- thì báo cáo doanh thu và biên lợi nhuận trong trang Quản trị sai âm thầm.
  deleted_at       DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_gen_user (user_id, created_at),
  KEY idx_gen_status (status, created_at),
  KEY idx_gen_batch (batch_id),
  KEY idx_gen_model (model_code, created_at),
  CONSTRAINT fk_gen_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. NHẬT KÝ WEBHOOK CỔNG THANH TOÁN — chống cộng điểm trùng
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider       VARCHAR(40)     NOT NULL,   -- stripe
  -- id sự kiện phía cổng (evt_...). Khoá duy nhất (provider, external_id) là thứ
  -- chặn Stripe bắn lại cùng một sự kiện làm cộng điểm hai lần.
  external_id    VARCHAR(190)    NOT NULL,
  order_code     VARCHAR(32)     NULL,
  order_id       BIGINT UNSIGNED NULL,
  amount_usd_cents BIGINT        NULL,
  content        VARCHAR(500)    NULL,
  status         ENUM('matched','unmatched','duplicate','error') NOT NULL DEFAULT 'unmatched',
  message        VARCHAR(500)    NULL,
  raw_payload    JSON            NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_provider_external (provider, external_id),
  KEY idx_event_order (order_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7b. YÊU CẦU ĐẶT LẠI MẬT KHẨU
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  -- Lưu SHA-256 của token chứ KHÔNG lưu token gốc. Ai đọc trộm được bảng này
  -- cũng không dựng lại được link trong mail để chiếm tài khoản.
  token_hash   CHAR(64)        NOT NULL,
  expires_at   DATETIME        NOT NULL,
  -- Đánh dấu đã dùng thay vì xoá dòng, để còn tra soát khi có tranh chấp.
  used_at      DATETIME        NULL,
  request_ip   VARCHAR(64)     NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pwreset_token (token_hash),
  KEY idx_pwreset_user (user_id, created_at),
  CONSTRAINT fk_pwreset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7c. HOA HỒNG TIẾP THỊ LIÊN KẾT
--     Mỗi đơn đã thanh toán của một khách được giới thiệu sinh ra ĐÚNG MỘT dòng
--     ở đây (khoá duy nhất trên order_id). Toàn bộ cách tính được CHỤP LẠI vào
--     từng dòng — doanh thu, giá vốn điểm, chi phí cố định, % hoa hồng — để admin
--     đổi tỉ lệ trong trang quản trị không làm sai lệch các khoản đã ghi nhận.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  affiliate_user_id BIGINT UNSIGNED NOT NULL,   -- người hưởng hoa hồng
  referred_user_id  BIGINT UNSIGNED NOT NULL,   -- khách đã mua
  order_id          BIGINT UNSIGNED NOT NULL,
  order_code        VARCHAR(32)     NOT NULL,
  revenue_usd_cents BIGINT          NOT NULL,   -- số tiền khách thực trả (cent)
  -- Giá vốn của số điểm đã giao, tính bằng cent. Quy ước toàn hệ thống:
  -- 1 điểm = 0,01 cent giá vốn nhà cung cấp (xem CREDIT_COST_USD trong env.ts).
  token_cost_usd_cents BIGINT       NOT NULL,
  -- Chi phí cố định phân bổ cho đơn này (theo % doanh thu + số tiền cố định).
  fixed_cost_usd_cents BIGINT       NOT NULL DEFAULT 0,
  profit_usd_cents  BIGINT          NOT NULL,   -- revenue − token_cost − fixed_cost
  commission_percent DECIMAL(5,2)   NOT NULL,   -- tỉ lệ áp dụng lúc ghi nhận
  commission_usd_cents BIGINT       NOT NULL,   -- số tiền phải trả cho affiliate
  status            ENUM('pending','paid','cancelled') NOT NULL DEFAULT 'pending',
  paid_at           DATETIME        NULL,
  paid_by           BIGINT UNSIGNED NULL,       -- admin đánh dấu đã chi trả
  note              VARCHAR(255)    NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Chốt chặn chống ghi nhận trùng: webhook bắn hai lần hay bộ đối soát chạy lại
  -- cũng chỉ có một dòng hoa hồng cho một đơn.
  UNIQUE KEY uq_commission_order (order_id),
  KEY idx_commission_affiliate (affiliate_user_id, created_at),
  KEY idx_commission_status (status, created_at),
  CONSTRAINT fk_commission_affiliate FOREIGN KEY (affiliate_user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_commission_referred FOREIGN KEY (referred_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8. CẤU HÌNH CHẠY ĐỘNG (admin sửa được không cần restart)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT         NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
