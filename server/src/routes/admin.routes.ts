import { Router } from 'express';
import { execute, query, queryOne, withTransaction, type ResultSetHeader, type RowDataPacket } from '../db.js';
import { env } from '../env.js';
import { hashPassword, isAdminEmail, requireAdmin } from '../lib/auth.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { optionalString, parsePaging, requireEmail, requireInt, requireString } from '../lib/validate.js';
import { providerStatus } from '../providers/index.js';
import {
  buildReferralLink,
  computeCommission,
  readAffiliateSettings,
  readAffiliateStats,
  requestOrigin,
  saveAffiliateSettings,
  serializeCommission,
  setAffiliateRole,
  type CommissionRow,
} from '../services/affiliateService.js';
import { queueStatus, serializeGeneration, type GenerationRow, type ModelPricingRow } from '../services/generationService.js';
import { markOrderPaid, serializeOrder, type OrderRow, type PackageRow } from '../services/orderService.js';
import {
  activateSubscription,
  expireStaleSubscriptions,
  lockAccountState,
  type PlanRow,
} from '../services/subscriptionService.js';
import { adjustMonthlyTokens, creditPurchasedTokens } from '../services/tokenService.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

const num = (value: unknown): number => Number(value ?? 0) || 0;

/**
 * Giá VỐN của một điểm, tính bằng cent. Quy ước: CREDITS_PER_USD điểm = $1 giá
 * vốn nhà cung cấp, nên 10.000 điểm/$1 cho ra 0,01 cent mỗi điểm.
 */
const CREDIT_COST_CENTS = 100 / env.creditsPerUsd;

/**
 * Giá BÁN mỗi điểm, tính bằng cent. Gói điểm bán gấp đôi giá vốn nên đơn giá bán
 * gấp đôi `CREDIT_COST_CENTS` — suy ra từ hằng số trên chứ không gõ tay, để đổi
 * CREDITS_PER_USD thì mọi báo cáo tự khớp lại.
 */
const CREDIT_SELL_PRICE_CENTS = CREDIT_COST_CENTS * 2;

// ---------------------------------------------------------------------------
//  BẢNG ĐIỀU KHIỂN & BÁO CÁO
// ---------------------------------------------------------------------------

/**
 * Chỉ số tổng quan.
 *
 * Doanh thu  = tổng tiền các đơn đã thanh toán.
 * Chi phí vốn = tổng api_cost_usd của các ảnh tạo thành công.
 * Biên lợi nhuận gộp = (doanh thu − chi phí vốn) / doanh thu.
 * Mọi số tiền trả về đều tính bằng USD CENT.
 */
adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const revenue = await queryOne<RowDataPacket & Record<string, number>>(
      `SELECT
         COALESCE(SUM(amount_usd_cents), 0)                                               AS total,
         COALESCE(SUM(CASE WHEN DATE(paid_at) = CURDATE() THEN amount_usd_cents END), 0)  AS today,
         COALESCE(SUM(CASE WHEN paid_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)  THEN amount_usd_cents END), 0) AS last7,
         COALESCE(SUM(CASE WHEN paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount_usd_cents END), 0) AS last30,
         COUNT(*)                                                                          AS paid_orders,
         COALESCE(SUM(total_tokens), 0)                                                    AS tokens_sold,
         COALESCE(SUM(CASE WHEN order_type = 'subscription'  THEN amount_usd_cents END), 0) AS subscription_revenue,
         COALESCE(SUM(CASE WHEN order_type = 'token_package' THEN amount_usd_cents END), 0) AS extra_revenue
       FROM orders WHERE status = 'paid'`,
    );

    const subscribers = await queryOne<RowDataPacket & Record<string, number>>(
      `SELECT
         COALESCE(SUM(subscription_expires_at > NOW()), 0)                                 AS active,
         COALESCE(SUM(subscription_expires_at > NOW() AND subscription_expires_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)), 0) AS expiring_7d,
         COALESCE(SUM(CASE WHEN subscription_expires_at > NOW() THEN monthly_tokens END), 0) AS monthly_remaining
       FROM users`,
    );

    const pendingOrders = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM orders WHERE status = 'pending'`,
    );

    const users = await queryOne<RowDataPacket & Record<string, number>>(
      `SELECT
         COUNT(*)                                                                    AS total,
         COALESCE(SUM(DATE(created_at) = CURDATE()), 0)                              AS new_today,
         COALESCE(SUM(created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)), 0)            AS new_30d,
         COALESCE(SUM(token_balance), 0)                                             AS outstanding_tokens
       FROM users`,
    );

    /*
     * Điểm khách đã tiêu — đọc từ SỔ CÁI chứ không từ bảng `generations`.
     *
     * Sổ cái là chứng từ duy nhất ghi mọi biến động điểm, kể cả những khoản
     * không sinh ra từ một dòng generations (admin điều chỉnh tay, hoàn điểm
     * lệch ngày với ảnh gốc). Đếm theo `generations.token_cost` sẽ bỏ sót các
     * khoản đó và lệch dần với số dư thật của khách.
     *
     * `spend` ghi số ÂM, `refund` ghi số DƯƠNG, nên đảo dấu tổng của cả hai loại
     * là ra đúng phần đã tiêu ròng — ảnh lỗi được hoàn tự khấu trừ luôn.
     */
    const spending = await queryOne<RowDataPacket & Record<string, number>>(
      `SELECT
         COALESCE(-SUM(CASE WHEN type IN ('spend','refund') THEN amount END), 0)          AS used_total,
         COALESCE(-SUM(CASE WHEN type IN ('spend','refund') AND DATE(created_at) = CURDATE()
                            THEN amount END), 0)                                          AS used_today,
         COALESCE(-SUM(CASE WHEN type IN ('spend','refund')
                             AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                            THEN amount END), 0)                                          AS used_30d,
         COALESCE(-SUM(CASE WHEN type IN ('spend','refund') AND bucket = 'purchased'
                            THEN amount END), 0)                                          AS used_purchased,
         COALESCE(SUM(CASE WHEN type = 'refund' THEN amount END), 0)                      AS refunded
       FROM token_transactions`,
    );

    const generations = await queryOne<RowDataPacket & Record<string, number>>(
      `SELECT
         COUNT(*)                                                                       AS total,
         COALESCE(SUM(status = 'success'), 0)                                           AS success,
         COALESCE(SUM(status IN ('failed','refunded')), 0)                              AS failed,
         COALESCE(SUM(CASE WHEN status = 'success' THEN token_cost END), 0)             AS tokens_spent,
         COALESCE(SUM(CASE WHEN status = 'success' THEN api_cost_usd END), 0)           AS api_cost_usd,
         COALESCE(SUM(DATE(created_at) = CURDATE()), 0)                                 AS today,
         COALESCE(AVG(CASE WHEN status = 'success' THEN duration_ms END), 0)            AS avg_duration_ms
       FROM generations`,
    );

    const totalRevenue = num(revenue?.total);
    const apiCostCents = num(generations?.api_cost_usd) * 100;

    res.json({
      revenue: {
        total: totalRevenue,
        today: num(revenue?.today),
        last7Days: num(revenue?.last7),
        last30Days: num(revenue?.last30),
        paidOrders: num(revenue?.paid_orders),
        pendingOrders: num(pendingOrders?.total),
        averageOrderValue: num(revenue?.paid_orders) > 0 ? Math.round(totalRevenue / num(revenue?.paid_orders)) : 0,
        subscriptionRevenue: num(revenue?.subscription_revenue),
        extraTokenRevenue: num(revenue?.extra_revenue),
      },
      subscribers: {
        active: num(subscribers?.active),
        expiringIn7Days: num(subscribers?.expiring_7d),
        // Hạn mức tháng chưa dùng của toàn bộ khách đang có gói
        monthlyTokensRemaining: num(subscribers?.monthly_remaining),
      },
      users: {
        total: num(users?.total),
        newToday: num(users?.new_today),
        new30Days: num(users?.new_30d),
        // Điểm khách đã BỎ TIỀN MUA nhưng chưa dùng — nghĩa vụ phải phục vụ.
        // Quy ra tiền theo ĐƠN GIÁ BÁN: đó là số tiền khách đã trả cho phần chưa dùng.
        outstandingTokens: num(users?.outstanding_tokens),
        outstandingLiabilityUsdCents: Math.round(num(users?.outstanding_tokens) * CREDIT_SELL_PRICE_CENTS),
      },
      tokens: {
        /** Điểm đã bán ra qua các đơn đã thanh toán */
        sold: num(revenue?.tokens_sold),
        /** Đã tiêu ròng (đã trừ phần hoàn cho ảnh lỗi) */
        used: num(spending?.used_total),
        usedToday: num(spending?.used_today),
        usedLast30Days: num(spending?.used_30d),
        /** Phần tiêu từ nguồn điểm khách BỎ TIỀN MUA, không tính hạn mức tháng cũ */
        usedPurchased: num(spending?.used_purchased),
        /** Đã hoàn lại vì ảnh lỗi */
        refunded: num(spending?.refunded),
      },
      generations: {
        total: num(generations?.total),
        success: num(generations?.success),
        failed: num(generations?.failed),
        today: num(generations?.today),
        successRate: num(generations?.total) > 0 ? Math.round((num(generations?.success) / num(generations?.total)) * 1000) / 10 : 0,
        avgDurationSec: Math.round(num(generations?.avg_duration_ms) / 100) / 10,
      },
      cost: {
        apiCostUsd: Math.round(num(generations?.api_cost_usd) * 10000) / 10000,
        apiCostUsdCents: Math.round(apiCostCents),
        grossProfitUsdCents: Math.round(totalRevenue - apiCostCents),
        grossMarginPercent:
          totalRevenue > 0 ? Math.round(((totalRevenue - apiCostCents) / totalRevenue) * 1000) / 10 : 0,
        creditsPerUsd: env.creditsPerUsd,
      },
      system: {
        queue: queueStatus(),
        providers: providerStatus(),
        adminEmails: env.adminEmails,
        downloadResults: env.downloadResults,
      },
    });
  }),
);

/** Chuỗi số liệu theo ngày để vẽ biểu đồ. */
adminRouter.get(
  '/reports/daily',
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);

    const revenue = await query<RowDataPacket & { day: string; revenue: number; orders: number }>(
      `SELECT DATE(paid_at) AS day, SUM(amount_usd_cents) AS revenue, COUNT(*) AS orders
         FROM orders
        WHERE status = 'paid' AND paid_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY DATE(paid_at)`,
      [days],
    );

    const images = await query<RowDataPacket & { day: string; total: number; success: number; tokens: number; cost: number }>(
      `SELECT DATE(created_at) AS day,
              COUNT(*) AS total,
              SUM(status = 'success') AS success,
              SUM(CASE WHEN status = 'success' THEN token_cost END) AS tokens,
              SUM(CASE WHEN status = 'success' THEN api_cost_usd END) AS cost
         FROM generations
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY DATE(created_at)`,
      [days],
    );

    const signups = await query<RowDataPacket & { day: string; total: number }>(
      `SELECT DATE(created_at) AS day, COUNT(*) AS total
         FROM users
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY DATE(created_at)`,
      [days],
    );

    // Điểm tiêu mỗi ngày đọc từ sổ cái, cùng nguồn với ô "Điểm khách đã dùng" ở
    // Tổng quan. Đếm theo generations.token_cost sẽ cho tổng biểu đồ lệch với con
    // số trên ô thống kê ngay phía trên nó.
    const spending = await query<RowDataPacket & { day: string; used: number }>(
      `SELECT DATE(created_at) AS day, -SUM(amount) AS used
         FROM token_transactions
        WHERE type IN ('spend','refund') AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY DATE(created_at)`,
      [days],
    );

    const key = (value: unknown) => new Date(value as string).toISOString().slice(0, 10);
    const revenueMap = new Map(revenue.map((row) => [key(row.day), row]));
    const imageMap = new Map(images.map((row) => [key(row.day), row]));
    const signupMap = new Map(signups.map((row) => [key(row.day), row]));
    const spendMap = new Map(spending.map((row) => [key(row.day), row]));

    // Bù các ngày không có dữ liệu để biểu đồ không bị đứt đoạn.
    const series: unknown[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - i);
      const day = date.toISOString().slice(0, 10);

      const apiCostUsd = num(imageMap.get(day)?.cost);
      series.push({
        day,
        revenueUsdCents: num(revenueMap.get(day)?.revenue),
        orders: num(revenueMap.get(day)?.orders),
        newUsers: num(signupMap.get(day)?.total),
        images: num(imageMap.get(day)?.total),
        successImages: num(imageMap.get(day)?.success),
        tokensSpent: num(spendMap.get(day)?.used),
        apiCostUsdCents: Math.round(apiCostUsd * 100),
      });
    }

    res.json({ days, series });
  }),
);

/** Thống kê theo từng model — biết model nào đang được dùng và lãi bao nhiêu. */
adminRouter.get(
  '/reports/models',
  asyncHandler(async (_req, res) => {
    const rows = await query<RowDataPacket & Record<string, any>>(
      `SELECT g.model_code, g.model_label, g.provider,
              COUNT(*)                                                        AS total,
              SUM(g.status = 'success')                                       AS success,
              COALESCE(SUM(CASE WHEN g.status = 'success' THEN g.token_cost END), 0)   AS tokens,
              COALESCE(SUM(CASE WHEN g.status = 'success' THEN g.api_cost_usd END), 0) AS cost_usd
         FROM generations g
        GROUP BY g.model_code, g.model_label, g.provider
        ORDER BY total DESC`,
    );

    res.json({
      models: rows.map((row) => {
        // Doanh thu quy đổi của số điểm đã tiêu, theo đơn giá bán.
        const tokenValueCents = num(row.tokens) * CREDIT_SELL_PRICE_CENTS;
        const costCents = num(row.cost_usd) * 100;
        return {
          modelCode: row.model_code,
          modelLabel: row.model_label,
          provider: row.provider,
          total: num(row.total),
          success: num(row.success),
          tokensSpent: num(row.tokens),
          tokenValueUsdCents: Math.round(tokenValueCents),
          apiCostUsdCents: Math.round(costCents),
          marginPercent:
            tokenValueCents > 0 ? Math.round(((tokenValueCents - costCents) / tokenValueCents) * 1000) / 10 : 0,
        };
      }),
    });
  }),
);

/** Khách hàng chi nhiều nhất. */
adminRouter.get(
  '/reports/top-users',
  asyncHandler(async (_req, res) => {
    const rows = await query<RowDataPacket & Record<string, any>>(
      `SELECT u.id, u.email, u.full_name, u.total_topup_usd_cents, u.token_balance, u.total_tokens_out,
              (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id AND g.status = 'success') AS images
         FROM users u
        ORDER BY u.total_topup_usd_cents DESC, u.total_tokens_out DESC
        LIMIT 20`,
    );

    res.json({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        totalTopupUsdCents: num(row.total_topup_usd_cents),
        tokenBalance: num(row.token_balance),
        tokensSpent: num(row.total_tokens_out),
        images: num(row.images),
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
//  QUẢN LÝ KHÁCH HÀNG
// ---------------------------------------------------------------------------

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where = search ? 'WHERE email LIKE ? OR full_name LIKE ? OR phone LIKE ?' : '';
    const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

    const rows = await query<RowDataPacket & Record<string, any>>(
      `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.status, u.token_balance,
              u.subscription_expires_at, u.monthly_allowance, u.monthly_tokens, u.monthly_period_end,
              u.total_topup_usd_cents, u.total_tokens_in, u.total_tokens_out, u.last_login_at, u.created_at,
              u.is_affiliate, u.affiliate_code,
              (SELECT r.email FROM users r WHERE r.id = u.referred_by) AS referrer_email,
              (SELECT s.plan_name FROM subscriptions s
                 WHERE s.user_id = u.id AND s.status <> 'cancelled'
                 ORDER BY s.id DESC LIMIT 1) AS plan_name
         FROM users u ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM users u ${where}`,
      params,
    );

    res.json({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        status: row.status,
        isAffiliate: row.is_affiliate === 1,
        affiliateCode: row.affiliate_code,
        /** Email của người đã giới thiệu khách này, null nếu khách tự tìm đến. */
        referrerEmail: row.referrer_email ?? null,
        // Số dư hiển thị gộp cả hai nguồn, nhưng vẫn trả riêng từng nguồn vì thao
        // tác cộng/trừ của admin phải chọn đúng nguồn.
        tokenBalance: num(row.token_balance) + num(row.monthly_tokens),
        purchasedTokens: num(row.token_balance),
        monthlyTokens: num(row.monthly_tokens),
        monthlyAllowance: num(row.monthly_allowance),
        monthlyPeriodEnd: row.monthly_period_end,
        subscriptionExpiresAt: row.subscription_expires_at,
        planName: row.plan_name ?? null,
        totalTopupUsdCents: num(row.total_topup_usd_cents),
        tokensIn: num(row.total_tokens_in),
        tokensOut: num(row.total_tokens_out),
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      })),
      page,
      limit,
      total: total?.total ?? 0,
    });
  }),
);

/**
 * Đọc một trường tuỳ chọn: bỏ qua nếu client không gửi, nhưng cho phép gửi `null`
 * để xoá giá trị. Phân biệt "không đụng tới" và "xoá đi" là bắt buộc — nếu không,
 * form chỉ sửa số điện thoại sẽ vô tình xoá luôn ngày hết hạn gói.
 */
const hasField = (body: Record<string, unknown>, field: string) => Object.hasOwn(body, field);

/** Chuỗi ISO từ input datetime-local → Date, hoặc null để xoá. */
function optionalDate(body: Record<string, unknown>, field: string, label: string): Date | null {
  const value = body[field];
  if (value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${label} không phải ngày giờ hợp lệ.`);
  return parsed;
}

/**
 * Sửa thông tin khách hàng.
 *
 * Chỉ những trường có mặt trong body mới bị đụng tới, nên gọi với đúng
 * `{ status }` (như nút Khoá/Mở) vẫn chạy như cũ.
 *
 * KHÔNG sửa được `role`: quyền admin suy ra từ `ADMIN_EMAILS` trong .env ở mỗi lần
 * đọc phiên đăng nhập, nên ghi vào cột `role` sẽ bị ghi đè ngay lần khởi động sau.
 */
adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const current = await queryOne<RowDataPacket & { email: string; status: string }>(
      'SELECT email, status FROM users WHERE id = ?',
      [userId],
    );
    if (!current) throw notFound('Không tìm thấy tài khoản.');

    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      params.push(value);
    };

    if (hasField(body, 'fullName')) set('full_name', optionalString(body, 'fullName', 190));
    if (hasField(body, 'phone')) set('phone', optionalString(body, 'phone', 32));

    if (hasField(body, 'email')) {
      const email = requireEmail(body, 'email');
      if (email !== current.email.toLowerCase()) {
        // Quyền admin gắn với email trong .env. Đổi email của một admin qua giao diện
        // là tự tước quyền chính mình mà .env vẫn ghi email cũ — sửa .env rồi restart.
        if (isAdminEmail(current.email)) {
          throw badRequest(
            `${current.email} đang nằm trong ADMIN_EMAILS. Sửa email trong file .env rồi khởi động lại server, ` +
              'đừng đổi ở đây kẻo mất quyền admin.',
          );
        }
        const taken = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM users WHERE email = ?', [email]);
        if (taken) throw badRequest(`Email ${email} đã có tài khoản khác dùng.`);
        set('email', email);
      }
    }

    if (hasField(body, 'status')) {
      const status = requireString(body, 'status', { label: 'Status' });
      if (!['active', 'banned'].includes(status)) throw badRequest('Trạng thái chỉ nhận "active" hoặc "banned".');
      // Tự khoá chính mình là mất quyền vào bảng điều khiển ngay lập tức, và chỉ mở
      // lại được bằng cách sửa thẳng vào cơ sở dữ liệu.
      if (status === 'banned' && userId === req.user!.id) throw badRequest('Không thể tự khoá tài khoản của chính bạn.');
      set('status', status);
    }

    if (hasField(body, 'subscriptionExpiresAt')) {
      set('subscription_expires_at', optionalDate(body, 'subscriptionExpiresAt', 'Ngày hết hạn gói'));
    }

    // Hạ trần hạn mức phải kéo cả số dư xuống theo, nếu không giao diện của khách
    // hiện "120.000 / 50.000". Nhưng số dư chỉ được đổi kèm một dòng sổ cái, nên
    // phần này làm riêng trong transaction ở dưới chứ không nhét vào câu UPDATE.
    const allowance = hasField(body, 'monthlyAllowance')
      ? requireInt(body, 'monthlyAllowance', { min: 0, max: 100_000_000, label: 'Monthly allowance' })
      : null;
    if (allowance !== null) set('monthly_allowance', allowance);

    if (hasField(body, 'monthlyPeriodEnd')) {
      set('monthly_period_end', optionalDate(body, 'monthlyPeriodEnd', 'Ngày cấp lại hạn mức'));
    }

    if (fields.length === 0) throw badRequest('Không có thông tin nào để cập nhật.');

    await withTransaction(async (conn) => {
      await conn.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, userId]);

      if (allowance === null) return;

      // Đọc qua lockAccountState chứ không SELECT thẳng: hàm này có thể vừa cấp lại
      // hạn mức cho chu kỳ mới, và khi đó số dư đã bằng đúng trần mới rồi. SELECT
      // thẳng sẽ lấy con số trước khi cấp lại và trừ thừa đúng bằng phần chênh.
      const state = await lockAccountState(conn, userId);
      const excess = state.monthlyTokens - allowance;
      if (excess <= 0) return;

      await adjustMonthlyTokens(conn, {
        userId,
        amount: -excess,
        description: `[Admin] Hạ hạn mức tháng xuống ${allowance.toLocaleString('vi-VN')} điểm, thu hồi phần vượt trần`,
        createdBy: req.user!.id,
      });
    });

    res.json({ ok: true });
  }),
);

/**
 * Đặt lại mật khẩu cho khách (khách quên mật khẩu, hỗ trợ qua điện thoại).
 *
 * Admin đặt mật khẩu mới rồi báo lại cho khách — hệ thống chưa có luồng gửi email
 * khôi phục nên đây là đường duy nhất.
 */
adminRouter.post(
  '/users/:id/password',
  asyncHandler(async (req, res) => {
    const password = requireString(req.body, 'password', { min: 8, max: 72, label: 'New password' });

    const result = await execute('UPDATE users SET password_hash = ? WHERE id = ?', [
      await hashPassword(password),
      Number(req.params.id),
    ]);
    if (result.affectedRows === 0) throw notFound('Không tìm thấy tài khoản.');
    res.json({ ok: true });
  }),
);

/**
 * Cộng / trừ điểm thủ công (đền bù, khuyến mãi, thu hồi).
 *
 * `bucket` mặc định là `purchased` để các lần gọi cũ giữ nguyên hành vi.
 */
adminRouter.post(
  '/users/:id/tokens',
  asyncHandler(async (req, res) => {
    const amount = requireInt(req.body, 'amount', { label: 'Credit amount' });
    if (amount === 0) throw badRequest('Số điểm phải khác 0.');
    const reason = requireString(req.body, 'reason', { label: 'Reason', max: 200 });

    const bucket = optionalString(req.body, 'bucket') ?? 'purchased';
    if (!['monthly', 'purchased'].includes(bucket)) {
      throw badRequest('Nguồn điểm chỉ nhận "monthly" (hạn mức tháng) hoặc "purchased" (điểm mua thêm).');
    }

    const userId = Number(req.params.id);
    const result = await withTransaction((conn) =>
      bucket === 'monthly'
        ? adjustMonthlyTokens(conn, {
            userId,
            amount,
            description: `[Admin] ${reason}`,
            createdBy: req.user!.id,
          })
        : creditPurchasedTokens(conn, {
            userId,
            amount,
            type: 'adjust',
            description: `[Admin] ${reason}`,
            createdBy: req.user!.id,
          }),
    );

    res.json({ ok: true, bucket, balanceAfter: result.balanceAfter, tokenBalance: result.balanceAfter });
  }),
);

/**
 * Cấp gói dịch vụ thẳng cho khách, không qua đơn thanh toán.
 *
 * Dùng khi khách trả tiền ngoài luồng Stripe (thu tiền mặt,
 * hợp đồng riêng), khi tặng gói dùng thử, hoặc khi bật **gói miễn phí** — gói 0đ
 * không có hạn mức tháng, chỉ mở khoá tài khoản để khách mua điểm lẻ.
 *
 * Chạy qua đúng `activateSubscription` mà đơn đã thanh toán vẫn dùng, nên bản ghi
 * trong bảng `subscriptions` và các dòng sổ cái hạn mức giống hệt luồng mua bình
 * thường. Khác biệt duy nhất: `order_id` để NULL và không cộng `total_topup_usd_cents`,
 * vì đây không phải doanh thu — báo cáo không được tính khống.
 *
 * `mode`:
 *   - `extend`  (mặc định) — còn hạn thì nối tiếp vào ngày hết hạn cũ, giữ nguyên
 *                hạn mức đang dùng dở của chu kỳ hiện tại.
 *   - `restart` — tính lại từ bây giờ và cấp hạn mức mới ngay. Dùng khi đổi sang
 *                gói khác chứ không phải gia hạn gói cũ.
 */
adminRouter.post(
  '/users/:id/subscription',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const planId = requireInt(req.body, 'planId', { min: 1, label: 'Plan' });

    const mode = optionalString(req.body, 'mode') ?? 'extend';
    if (!['extend', 'restart'].includes(mode)) {
      throw badRequest('Kiểu cấp gói chỉ nhận "extend" (nối tiếp) hoặc "restart" (tính lại từ hôm nay).');
    }

    // Bỏ trống = dùng đúng chu kỳ của gói. Cho sửa để còn tặng thử 1 tháng của một
    // gói vốn bán theo năm, hoặc bù thêm tháng cho khách bị gián đoạn dịch vụ.
    const months =
      req.body?.months === undefined || req.body?.months === null || req.body?.months === ''
        ? null
        : requireInt(req.body, 'months', { min: 1, max: 120, label: 'Months' });

    const user = await queryOne<RowDataPacket & { email: string }>('SELECT email FROM users WHERE id = ?', [userId]);
    if (!user) throw notFound('Không tìm thấy tài khoản.');

    // Không lọc `is_active`: gói miễn phí và các gói đã ngừng bán vẫn phải cấp tay được.
    const plan = await queryOne<PlanRow>('SELECT * FROM subscription_plans WHERE id = ?', [planId]);
    if (!plan) throw notFound('Không tìm thấy gói dịch vụ.');

    const activated = await withTransaction((conn) =>
      activateSubscription(
        conn,
        userId,
        {
          id: plan.id,
          code: plan.code,
          name: plan.name,
          months: months ?? plan.months,
          priceUsdCents: plan.price_usd_cents,
          allowance: plan.monthly_token_allowance,
        },
        null,
        { restart: mode === 'restart' },
      ),
    );

    res.json({
      ok: true,
      email: user.email,
      planName: plan.name,
      months: months ?? plan.months,
      monthlyAllowance: plan.monthly_token_allowance,
      startedAt: activated.startedAt,
      expiresAt: activated.expiresAt,
      isRenewal: activated.isRenewal,
    });
  }),
);

/**
 * Cấp / thu hồi vai trò cộng tác viên tiếp thị liên kết.
 *
 * Khác hẳn quyền admin: quyền admin gắn với `ADMIN_EMAILS` trong `.env` và không
 * sửa được từ giao diện, còn vai trò affiliate là một cờ trong cơ sở dữ liệu nên
 * cấp phát ngay tại đây. Thu hồi chỉ dừng phát sinh hoa hồng MỚI — các khoản đã
 * ghi nhận vẫn còn nguyên và vẫn phải chi trả.
 */
adminRouter.post(
  '/users/:id/affiliate',
  asyncHandler(async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const userId = Number(req.params.id);

    const user = await queryOne<RowDataPacket & { email: string }>('SELECT email FROM users WHERE id = ?', [userId]);
    if (!user) throw notFound('Không tìm thấy tài khoản.');

    const { code } = await setAffiliateRole(userId, enabled);
    res.json({
      ok: true,
      email: user.email,
      isAffiliate: enabled,
      affiliateCode: code,
      referralLink: enabled && code ? buildReferralLink(code, requestOrigin(req)) : null,
    });
  }),
);

// ---------------------------------------------------------------------------
//  TIẾP THỊ LIÊN KẾT
// ---------------------------------------------------------------------------

/**
 * Cấu hình chương trình + một ví dụ tính trên gói điểm đang bán.
 *
 * Ví dụ do server tính chứ không phải giao diện tự nhân chia: chỉ có một công
 * thức duy nhất (`computeCommission`) nên con số admin nhìn thấy trước khi lưu
 * luôn đúng bằng con số sẽ được ghi vào sổ.
 */
adminRouter.get(
  '/affiliate/settings',
  asyncHandler(async (_req, res) => {
    const settings = await readAffiliateSettings();
    const sample = await queryOne<PackageRow>(
      'SELECT * FROM token_packages WHERE is_active = 1 ORDER BY is_popular DESC, sort_order, price_usd_cents LIMIT 1',
    );

    res.json({
      settings,
      example: sample
        ? {
            packageName: sample.name,
            tokens: sample.base_tokens + sample.bonus_tokens,
            ...computeCommission(
              { revenueUsdCents: sample.price_usd_cents, tokensDelivered: sample.base_tokens + sample.bonus_tokens },
              settings,
            ),
          }
        : null,
    });
  }),
);

adminRouter.patch(
  '/affiliate/settings',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const number = (field: string) => (body[field] === undefined ? undefined : Number(body[field]));

    const settings = await saveAffiliateSettings({
      enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      commissionPercent: number('commissionPercent'),
      fixedCostUsdCents: number('fixedCostUsdCents'),
      fixedCostPercent: number('fixedCostPercent'),
    });

    res.json({ ok: true, settings });
  }),
);

/** Danh sách cộng tác viên kèm số liệu tích luỹ. */
adminRouter.get(
  '/affiliate/affiliates',
  asyncHandler(async (req, res) => {
    const origin = requestOrigin(req);
    const rows = await query<RowDataPacket & Record<string, any>>(
      `SELECT id, email, full_name, affiliate_code, status, created_at
         FROM users WHERE is_affiliate = 1 ORDER BY id DESC`,
    );

    // Vòng lặp tuần tự thay vì Promise.all: danh sách cộng tác viên luôn nhỏ, và
    // mỗi lượt `readAffiliateStats` chạy hai câu tổng hợp — bắn song song hàng
    // chục lượt chỉ để tiết kiệm vài mili giây là chiếm hết pool kết nối.
    const affiliates: unknown[] = [];
    for (const row of rows) {
      affiliates.push({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        status: row.status,
        code: row.affiliate_code,
        referralLink: row.affiliate_code ? buildReferralLink(row.affiliate_code, origin) : null,
        createdAt: row.created_at,
        stats: await readAffiliateStats(row.id),
      });
    }

    res.json({ affiliates });
  }),
);

/** Sổ hoa hồng toàn hệ thống. Lọc theo trạng thái chi trả hoặc theo một cộng tác viên. */
adminRouter.get(
  '/affiliate/commissions',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const affiliateId = Number(req.query.affiliateId) || 0;

    const filters: string[] = [];
    const params: unknown[] = [];
    if (['pending', 'paid', 'cancelled'].includes(status)) {
      filters.push('c.status = ?');
      params.push(status);
    }
    if (affiliateId > 0) {
      filters.push('c.affiliate_user_id = ?');
      params.push(affiliateId);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = await query<CommissionRow & { affiliate_email: string; customer_email: string }>(
      `SELECT c.*, a.email AS affiliate_email, b.email AS customer_email
         FROM affiliate_commissions c
         JOIN users a ON a.id = c.affiliate_user_id
         JOIN users b ON b.id = c.referred_user_id
         ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const totals = await queryOne<RowDataPacket & Record<string, number>>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN c.status = 'pending' THEN c.commission_usd_cents END), 0) AS pending,
              COALESCE(SUM(CASE WHEN c.status = 'paid'    THEN c.commission_usd_cents END), 0) AS paid
         FROM affiliate_commissions c ${where}`,
      params,
    );

    res.json({
      commissions: rows.map((row) => ({
        ...serializeCommission(row),
        affiliate: { id: row.affiliate_user_id, email: row.affiliate_email },
        customer: { id: row.referred_user_id, email: row.customer_email },
      })),
      page,
      limit,
      total: num(totals?.total),
      pendingUsdCents: num(totals?.pending),
      paidUsdCents: num(totals?.paid),
    });
  }),
);

/**
 * Đổi trạng thái chi trả của một khoản hoa hồng.
 *
 * `cancelled` dùng cho đơn bị hoàn tiền hoặc gian lận (tự đăng ký bằng link của
 * chính mình); khoản đã huỷ bị loại khỏi mọi con số tổng hợp nhưng dòng ghi vẫn
 * còn để tra soát.
 */
adminRouter.post(
  '/affiliate/commissions/:id/status',
  asyncHandler(async (req, res) => {
    const status = requireString(req.body, 'status', { label: 'Status' });
    if (!['pending', 'paid', 'cancelled'].includes(status)) {
      throw badRequest('Trạng thái chỉ nhận "pending", "paid" hoặc "cancelled".');
    }

    const result = await execute(
      `UPDATE affiliate_commissions
          SET status = ?,
              paid_at = ${status === 'paid' ? 'COALESCE(paid_at, NOW())' : 'NULL'},
              paid_by = ?,
              note = COALESCE(?, note)
        WHERE id = ?`,
      [status, status === 'paid' ? req.user!.id : null, optionalString(req.body, 'note', 255), Number(req.params.id)],
    );
    if (result.affectedRows === 0) throw notFound('Không tìm thấy khoản hoa hồng.');

    res.json({ ok: true, status });
  }),
);

/** Chốt sổ: đánh dấu đã trả toàn bộ khoản đang chờ của một cộng tác viên. */
adminRouter.post(
  '/affiliate/affiliates/:id/pay',
  asyncHandler(async (req, res) => {
    const affiliateId = Number(req.params.id);

    const pending = await queryOne<RowDataPacket & { total: number; amount: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(commission_usd_cents), 0) AS amount
         FROM affiliate_commissions WHERE affiliate_user_id = ? AND status = 'pending'`,
      [affiliateId],
    );
    if (num(pending?.total) === 0) throw badRequest('Cộng tác viên này không có khoản nào đang chờ chi trả.');

    await execute(
      `UPDATE affiliate_commissions
          SET status = 'paid', paid_at = NOW(), paid_by = ?, note = COALESCE(?, note)
        WHERE affiliate_user_id = ? AND status = 'pending'`,
      [req.user!.id, optionalString(req.body, 'note', 255), affiliateId],
    );

    res.json({ ok: true, count: num(pending?.total), amountUsdCents: num(pending?.amount) });
  }),
);

// ---------------------------------------------------------------------------
//  QUẢN LÝ ĐƠN NẠP
// ---------------------------------------------------------------------------

adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const filters: string[] = [];
    const params: unknown[] = [];
    if (['pending', 'paid', 'cancelled', 'expired'].includes(status)) {
      filters.push('o.status = ?');
      params.push(status);
    }
    if (search) {
      filters.push('(o.code LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = await query<OrderRow & { email: string; full_name: string | null }>(
      `SELECT o.*, u.email, u.full_name
         FROM orders o JOIN users u ON u.id = o.user_id
         ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM orders o JOIN users u ON u.id = o.user_id ${where}`,
      params,
    );

    res.json({
      orders: rows.map((row) => ({
        ...serializeOrder(row),
        user: { id: row.user_id, email: row.email, fullName: row.full_name },
      })),
      page,
      limit,
      total: total?.total ?? 0,
    });
  }),
);

/** Duyệt tay đơn nạp — dùng khi khách trả tiền ngoài Stripe, hoặc cứu giao dịch thất lạc. */
adminRouter.post(
  '/orders/:code/approve',
  asyncHandler(async (req, res) => {
    const outcome = await markOrderPaid(req.params.code, {
      source: 'manual',
      paymentRef: optionalString(req.body, 'paymentRef'),
      approvedBy: req.user!.id,
      note: optionalString(req.body, 'note', 500),
    });

    if (!outcome.ok) throw badRequest(outcome.message, outcome.reason);
    res.json({ ok: true, order: serializeOrder(outcome.order), tokensCredited: outcome.tokensCredited });
  }),
);

adminRouter.post(
  '/orders/:code/cancel',
  asyncHandler(async (req, res) => {
    const result = await execute(`UPDATE orders SET status = 'cancelled' WHERE code = ? AND status = 'pending'`, [
      req.params.code,
    ]);
    if (result.affectedRows === 0) throw badRequest('Chỉ huỷ được đơn đang chờ thanh toán.');
    res.json({ ok: true });
  }),
);

/** Nhật ký webhook Stripe — tra khi khách báo đã trả tiền mà chưa nhận điểm. */
adminRouter.get(
  '/payment-events',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);
    const rows = await query<RowDataPacket & Record<string, any>>(
      'SELECT * FROM payment_events ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );

    res.json({
      events: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        externalId: row.external_id,
        orderCode: row.order_code,
        amountUsdCents: num(row.amount_usd_cents),
        content: row.content,
        status: row.status,
        message: row.message,
        createdAt: row.created_at,
      })),
      page,
      limit,
    });
  }),
);

// ---------------------------------------------------------------------------
//  BẢNG GIÁ MODEL
// ---------------------------------------------------------------------------

adminRouter.get(
  '/pricing',
  asyncHandler(async (_req, res) => {
    const rows = await query<ModelPricingRow>('SELECT * FROM model_pricing ORDER BY sort_order, code');
    res.json({
      models: rows.map((row) => ({
        id: row.id,
        code: row.code,
        provider: row.provider,
        providerModel: row.provider_model,
        label: row.label,
        family: row.family,
        resolution: row.resolution,
        apiCostUsd: Number(row.api_cost_usd),
        apiCostUsdCents: Math.round(Number(row.api_cost_usd) * 100),
        tokenCost: row.token_cost,
        // Doanh thu của một ảnh, quy theo đơn giá bán mỗi điểm.
        sellPriceUsdCents: Math.round(row.token_cost * CREDIT_SELL_PRICE_CENTS),
        marginPercent: (() => {
          const sell = row.token_cost * CREDIT_SELL_PRICE_CENTS;
          if (sell <= 0) return 0;
          return Math.round(((sell - Number(row.api_cost_usd) * 100) / sell) * 1000) / 10;
        })(),
        isActive: Boolean(row.is_active),
        isEstimateReference: Boolean(row.is_estimate_reference),
        sortOrder: row.sort_order,
        notes: row.notes,
      })),
      creditsPerUsd: env.creditsPerUsd,
    });
  }),
);

/** Thêm model mới (nhà cung cấp khác, model mới ra mắt...). */
adminRouter.post(
  '/pricing',
  asyncHandler(async (req, res) => {
    const result = await execute(
      `INSERT INTO model_pricing
         (code, provider, provider_model, label, family, resolution, api_cost_usd, token_cost, sort_order, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requireString(req.body, 'code', { label: 'Model code', max: 80 }),
        requireString(req.body, 'provider', { label: 'Provider', max: 50 }),
        requireString(req.body, 'providerModel', { label: 'Provider slug', max: 120 }),
        requireString(req.body, 'label', { label: 'Display name', max: 120 }),
        requireString(req.body, 'family', { label: 'Model family', max: 80 }),
        requireString(req.body, 'resolution', { label: 'Resolution', max: 16 }),
        Number(req.body.apiCostUsd) || 0,
        requireInt(req.body, 'tokenCost', { min: 1, label: 'Credit cost' }),
        Number(req.body.sortOrder) || 0,
        optionalString(req.body, 'notes', 255),
      ],
    );
    res.status(201).json({ ok: true, id: result.insertId });
  }),
);

adminRouter.patch(
  '/pricing/:id',
  asyncHandler(async (req, res) => {
    const allowed: Record<string, string> = {
      providerModel: 'provider_model',
      provider: 'provider',
      label: 'label',
      resolution: 'resolution',
      apiCostUsd: 'api_cost_usd',
      tokenCost: 'token_cost',
      isActive: 'is_active',
      sortOrder: 'sort_order',
      notes: 'notes',
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (req.body[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(key === 'isActive' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }

    /*
     * Mốc quy đổi số ảnh là cờ ĐỘC NHẤT: bật ở một model thì phải tắt ở mọi model
     * khác. Để hai dòng cùng bật thì `pickReferenceModel` lấy dòng nào tuỳ thứ tự
     * trả về của database — số ảnh trên thẻ gói đổi thất thường mà không ai hiểu
     * vì sao. Vì vậy chạy trong transaction chung với câu UPDATE chính.
     */
    const setsReference = req.body.isEstimateReference !== undefined;
    const makeReference = Boolean(req.body.isEstimateReference);

    if (sets.length === 0 && !setsReference) throw badRequest('Không có trường nào để cập nhật.');

    const id = Number(req.params.id);
    const affected = await withTransaction(async (conn) => {
      if (setsReference && makeReference) {
        await conn.query('UPDATE model_pricing SET is_estimate_reference = 0 WHERE id <> ?', [id]);
      }

      const columns = [...sets];
      const values = [...params];
      if (setsReference) {
        columns.push('is_estimate_reference = ?');
        values.push(makeReference ? 1 : 0);
      }

      const [result] = await conn.query<ResultSetHeader>(
        `UPDATE model_pricing SET ${columns.join(', ')} WHERE id = ?`,
        [...values, id],
      );

      /*
       * Tắt bán chính model đang làm mốc thì phải chuyển mốc sang model khác.
       *
       * Bảng giá công khai chỉ trả về model đang bán, nên để mốc nằm ở một model
       * đã tắt là phía khách không thấy nó và số ảnh lặng lẽ rơi về model dự
       * phòng — admin sửa "Điểm thu" của model mốc mãi mà con số ngoài trang
       * không nhúc nhích, không có cách nào đoán ra vì sao.
       *
       * Chuyển sang model đang bán RẺ NHẤT: nó cho con số ảnh lớn nhất, tức là
       * lựa chọn ít gây hụt hẫng nhất cho khách đang xem dở trang bán hàng.
       */
      const turnedOff = req.body.isActive !== undefined && !req.body.isActive;
      if (turnedOff && !makeReference) {
        const [stranded] = await conn.query<RowDataPacket[]>(
          'SELECT 1 FROM model_pricing WHERE id = ? AND is_estimate_reference = 1',
          [id],
        );

        if (stranded.length > 0) {
          const [heir] = await conn.query<(RowDataPacket & { id: number })[]>(
            `SELECT id FROM model_pricing
              WHERE is_active = 1 AND token_cost > 0 AND id <> ?
              ORDER BY token_cost ASC LIMIT 1`,
            [id],
          );

          // Không còn model nào đang bán thì giữ nguyên mốc cũ: xoá đi cũng chẳng
          // có gì thay thế, mà còn mất lựa chọn của admin khi họ bật bán trở lại.
          if (heir[0]) {
            await conn.query('UPDATE model_pricing SET is_estimate_reference = 0 WHERE id = ?', [id]);
            await conn.query('UPDATE model_pricing SET is_estimate_reference = 1 WHERE id = ?', [heir[0].id]);
          }
        }
      }

      return result.affectedRows;
    });

    // affectedRows = 0 cũng xảy ra khi admin lưu lại đúng giá trị cũ, nên phải
    // hỏi lại database chứ không kết luận ngay là không tìm thấy model.
    if (affected === 0) {
      const exists = await queryOne<RowDataPacket>('SELECT 1 FROM model_pricing WHERE id = ?', [id]);
      if (!exists) throw notFound('Không tìm thấy model.');
    }
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
//  GÓI NẠP
// ---------------------------------------------------------------------------

adminRouter.get(
  '/packages',
  asyncHandler(async (_req, res) => {
    const rows = await query<PackageRow>('SELECT * FROM token_packages ORDER BY sort_order, price_usd_cents');
    res.json({
      packages: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        priceUsdCents: row.price_usd_cents,
        baseTokens: row.base_tokens,
        bonusTokens: row.bonus_tokens,
        totalTokens: row.base_tokens + row.bonus_tokens,
        // Giữ 4 chữ số thập phân: một điểm chỉ đáng khoảng 0,02 cent nên làm tròn
        // tới số nguyên là mọi gói cùng hiện ra 0.
        pricePerTokenCents:
          Math.round((row.price_usd_cents / (row.base_tokens + row.bonus_tokens)) * 10_000) / 10_000,
        description: row.description,
        isPopular: Boolean(row.is_popular),
        isActive: Boolean(row.is_active),
        sortOrder: row.sort_order,
      })),
    });
  }),
);

adminRouter.patch(
  '/packages/:id',
  asyncHandler(async (req, res) => {
    const allowed: Record<string, string> = {
      name: 'name',
      priceUsdCents: 'price_usd_cents',
      baseTokens: 'base_tokens',
      bonusTokens: 'bonus_tokens',
      description: 'description',
      isPopular: 'is_popular',
      isActive: 'is_active',
      sortOrder: 'sort_order',
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (req.body[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(['isPopular', 'isActive'].includes(key) ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    if (sets.length === 0) throw badRequest('Không có trường nào để cập nhật.');

    params.push(Number(req.params.id));
    const result = await execute(`UPDATE token_packages SET ${sets.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) throw notFound('Không tìm thấy gói nạp.');
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/packages',
  asyncHandler(async (req, res) => {
    const result = await execute(
      `INSERT INTO token_packages (code, name, price_usd_cents, base_tokens, bonus_tokens, description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        requireString(req.body, 'code', { label: 'Pack code', max: 50 }).toUpperCase(),
        requireString(req.body, 'name', { label: 'Pack name', max: 120 }),
        requireInt(req.body, 'priceUsdCents', { min: 50, label: 'Price in cents' }),
        requireInt(req.body, 'baseTokens', { min: 1, label: 'Base credits' }),
        Number(req.body.bonusTokens) || 0,
        optionalString(req.body, 'description', 255),
        Number(req.body.sortOrder) || 0,
      ],
    );
    res.status(201).json({ ok: true, id: result.insertId });
  }),
);

// ---------------------------------------------------------------------------
//  GÓI THUÊ BAO THÁNG
// ---------------------------------------------------------------------------

adminRouter.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const rows = await query<PlanRow>('SELECT * FROM subscription_plans ORDER BY sort_order, months');
    res.json({
      plans: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        months: row.months,
        priceUsdCents: row.price_usd_cents,
        pricePerMonthUsdCents: Math.round(row.price_usd_cents / row.months),
        monthlyTokenAllowance: row.monthly_token_allowance,
        // Hạn mức quy ra tiền vốn theo CREDITS_PER_USD.
        allowanceCostUsdCents: Math.round(row.monthly_token_allowance * CREDIT_COST_CENTS),
        description: row.description,
        isPopular: Boolean(row.is_popular),
        isActive: Boolean(row.is_active),
        sortOrder: row.sort_order,
      })),
    });
  }),
);

adminRouter.patch(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const allowed: Record<string, string> = {
      name: 'name',
      months: 'months',
      priceUsdCents: 'price_usd_cents',
      monthlyTokenAllowance: 'monthly_token_allowance',
      description: 'description',
      isPopular: 'is_popular',
      isActive: 'is_active',
      sortOrder: 'sort_order',
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (req.body[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(['isPopular', 'isActive'].includes(key) ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
    if (sets.length === 0) throw badRequest('Không có trường nào để cập nhật.');

    params.push(Number(req.params.id));
    const result = await execute(`UPDATE subscription_plans SET ${sets.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) throw notFound('Không tìm thấy gói dịch vụ.');
    res.json({ ok: true });
  }),
);

/** Danh sách thuê bao đang chạy, sắp xếp theo ngày hết hạn để tiện nhắc gia hạn. */
adminRouter.get(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);

    const rows = await query<RowDataPacket & Record<string, any>>(
      `SELECT u.id, u.email, u.full_name, u.subscription_expires_at, u.monthly_allowance, u.monthly_tokens,
              u.monthly_period_end, u.token_balance,
              (SELECT s.plan_name FROM subscriptions s WHERE s.user_id = u.id ORDER BY s.id DESC LIMIT 1) AS plan_name
         FROM users u
        WHERE u.subscription_expires_at IS NOT NULL
        ORDER BY (u.subscription_expires_at > NOW()) DESC, u.subscription_expires_at ASC
        LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    res.json({
      subscriptions: rows.map((row) => ({
        userId: row.id,
        email: row.email,
        fullName: row.full_name,
        planName: row.plan_name,
        expiresAt: row.subscription_expires_at,
        isActive: new Date(row.subscription_expires_at).getTime() > Date.now(),
        monthlyAllowance: num(row.monthly_allowance),
        monthlyTokens: num(row.monthly_tokens),
        monthlyPeriodEnd: row.monthly_period_end,
        purchasedTokens: num(row.token_balance),
      })),
      page,
      limit,
    });
  }),
);

// ---------------------------------------------------------------------------
//  ẢNH ĐÃ TẠO (toàn hệ thống)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/generations',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 24);
    const status = typeof req.query.status === 'string' ? req.query.status : '';

    const where = ['queued', 'processing', 'success', 'failed', 'refunded'].includes(status) ? 'WHERE g.status = ?' : '';
    const params = where ? [status] : [];

    const rows = await query<GenerationRow & { email: string }>(
      `SELECT g.*, u.email FROM generations g JOIN users u ON u.id = g.user_id
       ${where} ORDER BY g.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      generations: rows.map((row) => ({ ...serializeGeneration(row), userEmail: row.email })),
      page,
      limit,
    });
  }),
);
