import crypto from 'node:crypto';
import { execute, query, queryOne, type PoolConnection, type ResultSetHeader, type RowDataPacket } from '../db.js';
import { env } from '../env.js';
import { badRequest } from '../lib/errors.js';

// ---------------------------------------------------------------------------
//  CẤU HÌNH CHƯƠNG TRÌNH TIẾP THỊ LIÊN KẾT
// ---------------------------------------------------------------------------

/**
 * Cấu hình nằm trong bảng `settings` chứ không phải `.env`: admin phải đổi được
 * tỉ lệ hoa hồng ngay trong trang quản trị, không cần khởi động lại server.
 */
export const AFFILIATE_SETTING_KEYS = {
  enabled: 'affiliate_enabled',
  commissionPercent: 'affiliate_commission_percent',
  fixedCostUsdCents: 'affiliate_fixed_cost_usd_cents',
  fixedCostPercent: 'affiliate_fixed_cost_percent',
} as const;

export const AFFILIATE_DEFAULTS = {
  enabled: true,
  /** Hoa hồng mặc định: 40% lợi nhuận của đơn. */
  commissionPercent: 40,
  /** Chi phí cố định trừ thẳng trên mỗi đơn, tính bằng cent (phí Stripe, phí xử lý...). */
  fixedCostUsdCents: 0,
  /** Chi phí cố định phân bổ theo % doanh thu (hạ tầng, nhân sự, marketing...). */
  fixedCostPercent: 0,
};

export interface AffiliateSettings {
  enabled: boolean;
  commissionPercent: number;
  fixedCostUsdCents: number;
  fixedCostPercent: number;
}

/**
 * Giá vốn của N điểm, tính bằng cent (làm tròn tới cent gần nhất).
 *
 * Quy ước xuyên suốt hệ thống là **CREDITS_PER_USD điểm = $1 giá vốn nhà cung
 * cấp** (xem env.ts và đầu file `seed.ts`), nên số điểm đã giao cho khách chính
 * là chi phí biến đổi của đơn. Ghi nhận giá vốn ngay lúc bán — thay vì đợi khách
 * thật sự tạo ảnh — để hoa hồng chốt được cùng lúc với đơn hàng và không phải
 * tính lại về sau.
 */
export const creditCostUsdCents = (tokens: number): number =>
  Math.round((Math.max(tokens, 0) * 100) / env.creditsPerUsd);

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Đọc cấu hình đang áp dụng.
 *
 * `conn` là bắt buộc khi gọi từ bên trong một transaction: mượn thêm một kết nối
 * thứ hai từ pool trong lúc đang giữ một kết nối là công thức làm cạn pool — đủ
 * mười lượt thanh toán chạy song song thì tất cả cùng đứng chờ nhau vô hạn.
 */
export async function readAffiliateSettings(conn?: PoolConnection): Promise<AffiliateSettings> {
  const keys = Object.values(AFFILIATE_SETTING_KEYS);
  const sql = `SELECT setting_key, setting_value FROM settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`;

  type SettingRow = RowDataPacket & { setting_key: string; setting_value: string | null };
  const rows = conn ? (await conn.query<SettingRow[]>(sql, keys))[0] : await query<SettingRow>(sql, keys);
  const map = new Map(rows.map((row) => [row.setting_key, row.setting_value]));

  const raw = map.get(AFFILIATE_SETTING_KEYS.enabled);
  return {
    enabled: raw === null || raw === undefined ? AFFILIATE_DEFAULTS.enabled : ['1', 'true', 'yes', 'on'].includes(raw),
    commissionPercent: toNumber(map.get(AFFILIATE_SETTING_KEYS.commissionPercent), AFFILIATE_DEFAULTS.commissionPercent),
    fixedCostUsdCents: Math.round(
      toNumber(map.get(AFFILIATE_SETTING_KEYS.fixedCostUsdCents), AFFILIATE_DEFAULTS.fixedCostUsdCents),
    ),
    fixedCostPercent: toNumber(map.get(AFFILIATE_SETTING_KEYS.fixedCostPercent), AFFILIATE_DEFAULTS.fixedCostPercent),
  };
}

export async function saveAffiliateSettings(patch: Partial<AffiliateSettings>): Promise<AffiliateSettings> {
  const writes: [string, string][] = [];

  if (patch.enabled !== undefined) writes.push([AFFILIATE_SETTING_KEYS.enabled, patch.enabled ? '1' : '0']);

  if (patch.commissionPercent !== undefined) {
    if (!Number.isFinite(patch.commissionPercent) || patch.commissionPercent < 0 || patch.commissionPercent > 100) {
      throw badRequest('Tỉ lệ hoa hồng phải nằm trong khoảng 0 – 100%.');
    }
    writes.push([AFFILIATE_SETTING_KEYS.commissionPercent, String(Math.round(patch.commissionPercent * 100) / 100)]);
  }

  if (patch.fixedCostUsdCents !== undefined) {
    if (!Number.isFinite(patch.fixedCostUsdCents) || patch.fixedCostUsdCents < 0) {
      throw badRequest('Chi phí cố định mỗi đơn phải là số không âm.');
    }
    writes.push([AFFILIATE_SETTING_KEYS.fixedCostUsdCents, String(Math.round(patch.fixedCostUsdCents))]);
  }

  if (patch.fixedCostPercent !== undefined) {
    if (!Number.isFinite(patch.fixedCostPercent) || patch.fixedCostPercent < 0 || patch.fixedCostPercent > 100) {
      throw badRequest('Chi phí cố định theo doanh thu phải nằm trong khoảng 0 – 100%.');
    }
    writes.push([AFFILIATE_SETTING_KEYS.fixedCostPercent, String(Math.round(patch.fixedCostPercent * 100) / 100)]);
  }

  for (const [key, value] of writes) {
    await execute(
      `INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value],
    );
  }

  return readAffiliateSettings();
}

// ---------------------------------------------------------------------------
//  CÁCH TÍNH HOA HỒNG
// ---------------------------------------------------------------------------

export interface CommissionBreakdown {
  revenueUsdCents: number;
  tokenCostUsdCents: number;
  fixedCostUsdCents: number;
  profitUsdCents: number;
  commissionPercent: number;
  commissionUsdCents: number;
}

/**
 * Quy đổi một đơn hàng thành số tiền hoa hồng.
 *
 *     lợi nhuận = doanh thu − giá vốn số điểm đã giao − chi phí cố định
 *     hoa hồng  = lợi nhuận × tỉ lệ %
 *
 * Lợi nhuận âm (đơn khuyến mãi sâu, chi phí cố định lớn hơn lãi) cho hoa hồng
 * bằng 0 chứ không phải số âm — không đi đòi tiền affiliate vì một đơn lỗ.
 */
export function computeCommission(
  input: { revenueUsdCents: number; tokensDelivered: number },
  settings: AffiliateSettings,
): CommissionBreakdown {
  const revenueUsdCents = Math.max(Math.round(input.revenueUsdCents), 0);
  const tokenCostUsdCents = creditCostUsdCents(input.tokensDelivered);
  const fixedCostUsdCents =
    Math.round((revenueUsdCents * settings.fixedCostPercent) / 100) + settings.fixedCostUsdCents;
  const profitUsdCents = revenueUsdCents - tokenCostUsdCents - fixedCostUsdCents;

  return {
    revenueUsdCents,
    tokenCostUsdCents,
    fixedCostUsdCents,
    profitUsdCents,
    commissionPercent: settings.commissionPercent,
    commissionUsdCents: profitUsdCents > 0 ? Math.round((profitUsdCents * settings.commissionPercent) / 100) : 0,
  };
}

// ---------------------------------------------------------------------------
//  MÃ GIỚI THIỆU
// ---------------------------------------------------------------------------

/** Bỏ các ký tự dễ nhìn nhầm — mã này được đọc qua điện thoại và gõ tay. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

/**
 * Link đầy đủ để cộng tác viên copy đi chia sẻ.
 *
 * `origin` nên lấy từ chính request đang gọi (xem `requestOrigin`): người đang
 * mở trang bao giờ cũng đứng ở đúng tên miền công khai, trong khi `APP_URL`
 * trong `.env` rất dễ bị bỏ quên ở giá trị mẫu `http://localhost:3000` — và khi
 * đó mọi link phát ra ngoài đều chết mà không ai nhận ra cho tới lúc có khách
 * bấm vào.
 */
export const buildReferralLink = (code: string, origin?: string | null): string =>
  `${(origin || env.appUrl).replace(/\/+$/, '')}/?ref=${code}`;

/**
 * Tên miền khách đang truy cập, suy từ request.
 *
 * `req.protocol` đọc được `X-Forwarded-Proto` nhờ `trust proxy` đã bật trong
 * index.ts, nên site sau nginx + SSL vẫn ra `https`. Không có header Host thì
 * trả null để `buildReferralLink` lùi về `APP_URL`.
 */
export const requestOrigin = (req: { protocol: string; get(name: string): string | undefined }): string | null => {
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : null;
};

/**
 * Đảm bảo tài khoản có mã giới thiệu, trả về mã đang dùng.
 *
 * KHÔNG sinh mã mới nếu đã có: mã cũ có thể đang nằm trong bài đăng, tin nhắn,
 * mã QR mà affiliate đã phát ra ngoài — đổi mã là làm chết hết các link đó.
 */
export async function ensureAffiliateCode(userId: number): Promise<string> {
  const current = await queryOne<RowDataPacket & { affiliate_code: string | null }>(
    'SELECT affiliate_code FROM users WHERE id = ?',
    [userId],
  );
  if (!current) throw badRequest('Không tìm thấy tài khoản.');
  if (current.affiliate_code) return current.affiliate_code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await execute('UPDATE users SET affiliate_code = ? WHERE id = ?', [code, userId]);
      return code;
    } catch (error) {
      // mysql2 để mã lỗi ở thuộc tính `code`; phần `message` chỉ có câu tiếng Anh
      // "Duplicate entry ... for key ...", nên dò theo chuỗi là dò trượt.
      if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
    }
  }

  throw new Error('Không sinh được mã giới thiệu duy nhất, vui lòng thử lại.');
}

/**
 * Bật / tắt vai trò affiliate cho một tài khoản.
 *
 * Thu hồi quyền KHÔNG xoá mã và KHÔNG xoá các dòng hoa hồng đã ghi: hoa hồng đã
 * phát sinh là khoản nợ phải trả, còn giữ mã để nếu cấp lại thì link cũ sống lại
 * nguyên vẹn. Chỉ có điều từ lúc thu hồi, đơn mới không sinh hoa hồng nữa.
 */
export async function setAffiliateRole(userId: number, enabled: boolean): Promise<{ code: string | null }> {
  const result = await execute('UPDATE users SET is_affiliate = ? WHERE id = ?', [enabled ? 1 : 0, userId]);
  if (result.affectedRows === 0) {
    const exists = await queryOne<RowDataPacket>('SELECT 1 FROM users WHERE id = ?', [userId]);
    if (!exists) throw badRequest('Không tìm thấy tài khoản.');
  }

  if (!enabled) {
    const row = await queryOne<RowDataPacket & { affiliate_code: string | null }>(
      'SELECT affiliate_code FROM users WHERE id = ?',
      [userId],
    );
    return { code: row?.affiliate_code ?? null };
  }

  return { code: await ensureAffiliateCode(userId) };
}

// ---------------------------------------------------------------------------
//  GẮN NGƯỜI GIỚI THIỆU LÚC ĐĂNG KÝ
// ---------------------------------------------------------------------------

/**
 * Tìm affiliate theo mã trong link. Trả về null nếu mã sai, người đó không còn
 * là affiliate, hoặc tài khoản đã bị khoá.
 *
 * Mã sai KHÔNG làm hỏng việc đăng ký — khách gõ nhầm link thì vẫn tạo được tài
 * khoản, chỉ là không ai được ghi công.
 */
export async function resolveReferrer(code: string | null): Promise<number | null> {
  const trimmed = code?.trim().toUpperCase();
  if (!trimmed) return null;

  const row = await queryOne<RowDataPacket & { id: number }>(
    `SELECT id FROM users WHERE affiliate_code = ? AND is_affiliate = 1 AND status = 'active'`,
    [trimmed],
  );
  return row?.id ?? null;
}

/**
 * Ghi nhận người giới thiệu cho một tài khoản vừa tạo.
 *
 * Chỉ ghi khi ô còn trống và người giới thiệu không phải chính khách đó (mã tự
 * dùng cho mình để ăn hoa hồng trên đơn của chính mình).
 */
export async function attachReferrer(newUserId: number, referrerId: number | null): Promise<void> {
  if (!referrerId || referrerId === newUserId) return;
  await execute('UPDATE users SET referred_by = ?, referred_at = NOW() WHERE id = ? AND referred_by IS NULL', [
    referrerId,
    newUserId,
  ]);
}

// ---------------------------------------------------------------------------
//  GHI NHẬN HOA HỒNG KHI ĐƠN ĐƯỢC THANH TOÁN
// ---------------------------------------------------------------------------

export interface CommissionRow extends RowDataPacket {
  id: number;
  affiliate_user_id: number;
  referred_user_id: number;
  order_id: number;
  order_code: string;
  revenue_usd_cents: number;
  token_cost_usd_cents: number;
  fixed_cost_usd_cents: number;
  profit_usd_cents: number;
  commission_percent: number;
  commission_usd_cents: number;
  status: 'pending' | 'paid' | 'cancelled';
  paid_at: Date | null;
  note: string | null;
  created_at: Date;
}

/**
 * Sinh dòng hoa hồng cho một đơn vừa được giao hàng.
 *
 * Gọi BÊN TRONG transaction đã khoá dòng đơn (xem `fulfillOrder`), nên dòng hoa
 * hồng và việc cộng điểm cho khách hoặc cùng thành công hoặc cùng bị huỷ. Thêm
 * một lớp chống trùng nữa ở khoá duy nhất `uq_commission_order` — webhook bắn
 * lại hay bộ đối soát chạy song song đều không tạo được dòng thứ hai.
 *
 * Trả về số tiền hoa hồng đã ghi, hoặc null nếu đơn không thuộc diện tính.
 */
export async function recordOrderCommission(
  conn: PoolConnection,
  order: { id: number; code: string; user_id: number; amount_usd_cents: number; total_tokens: number },
): Promise<number | null> {
  const settings = await readAffiliateSettings(conn);
  if (!settings.enabled) return null;

  const [buyers] = await conn.query<(RowDataPacket & { referred_by: number | null })[]>(
    'SELECT referred_by FROM users WHERE id = ?',
    [order.user_id],
  );
  const affiliateId = buyers[0]?.referred_by ?? null;
  if (!affiliateId) return null;

  // Quyền bị thu hồi thì dừng phát sinh hoa hồng mới, nhưng các khoản đã ghi
  // trước đó vẫn còn nguyên trong bảng.
  const [affiliates] = await conn.query<(RowDataPacket & { is_affiliate: number })[]>(
    'SELECT is_affiliate FROM users WHERE id = ?',
    [affiliateId],
  );
  if (!affiliates[0] || affiliates[0].is_affiliate !== 1) return null;

  const breakdown = computeCommission(
    { revenueUsdCents: order.amount_usd_cents, tokensDelivered: order.total_tokens },
    settings,
  );

  const [result] = await conn.query<ResultSetHeader>(
    `INSERT IGNORE INTO affiliate_commissions
       (affiliate_user_id, referred_user_id, order_id, order_code, revenue_usd_cents, token_cost_usd_cents,
        fixed_cost_usd_cents, profit_usd_cents, commission_percent, commission_usd_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      affiliateId,
      order.user_id,
      order.id,
      order.code,
      breakdown.revenueUsdCents,
      breakdown.tokenCostUsdCents,
      breakdown.fixedCostUsdCents,
      breakdown.profitUsdCents,
      breakdown.commissionPercent,
      breakdown.commissionUsdCents,
    ],
  );

  return result.affectedRows > 0 ? breakdown.commissionUsdCents : null;
}

// ---------------------------------------------------------------------------
//  BÁO CÁO
// ---------------------------------------------------------------------------

export interface AffiliateStats {
  referrals: number;
  payingReferrals: number;
  orders: number;
  revenueUsdCents: number;
  profitUsdCents: number;
  commissionUsdCents: number;
  pendingUsdCents: number;
  /**
   * Số khoản đang chờ, tách khỏi `pendingUsdCents`: đơn không có lãi sinh ra
   * khoản hoa hồng $0 vẫn cần được chốt sổ, mà nhìn vào số tiền thì không thấy chúng.
   */
  pendingCount: number;
  paidUsdCents: number;
}

const num = (value: unknown): number => Number(value ?? 0) || 0;

/** Tổng hợp số liệu của một affiliate. */
export async function readAffiliateStats(affiliateId: number): Promise<AffiliateStats> {
  const referrals = await queryOne<RowDataPacket & { total: number }>(
    'SELECT COUNT(*) AS total FROM users WHERE referred_by = ?',
    [affiliateId],
  );

  const commissions = await queryOne<RowDataPacket & Record<string, number>>(
    `SELECT
       COUNT(*)                                                           AS orders,
       COUNT(DISTINCT referred_user_id)                                   AS paying_referrals,
       COALESCE(SUM(revenue_usd_cents), 0)                                AS revenue,
       COALESCE(SUM(profit_usd_cents), 0)                                 AS profit,
       COALESCE(SUM(commission_usd_cents), 0)                             AS commission,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN commission_usd_cents END), 0) AS pending,
       COALESCE(SUM(status = 'pending'), 0)                               AS pending_count,
       COALESCE(SUM(CASE WHEN status = 'paid'    THEN commission_usd_cents END), 0) AS paid
     FROM affiliate_commissions
     WHERE affiliate_user_id = ? AND status <> 'cancelled'`,
    [affiliateId],
  );

  return {
    referrals: num(referrals?.total),
    payingReferrals: num(commissions?.paying_referrals),
    orders: num(commissions?.orders),
    revenueUsdCents: num(commissions?.revenue),
    profitUsdCents: num(commissions?.profit),
    commissionUsdCents: num(commissions?.commission),
    pendingUsdCents: num(commissions?.pending),
    pendingCount: num(commissions?.pending_count),
    paidUsdCents: num(commissions?.paid),
  };
}

export const serializeCommission = (row: CommissionRow) => ({
  id: row.id,
  orderCode: row.order_code,
  revenueUsdCents: num(row.revenue_usd_cents),
  tokenCostUsdCents: num(row.token_cost_usd_cents),
  fixedCostUsdCents: num(row.fixed_cost_usd_cents),
  profitUsdCents: num(row.profit_usd_cents),
  commissionPercent: Number(row.commission_percent),
  commissionUsdCents: num(row.commission_usd_cents),
  status: row.status,
  paidAt: row.paid_at,
  note: row.note,
  createdAt: row.created_at,
});

/**
 * Che bớt email của khách trong báo cáo của affiliate.
 *
 * Affiliate cần nhận ra ai là khách của mình, nhưng không có lý do gì để cầm
 * trong tay danh sách email đầy đủ của khách hàng công ty — đó là dữ liệu để
 * mang đi nơi khác.
 */
export function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
}
