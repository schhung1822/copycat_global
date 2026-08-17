import { Router } from 'express';
import { query, queryOne, type RowDataPacket } from '../db.js';
import { requireAffiliate } from '../lib/auth.js';
import { asyncHandler } from '../lib/errors.js';
import { parsePaging } from '../lib/validate.js';
import {
  buildReferralLink,
  ensureAffiliateCode,
  maskEmail,
  readAffiliateSettings,
  readAffiliateStats,
  requestOrigin,
  serializeCommission,
  type CommissionRow,
} from '../services/affiliateService.js';

export const affiliateRouter = Router();

affiliateRouter.use(requireAffiliate);

/**
 * Trang tổng quan của cộng tác viên: link giới thiệu, tỉ lệ đang áp dụng và số
 * liệu tích luỹ.
 *
 * Mã giới thiệu được sinh ngay ở lần mở đầu tiên nếu tài khoản chưa có — admin
 * cấp quyền là đủ, không phải nhớ thêm thao tác "tạo link" nào nữa.
 */
affiliateRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const isAffiliate = me.is_affiliate === 1;

    // Admin xem trang này để hỗ trợ và đối chiếu số liệu; không sinh mã cho họ,
    // vì mã của một người chưa được cấp quyền sẽ không ai nhận diện được.
    const code = isAffiliate ? await ensureAffiliateCode(me.id) : me.affiliate_code;
    const settings = await readAffiliateSettings();

    res.json({
      isAffiliate,
      enabled: settings.enabled,
      commissionPercent: settings.commissionPercent,
      code,
      referralLink: code && isAffiliate ? buildReferralLink(code, requestOrigin(req)) : null,
      stats: await readAffiliateStats(me.id),
    });
  }),
);

/** Danh sách hoa hồng theo từng đơn. */
affiliateRouter.get(
  '/commissions',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);

    const rows = await query<CommissionRow & { email: string }>(
      `SELECT c.*, u.email
         FROM affiliate_commissions c
         JOIN users u ON u.id = c.referred_user_id
        WHERE c.affiliate_user_id = ?
        ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      [req.user!.id, limit, offset],
    );
    const total = await queryOne<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM affiliate_commissions WHERE affiliate_user_id = ?',
      [req.user!.id],
    );

    res.json({
      commissions: rows.map((row) => ({ ...serializeCommission(row), customer: maskEmail(row.email) })),
      page,
      limit,
      total: total?.total ?? 0,
    });
  }),
);

/**
 * Danh sách khách đã đăng ký từ link.
 *
 * Chỉ trả về email đã che, ngày tham gia và số tiền khách đã chi — vừa đủ để
 * cộng tác viên biết ai đang mang lại thu nhập cho mình.
 */
affiliateRouter.get(
  '/referrals',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 25);

    const rows = await query<RowDataPacket & Record<string, any>>(
      `SELECT u.id, u.email, u.created_at, u.referred_at,
              COALESCE((SELECT SUM(c.revenue_usd_cents) FROM affiliate_commissions c
                         WHERE c.referred_user_id = u.id AND c.affiliate_user_id = ?
                           AND c.status <> 'cancelled'), 0) AS revenue,
              COALESCE((SELECT SUM(c.commission_usd_cents) FROM affiliate_commissions c
                         WHERE c.referred_user_id = u.id AND c.affiliate_user_id = ?
                           AND c.status <> 'cancelled'), 0) AS commission
         FROM users u
        WHERE u.referred_by = ?
        ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [req.user!.id, req.user!.id, req.user!.id, limit, offset],
    );
    const total = await queryOne<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM users WHERE referred_by = ?',
      [req.user!.id],
    );

    res.json({
      referrals: rows.map((row) => ({
        id: row.id,
        customer: maskEmail(row.email),
        joinedAt: row.referred_at ?? row.created_at,
        revenueUsdCents: Number(row.revenue) || 0,
        commissionUsdCents: Number(row.commission) || 0,
      })),
      page,
      limit,
      total: total?.total ?? 0,
    });
  }),
);
