import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Thư mục gốc của dự án (nơi chứa package.json / .env) */
export const ROOT_DIR = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const str = (key: string, fallback = ''): string => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};

const num = (key: string, fallback: number): number => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};

const bool = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const list = (key: string): string[] =>
  str(key)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: num('PORT', 4000),
  /**
   * Địa chỉ lắng nghe. Khi chạy sau nginx trên VPS nên đặt HOST=127.0.0.1 để cổng
   * Node không lộ ra Internet. Mặc định 0.0.0.0 cho tiện lúc chạy thử.
   */
  host: str('HOST', '0.0.0.0'),
  appUrl: str('APP_URL', 'http://localhost:3000'),

  db: {
    host: str('DB_HOST', '127.0.0.1'),
    port: num('DB_PORT', 3306),
    user: str('DB_USER', 'root'),
    password: str('DB_PASSWORD', ''),
    name: str('DB_NAME', 'copycat_ai'),
    autoMigrate: bool('DB_AUTO_MIGRATE', true),
  },

  jwtSecret: str('JWT_SECRET', 'dev-only-insecure-secret'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '7d'),

  adminEmails: list('ADMIN_EMAILS'),
  adminBootstrap: {
    email: str('ADMIN_BOOTSTRAP_EMAIL').toLowerCase(),
    password: str('ADMIN_BOOTSTRAP_PASSWORD'),
  },

  /**
   * Máy chủ gửi mail.
   *
   * `secure` là true khi nối thẳng bằng TLS (cổng 465), false khi dùng STARTTLS
   * (cổng 587 — kiểu phổ biến nhất). Mặc định suy ra từ cổng để người cấu hình
   * chỉ cần điền host/port/user/pass là chạy được.
   *
   * Gmail và nhiều nhà cung cấp khác KHÔNG nhận mật khẩu đăng nhập thường; phải
   * tạo "mật khẩu ứng dụng" riêng rồi điền vào SMTP_PASSWORD.
   */
  smtp: {
    host: str('SMTP_HOST'),
    port: num('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', num('SMTP_PORT', 587) === 465),
    user: str('SMTP_USER'),
    password: str('SMTP_PASSWORD'),
    /** Địa chỉ hiện ở ô "Từ". Bỏ trống thì dùng luôn SMTP_USER. */
    from: str('SMTP_FROM') || str('SMTP_USER'),
    fromName: str('SMTP_FROM_NAME', 'Design Copycat AI'),
  },

  /** Link đặt lại mật khẩu sống được bao lâu (phút). */
  passwordResetMinutes: Math.max(num('PASSWORD_RESET_MINUTES', 15), 1),

  kie: {
    apiKey: str('KIE_API_KEY'),
    baseUrl: str('KIE_BASE_URL', 'https://api.kie.ai').replace(/\/+$/, ''),
    uploadUrl: str('KIE_UPLOAD_URL', 'https://kieai.redpandaai.co/api/file-base64-upload'),
  },

  /**
   * QUY ƯỚC ĐƠN VỊ ĐIỂM: **10.000 điểm = 1 USD giá vốn nhà cung cấp**
   * (tức 1 điểm = $0,0001 = 0,01 cent).
   *
   * Đây là hằng số neo toàn hệ thống, mọi con số khác suy ra từ nó:
   *
   *     token_cost (điểm/ảnh) = api_cost_usd × CREDITS_PER_USD
   *     giá vốn của N điểm    = N / CREDITS_PER_USD  (USD)
   *
   * Nhờ vậy gói bán gấp đôi giá vốn chỉ đơn giản là "$1 mua được 5.000 điểm".
   *
   * ĐỪNG đổi giá trị này trên hệ thống đang chạy: nó định giá lại toàn bộ số dư
   * điểm khách đang giữ và làm lệch mọi báo cáo lợi nhuận trong quá khứ. Muốn
   * đổi biên lợi nhuận thì sửa giá gói trong Quản trị → Bảng giá.
   */
  creditsPerUsd: Math.max(num('CREDITS_PER_USD', 10_000), 1),

  /** Thông tin pháp lý & liên hệ, hiển thị ở trang Chính sách. */
  site: {
    companyName: str('COMPANY_NAME'),
    companyAddress: str('COMPANY_ADDRESS'),
    supportEmail: str('SUPPORT_EMAIL'),
    supportPhone: str('SUPPORT_PHONE'),
    policyUpdatedAt: str('POLICY_UPDATED_AT'),
  },

  /**
   * Stripe — cổng thanh toán duy nhất.
   *
   * `secretKey`  : sk_test_... khi thử, sk_live_... khi bán thật.
   * `webhookSecret`: whsec_..., lấy khi tạo endpoint trong Stripe Dashboard
   *                (hoặc do `stripe listen` in ra khi chạy thử ở máy cá nhân).
   *                Thiếu nó thì server TỪ CHỐI mọi webhook — chữ ký không xác
   *                minh được nghĩa là ai cũng có thể bắn request giả để tự cộng điểm.
   */
  stripe: {
    secretKey: str('STRIPE_SECRET_KEY'),
    webhookSecret: str('STRIPE_WEBHOOK_SECRET'),
    /** Mã tiền tệ ISO gửi lên Stripe. Đổi thì phải đổi cả bảng giá cho khớp. */
    currency: str('STRIPE_CURRENCY', 'usd').toLowerCase(),
  },

  orderPrefix: str('ORDER_PREFIX', 'ORD').toUpperCase().replace(/[^A-Z]/g, '') || 'ORD',
  orderExpireMinutes: num('ORDER_EXPIRE_MINUTES', 60),
  /**
   * Chu kỳ quét các đơn được hệ thống ngoài đánh dấu đã thanh toán (giây).
   * Càng nhỏ thì gói được kích hoạt càng nhanh sau khi workflow ghi vào DB.
   */
  orderSyncIntervalSeconds: Math.max(num('ORDER_SYNC_INTERVAL_SECONDS', 20), 5),

  storageDir: path.isAbsolute(str('STORAGE_DIR', 'server/storage'))
    ? str('STORAGE_DIR', 'server/storage')
    : path.join(ROOT_DIR, str('STORAGE_DIR', 'server/storage')),
  downloadResults: bool('DOWNLOAD_RESULTS', true),

  /*
   * Trần chung của cả máy chủ. Đặt cao hơn hẳn trần từng khách để vài khách bấm
   * nút cùng lúc vẫn chạy song song được.
   *
   * Sàn 1 cho cả ba con số dưới đây: đặt nhầm thành 0 thì hàng đợi đứng im vĩnh
   * viễn mà không báo lỗi gì — kiểu hỏng rất khó lần ra.
   */
  maxConcurrentJobs: Math.max(num('MAX_CONCURRENT_JOBS', 24), 1),
  /**
   * Số ảnh của MỘT khách được gọi lên nhà cung cấp cùng lúc.
   *
   * 8 = hai ảnh mẫu × bốn bản, tức lô cỡ vừa chạy trọn một đợt. Nâng lên thì lô
   * lớn xong nhanh hơn nhưng dễ chạm rate-limit của Kie.ai.
   */
  maxConcurrentJobsPerUser: Math.max(num('MAX_CONCURRENT_JOBS_PER_USER', 8), 1),
  /*
   * Trần số ảnh đang chờ + đang chạy của một khách.
   *
   * Phải >= số job tối đa của MỘT lần bấm nút (8 ảnh mẫu × 4 bản = 32), nếu không
   * giao diện cho khách chọn một tổ hợp mà máy chủ chắc chắn từ chối.
   */
  maxQueuePerUser: Math.max(num('MAX_QUEUE_PER_USER', 32), 1),
};

/** Cảnh báo các cấu hình còn thiếu / không an toàn khi khởi động. */
export function checkEnv(): void {
  const warnings: string[] = [];

  const placeholderSecrets = ['dev-only-insecure-secret', 'doi_chuoi_nay_thanh_mot_chuoi_ngau_nhien_that_dai'];
  if (placeholderSecrets.includes(env.jwtSecret) || env.jwtSecret.length < 24) {
    warnings.push(
      'JWT_SECRET vẫn là giá trị mẫu hoặc quá ngắn. Sinh chuỗi mới bằng: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  if (!env.kie.apiKey) {
    warnings.push('KIE_API_KEY chưa được cấu hình — chức năng tạo ảnh sẽ báo lỗi.');
  }
  if (env.adminEmails.length === 0) {
    warnings.push('ADMIN_EMAILS đang trống — sẽ không có ai vào được bảng điều khiển.');
  }
  if (!env.stripe.secretKey) {
    warnings.push('STRIPE_SECRET_KEY chưa cấu hình — khách sẽ không mua điểm được.');
  }
  if (!env.stripe.webhookSecret) {
    warnings.push(
      'STRIPE_WEBHOOK_SECRET chưa cấu hình — server sẽ TỪ CHỐI mọi webhook Stripe. ' +
        'Đơn vẫn được cộng điểm nhờ vòng đối soát hỏi thẳng Stripe, nhưng chậm hơn; ' +
        'hãy cấu hình webhook trước khi bán thật.',
    );
  }
  if (env.stripe.secretKey.startsWith('sk_test_') && env.isProd) {
    warnings.push('Đang chạy NODE_ENV=production nhưng STRIPE_SECRET_KEY là khoá test — sẽ không thu được tiền thật.');
  }
  if (!env.smtp.host || !env.smtp.user) {
    warnings.push('SMTP_HOST / SMTP_USER chưa cấu hình — chức năng quên mật khẩu sẽ không gửi được mail.');
  }

  for (const warning of warnings) {
    console.warn(`[cấu hình] ${warning}`);
  }
}
