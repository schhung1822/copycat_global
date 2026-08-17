import { Router } from 'express';
import { query, queryOne, type RowDataPacket } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler } from '../lib/errors.js';
import { parsePaging } from '../lib/validate.js';
import { readAccountState, type SubscriptionRow } from '../services/subscriptionService.js';
import type { LedgerRow } from '../services/tokenService.js';

export const walletRouter = Router();

walletRouter.use(requireAuth);

/** Số dư + thống kê nhanh của ví điểm. */
walletRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await queryOne<
      RowDataPacket & {
        token_balance: number;
        total_topup_usd_cents: number;
        total_tokens_in: number;
        total_tokens_out: number;
      }
    >('SELECT token_balance, total_topup_usd_cents, total_tokens_in, total_tokens_out FROM users WHERE id = ?', [
      req.user!.id,
    ]);

    const images = await queryOne<RowDataPacket & { total: number; success: number }>(
      `SELECT COUNT(*) AS total, SUM(status = 'success') AS success FROM generations WHERE user_id = ?`,
      [req.user!.id],
    );

    const state = await readAccountState(req.user!.id);
    const subscription = await queryOne<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [req.user!.id],
    );

    res.json({
      // Tổng dùng được ngay = hạn mức tháng còn lại + điểm đã mua thêm
      tokenBalance: state.availableTokens,
      monthlyTokens: state.monthlyTokens,
      monthlyAllowance: state.monthlyAllowance,
      monthlyPeriodEnd: state.monthlyPeriodEnd,
      purchasedTokens: state.purchasedTokens,
      isSubscribed: state.isSubscribed,
      subscriptionExpiresAt: state.subscriptionExpiresAt,
      subscriptionName: subscription?.plan_name ?? null,
      totalTopupUsdCents: summary?.total_topup_usd_cents ?? 0,
      totalTokensIn: summary?.total_tokens_in ?? 0,
      totalTokensOut: summary?.total_tokens_out ?? 0,
      totalImages: Number(images?.total ?? 0),
      successImages: Number(images?.success ?? 0),
    });
  }),
);

/** Sao kê biến động điểm. */
walletRouter.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 30);

    const rows = await query<LedgerRow>(
      'SELECT * FROM token_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [req.user!.id, limit, offset],
    );
    const total = await queryOne<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM token_transactions WHERE user_id = ?',
      [req.user!.id],
    );

    res.json({
      transactions: rows.map((row) => ({
        id: row.id,
        type: row.type,
        bucket: row.bucket,
        amount: row.amount,
        balanceAfter: row.balance_after,
        description: row.description,
        refType: row.ref_type,
        refId: row.ref_id,
        createdAt: row.created_at,
      })),
      page,
      limit,
      total: total?.total ?? 0,
    });
  }),
);
