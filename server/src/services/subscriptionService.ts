/**
 * =====================================================================
 *  HẠN MỨC THÁNG — DI SẢN CỦA MÔ HÌNH THUÊ BAO ĐÃ NGỪNG BÁN
 * =====================================================================
 *
 * Sản phẩm nay bán ĐIỂM LẺ: mua điểm là dùng được ngay, không phải mua gói
 * tháng, không có cửa nào chặn khách tạo ảnh nữa.
 *
 * File này vẫn còn vì hai lý do, KHÔNG phải vì quên dọn:
 *
 *   1. Những gói tháng đã bán trước đây phải được chạy hết hạn tử tế — khách
 *      đã trả tiền cho chúng. Chừng nào còn một gói còn hạn thì `monthly_tokens`
 *      vẫn phải được cấp lại, tiêu và thu hồi đúng như cũ.
 *   2. Admin vẫn cấp gói tay cho khách VIP trong Quản trị → Khách hàng → "Gói".
 *
 * Phần đã gỡ hẳn: bán gói qua chuyển khoản, nâng gói (khấu trừ theo ngày), và
 * hàm chặn `requireSubscription`.
 */
import { execute, query, queryOne, type PoolConnection, type ResultSetHeader, type RowDataPacket } from '../db.js';
import { badRequest } from '../lib/errors.js';

export interface PlanRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  months: number;
  price_usd_cents: number;
  monthly_token_allowance: number;
  description: string | null;
  is_popular: number;
  is_active: number;
  sort_order: number;
}

export interface SubscriptionRow extends RowDataPacket {
  id: number;
  user_id: number;
  plan_id: number | null;
  plan_code: string | null;
  plan_name: string;
  months: number;
  price_usd_cents: number;
  monthly_token_allowance: number;
  status: 'active' | 'expired' | 'cancelled';
  order_id: number | null;
  started_at: Date;
  expires_at: Date;
  created_at: Date;
}

/** Ảnh chụp trạng thái thuê bao + hạn mức của một tài khoản. */
export interface AccountState {
  isSubscribed: boolean;
  subscriptionExpiresAt: Date | null;
  monthlyAllowance: number;
  monthlyTokens: number;
  monthlyPeriodEnd: Date | null;
  purchasedTokens: number;
  /** Tổng điểm dùng được ngay = hạn mức tháng còn lại + điểm đã mua thêm */
  availableTokens: number;
}

interface UserStateRow extends RowDataPacket {
  token_balance: number;
  subscription_expires_at: Date | null;
  monthly_allowance: number;
  monthly_tokens: number;
  monthly_period_end: Date | null;
}

/**
 * Cấp lại hạn mức tháng nếu đã sang chu kỳ mới.
 *
 * Chạy theo kiểu "kiểm tra khi dùng" (lazy) nên không cần cron: mỗi lần đụng tới
 * điểm, nếu đã qua mốc `monthly_period_end` thì hạn mức được cấp lại.
 *
 * Điểm thừa của tháng cũ BỊ XOÁ, không cộng dồn. Phần bị xoá vẫn được ghi vào sổ
 * cái (type = 'expire') để đối soát được.
 *
 * Bắt buộc gọi trong transaction đã khoá dòng users bằng SELECT ... FOR UPDATE.
 */
async function refreshMonthlyAllowance(conn: PoolConnection, userId: number, state: UserStateRow): Promise<UserStateRow> {
  const now = Date.now();
  const expiresAt = state.subscription_expires_at ? new Date(state.subscription_expires_at).getTime() : 0;

  // Hết hạn thuê bao: thu hồi hạn mức còn lại, giữ nguyên điểm đã mua thêm.
  if (!expiresAt || expiresAt <= now) {
    if (state.monthly_tokens > 0) {
      await writeLedger(conn, userId, 'expire', 'monthly', -state.monthly_tokens, 0, 'Hết hạn gói dịch vụ — thu hồi hạn mức tháng');
      await conn.query('UPDATE users SET monthly_tokens = 0 WHERE id = ?', [userId]);
      state.monthly_tokens = 0;
    }
    return state;
  }

  const periodEnd = state.monthly_period_end ? new Date(state.monthly_period_end).getTime() : 0;
  if (periodEnd > now) return state; // vẫn trong chu kỳ hiện tại, không làm gì

  // Đã sang chu kỳ mới (có thể nhảy nhiều tháng nếu khách lâu không dùng).
  if (state.monthly_tokens > 0) {
    await writeLedger(
      conn,
      userId,
      'expire',
      'monthly',
      -state.monthly_tokens,
      0,
      `Sang chu kỳ mới — ${state.monthly_tokens.toLocaleString('vi-VN')} điểm hạn mức cũ không được cộng dồn`,
    );
  }

  /*
   * Cộng mốc bằng SQL để tự xử lý đúng các tháng thiếu ngày (31/1 + 1 tháng = 28/2).
   *
   * COALESCE là bắt buộc: DATE_ADD(NULL, ...) trả về NULL, nên nếu mốc đang NULL
   * thì nó sẽ NULL vĩnh viễn và mỗi lần chạm vào điểm lại được cấp hạn mức mới —
   * điểm vô hạn nếu allowance > 0, hoặc bị xoá sạch mỗi lần nếu allowance = 0.
   */
  await conn.query(
    `UPDATE users
        SET monthly_tokens = monthly_allowance,
            monthly_period_end = LEAST(
              DATE_ADD(
                COALESCE(monthly_period_end, NOW()),
                INTERVAL (TIMESTAMPDIFF(MONTH, COALESCE(monthly_period_end, NOW()), NOW()) + 1) MONTH
              ),
              subscription_expires_at
            )
      WHERE id = ?`,
    [userId],
  );

  const [rows] = await conn.query<UserStateRow[]>(
    `SELECT token_balance, subscription_expires_at, monthly_allowance, monthly_tokens, monthly_period_end
       FROM users WHERE id = ?`,
    [userId],
  );
  const updated = rows[0];

  await writeLedger(
    conn,
    userId,
    'grant',
    'monthly',
    updated.monthly_allowance,
    updated.monthly_tokens,
    'Cấp hạn mức điểm cho chu kỳ tháng mới',
  );

  return updated;
}

async function writeLedger(
  conn: PoolConnection,
  userId: number,
  type: string,
  bucket: 'monthly' | 'purchased',
  amount: number,
  balanceAfter: number,
  description: string,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    `INSERT INTO token_transactions (user_id, type, bucket, amount, balance_after, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, bucket, amount, balanceAfter, description],
  );
}

/**
 * Khoá dòng tài khoản, cấp lại hạn mức nếu cần, rồi trả về trạng thái hiện tại.
 * Mọi thao tác đụng tới điểm đều phải đi qua đây.
 */
export async function lockAccountState(conn: PoolConnection, userId: number): Promise<AccountState> {
  const [rows] = await conn.query<UserStateRow[]>(
    `SELECT token_balance, subscription_expires_at, monthly_allowance, monthly_tokens, monthly_period_end
       FROM users WHERE id = ? FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw badRequest('Không tìm thấy tài khoản.');

  const state = await refreshMonthlyAllowance(conn, userId, rows[0]);
  const expiresAt = state.subscription_expires_at ? new Date(state.subscription_expires_at) : null;

  return {
    isSubscribed: Boolean(expiresAt && expiresAt.getTime() > Date.now()),
    subscriptionExpiresAt: expiresAt,
    monthlyAllowance: state.monthly_allowance,
    monthlyTokens: state.monthly_tokens,
    monthlyPeriodEnd: state.monthly_period_end ? new Date(state.monthly_period_end) : null,
    purchasedTokens: state.token_balance,
    availableTokens: state.monthly_tokens + state.token_balance,
  };
}

/** Đọc trạng thái tài khoản ngoài transaction (chỉ để hiển thị, không dùng để trừ điểm). */
export async function readAccountState(userId: number): Promise<AccountState> {
  const row = await queryOne<UserStateRow>(
    `SELECT token_balance, subscription_expires_at, monthly_allowance, monthly_tokens, monthly_period_end
       FROM users WHERE id = ?`,
    [userId],
  );
  if (!row) throw badRequest('Không tìm thấy tài khoản.');

  const expiresAt = row.subscription_expires_at ? new Date(row.subscription_expires_at) : null;
  const isSubscribed = Boolean(expiresAt && expiresAt.getTime() > Date.now());
  const periodEnd = row.monthly_period_end ? new Date(row.monthly_period_end) : null;

  // Chu kỳ đã qua mốc nhưng chưa ai chạm vào tài khoản: hiển thị đúng hạn mức sẽ
  // được cấp, thay vì con số cũ sắp bị xoá.
  const pendingReset = isSubscribed && periodEnd !== null && periodEnd.getTime() <= Date.now();
  const monthlyTokens = !isSubscribed ? 0 : pendingReset ? row.monthly_allowance : row.monthly_tokens;

  return {
    isSubscribed,
    subscriptionExpiresAt: expiresAt,
    monthlyAllowance: row.monthly_allowance,
    monthlyTokens,
    monthlyPeriodEnd: periodEnd,
    purchasedTokens: row.token_balance,
    availableTokens: monthlyTokens + row.token_balance,
  };
}

/**
 * Kích hoạt (hoặc gia hạn) thuê bao sau khi đơn được thanh toán.
 *
 * Gia hạn khi gói cũ còn hạn thì nối tiếp vào ngày hết hạn cũ, khách không mất
 * những ngày còn lại. Chu kỳ hạn mức tháng chỉ khởi tạo lại khi khách đang không
 * có gói — gia hạn giữa chừng không làm reset hạn mức đang dùng dở.
 */
export async function activateSubscription(
  conn: PoolConnection,
  userId: number,
  plan: { id: number | null; code: string | null; name: string; months: number; priceUsdCents: number; allowance: number },
  orderId: number | null,
  /**
   * `restart: true` dùng cho NÂNG GÓI — gói mới tính giờ từ thời điểm kích hoạt
   * thay vì nối tiếp ngày hết hạn cũ, và hạn mức được cấp lại ngay theo mức của
   * gói mới. Phần chưa dùng của gói cũ đã được quy thành tiền khấu trừ vào đơn.
   */
  options: { restart?: boolean } = {},
): Promise<{ startedAt: Date; expiresAt: Date; isRenewal: boolean }> {
  const [rows] = await conn.query<UserStateRow[]>(
    `SELECT token_balance, subscription_expires_at, monthly_allowance, monthly_tokens, monthly_period_end
       FROM users WHERE id = ? FOR UPDATE`,
    [userId],
  );
  const current = rows[0];
  const now = new Date();
  const currentExpiry = current?.subscription_expires_at ? new Date(current.subscription_expires_at) : null;
  const isRenewal = !options.restart && Boolean(currentExpiry && currentExpiry.getTime() > now.getTime());

  // Nối tiếp từ ngày hết hạn cũ nếu còn hạn, ngược lại tính từ bây giờ.
  //
  // CAST(? AS DATETIME) là bắt buộc, không phải cho đẹp: nếu để `SELECT ? AS
  // started_at` thì MySQL trả về kiểu chuỗi, mysql2 không nhận ra là ngày giờ nên
  // không áp `timezone: 'Z'` của pool, và `new Date(chuỗi)` lại đọc theo múi giờ
  // máy chủ. Kết quả là mọi gói bị lùi đúng bằng chênh lệch múi giờ (UTC+7 thì mất
  // 7 tiếng), và mỗi lần gia hạn lại lùi thêm một lần nữa vì tính tiếp từ ngày đã
  // sai. CAST khiến cột trả về đúng kiểu DATETIME và mysql2 đọc lại chuẩn UTC.
  const [computed] = await conn.query<(RowDataPacket & { started_at: Date; expires_at: Date })[]>(
    `SELECT CAST(? AS DATETIME) AS started_at,
            DATE_ADD(CAST(? AS DATETIME), INTERVAL ? MONTH) AS expires_at`,
    [isRenewal ? currentExpiry : now, isRenewal ? currentExpiry : now, plan.months],
  );
  const startedAt = new Date(computed[0].started_at);
  const expiresAt = new Date(computed[0].expires_at);

  const [inserted] = await conn.query<ResultSetHeader>(
    `INSERT INTO subscriptions
       (user_id, plan_id, plan_code, plan_name, months, price_usd_cents, monthly_token_allowance, order_id, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, plan.id, plan.code, plan.name, plan.months, plan.priceUsdCents, plan.allowance, orderId, startedAt, expiresAt],
  );

  if (isRenewal) {
    // Đang dùng dở: chỉ đẩy ngày hết hạn ra xa, giữ nguyên hạn mức của chu kỳ hiện tại.
    await conn.query('UPDATE users SET subscription_expires_at = ?, monthly_allowance = ? WHERE id = ?', [
      expiresAt,
      plan.allowance,
      userId,
    ]);
  } else {
    /*
     * Bắt đầu chu kỳ mới: cấp hạn mức ngay, mốc reset là 1 tháng kể từ bây giờ.
     *
     * Hạn mức cũ còn thừa bị THAY THẾ chứ không cộng dồn, nên phải ghi một dòng
     * `expire` cho phần đó trước khi ghi `grant`. Thiếu bước này thì cột
     * balance_after trong sổ cái không khớp với số dư thật (vd còn 300.000 rồi
     * ghi "grant +500.000 → 500.000" là sai số học).
     */
    const leftover = current?.monthly_tokens ?? 0;
    if (leftover > 0) {
      await writeLedger(
        conn,
        userId,
        'expire',
        'monthly',
        -leftover,
        0,
        options.restart
          ? `Nâng lên ${plan.name} — hạn mức của gói cũ được quy thành tiền khấu trừ vào đơn`
          : 'Bắt đầu gói mới — thu hồi hạn mức còn lại của gói cũ',
      );
    }

    await conn.query(
      `UPDATE users
          SET subscription_expires_at = ?,
              monthly_allowance = ?,
              monthly_tokens = ?,
              monthly_period_end = LEAST(DATE_ADD(NOW(), INTERVAL 1 MONTH), ?)
        WHERE id = ?`,
      [expiresAt, plan.allowance, plan.allowance, expiresAt, userId],
    );
    await writeLedger(
      conn,
      userId,
      'grant',
      'monthly',
      plan.allowance,
      plan.allowance,
      `${options.restart ? 'Nâng lên' : 'Kích hoạt'} ${plan.name} — hạn mức ${plan.allowance.toLocaleString('vi-VN')} điểm/tháng`,
    );
  }

  await conn.query(`UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND id <> ? AND status = 'active'`, [
    userId,
    inserted.insertId,
  ]);

  return { startedAt, expiresAt, isRenewal };
}

/** Đánh dấu hết hạn cho các thuê bao đã qua ngày. Chạy định kỳ, chỉ để báo cáo cho đúng. */
export async function expireStaleSubscriptions(): Promise<number> {
  const result = await execute(
    `UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()`,
  );
  return result.affectedRows;
}
