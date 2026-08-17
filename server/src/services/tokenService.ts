import type { PoolConnection, ResultSetHeader, RowDataPacket } from '../db.js';
import { withTransaction } from '../db.js';
import { AppError, badRequest } from '../lib/errors.js';
import { lockAccountState, type AccountState } from './subscriptionService.js';

export type LedgerType = 'topup' | 'spend' | 'refund' | 'adjust' | 'grant' | 'expire';
export type Bucket = 'monthly' | 'purchased';

export interface LedgerRow extends RowDataPacket {
  id: number;
  type: LedgerType;
  bucket: Bucket;
  amount: number;
  balance_after: number;
  ref_type: string | null;
  ref_id: number | null;
  description: string | null;
  created_at: Date;
}

interface LedgerEntry {
  userId: number;
  type: LedgerType;
  bucket: Bucket;
  amount: number;
  balanceAfter: number;
  refType?: 'order' | 'generation' | null;
  refId?: number | null;
  description?: string | null;
  createdBy?: number | null;
}

async function writeLedger(conn: PoolConnection, entry: LedgerEntry): Promise<number> {
  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO token_transactions
       (user_id, type, bucket, amount, balance_after, ref_type, ref_id, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.userId,
      entry.type,
      entry.bucket,
      entry.amount,
      entry.balanceAfter,
      entry.refType ?? null,
      entry.refId ?? null,
      entry.description ?? null,
      entry.createdBy ?? null,
    ],
  );
  return result.insertId;
}

/** Số điểm đã lấy từ mỗi nguồn cho một lần chi. */
export interface TokenSplit {
  monthly: number;
  purchased: number;
}

export interface SpendResult {
  split: TokenSplit;
  state: AccountState;
}

/**
 * Trừ điểm cho một lần tạo ảnh.
 *
 * Thứ tự: **tiêu hạn mức tháng trước, điểm mua thêm sau**. Hạn mức tháng bị xoá
 * khi sang chu kỳ mới nên tiêu trước là có lợi cho khách; điểm mua thêm không hết
 * hạn nên để dành.
 *
 * Hệ thống nay chỉ bán điểm lẻ, nên với khách mới `monthlyTokens` luôn bằng 0 và
 * mọi thứ chảy qua nhánh `purchased`. Nhánh hạn mức tháng vẫn còn cho tới khi
 * những gói tháng bán trước đây hết hạn hẳn.
 *
 * Bắt buộc gọi trong transaction. `lockAccountState` đã khoá dòng users và cấp lại
 * hạn mức nếu vừa sang tháng mới.
 */
export async function spendTokens(
  conn: PoolConnection,
  userId: number,
  amount: number,
  description: string,
  refId: number | null = null,
): Promise<SpendResult> {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Số điểm không hợp lệ.');

  const state = await lockAccountState(conn, userId);

  if (state.availableTokens < amount) {
    /*
     * Chỉ tách rõ hai nguồn khi khách thật sự còn hạn mức tháng của gói cũ. Khách
     * mua điểm lẻ đọc "hạn mức tháng 0 + đã mua thêm 1.000" chỉ thấy rối, vì họ
     * không hề biết tới khái niệm hạn mức tháng.
     */
    const breakdown =
      state.monthlyTokens > 0
        ? ` (${state.monthlyTokens.toLocaleString('en-US')} monthly allowance + ${state.purchasedTokens.toLocaleString('en-US')} purchased)`
        : '';

    throw new AppError(
      402,
      `Not enough credits. This needs ${amount.toLocaleString('en-US')}, you have ${state.availableTokens.toLocaleString('en-US')}${breakdown}.`,
      'insufficient_tokens',
      {
        required: amount,
        available: state.availableTokens,
        monthlyTokens: state.monthlyTokens,
        purchasedTokens: state.purchasedTokens,
      },
    );
  }

  const fromMonthly = Math.min(state.monthlyTokens, amount);
  const fromPurchased = amount - fromMonthly;

  if (fromMonthly > 0) {
    const balanceAfter = state.monthlyTokens - fromMonthly;
    await conn.query('UPDATE users SET monthly_tokens = ? WHERE id = ?', [balanceAfter, userId]);
    await writeLedger(conn, {
      userId,
      type: 'spend',
      bucket: 'monthly',
      amount: -fromMonthly,
      balanceAfter,
      refType: refId ? 'generation' : null,
      refId,
      description,
    });
    state.monthlyTokens = balanceAfter;
  }

  if (fromPurchased > 0) {
    const balanceAfter = state.purchasedTokens - fromPurchased;
    await conn.query('UPDATE users SET token_balance = ? WHERE id = ?', [balanceAfter, userId]);
    await writeLedger(conn, {
      userId,
      type: 'spend',
      bucket: 'purchased',
      amount: -fromPurchased,
      balanceAfter,
      refType: refId ? 'generation' : null,
      refId,
      description,
    });
    state.purchasedTokens = balanceAfter;
  }

  await conn.query('UPDATE users SET total_tokens_out = total_tokens_out + ? WHERE id = ?', [amount, userId]);

  state.availableTokens = state.monthlyTokens + state.purchasedTokens;
  return { split: { monthly: fromMonthly, purchased: fromPurchased }, state };
}

/**
 * Hoàn điểm khi tạo ảnh thất bại, trả về đúng nguồn đã lấy.
 *
 * Phần hạn mức tháng bị chặn không cho vượt quá hạn mức của gói: nếu ảnh lỗi sau
 * khi đã sang chu kỳ mới thì khách đã được cấp lại hạn mức đầy, hoàn thêm nữa là
 * cấp khống. Phần điểm mua thêm luôn được hoàn đủ vì đó là tiền thật khách bỏ ra.
 */
export async function refundTokens(
  conn: PoolConnection,
  userId: number,
  split: TokenSplit,
  refId: number,
  description: string,
): Promise<void> {
  const state = await lockAccountState(conn, userId);

  if (split.monthly > 0) {
    const balanceAfter = Math.min(state.monthlyTokens + split.monthly, state.monthlyAllowance);
    const restored = balanceAfter - state.monthlyTokens;
    if (restored > 0) {
      await conn.query('UPDATE users SET monthly_tokens = ? WHERE id = ?', [balanceAfter, userId]);
      await writeLedger(conn, {
        userId,
        type: 'refund',
        bucket: 'monthly',
        amount: restored,
        balanceAfter,
        refType: 'generation',
        refId,
        description,
      });
    }
  }

  if (split.purchased > 0) {
    const balanceAfter = state.purchasedTokens + split.purchased;
    await conn.query('UPDATE users SET token_balance = ? WHERE id = ?', [balanceAfter, userId]);
    await writeLedger(conn, {
      userId,
      type: 'refund',
      bucket: 'purchased',
      amount: split.purchased,
      balanceAfter,
      refType: 'generation',
      refId,
      description,
    });
  }

  const total = split.monthly + split.purchased;
  await conn.query('UPDATE users SET total_tokens_out = GREATEST(total_tokens_out - ?, 0) WHERE id = ?', [
    total,
    userId,
  ]);
}

/**
 * Cộng điểm vào nguồn "mua thêm" — dùng cho đơn mua gói điểm lẻ và cho thao tác
 * admin điều chỉnh tay. Nguồn này không hết hạn theo chu kỳ tháng.
 */
export async function creditPurchasedTokens(
  conn: PoolConnection,
  input: {
    userId: number;
    amount: number;
    type: Extract<LedgerType, 'topup' | 'adjust'>;
    refType?: 'order' | 'generation' | null;
    refId?: number | null;
    description?: string | null;
    createdBy?: number | null;
  },
): Promise<{ balanceAfter: number; ledgerId: number }> {
  const { userId, amount } = input;
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('Số điểm không hợp lệ.');

  const [rows] = await conn.query<(RowDataPacket & { token_balance: number })[]>(
    'SELECT token_balance FROM users WHERE id = ? FOR UPDATE',
    [userId],
  );
  if (!rows[0]) throw badRequest('Không tìm thấy tài khoản.');

  const balanceAfter = rows[0].token_balance + amount;
  if (balanceAfter < 0) {
    throw new AppError(
      402,
      `Không đủ điểm đã mua để trừ. Hiện có ${rows[0].token_balance.toLocaleString('vi-VN')}, cần ${Math.abs(amount).toLocaleString('vi-VN')}.`, // chỉ admin gặp: trừ tay quá số dư
      'insufficient_tokens',
    );
  }

  await conn.query(
    `UPDATE users
        SET token_balance = ?,
            total_tokens_in = total_tokens_in + ?
      WHERE id = ?`,
    [balanceAfter, amount > 0 ? amount : 0, userId],
  );

  const ledgerId = await writeLedger(conn, { ...input, bucket: 'purchased', balanceAfter });
  return { balanceAfter, ledgerId };
}

export const creditPurchasedStandalone = (input: Parameters<typeof creditPurchasedTokens>[1]) =>
  withTransaction((conn) => creditPurchasedTokens(conn, input));

/**
 * Cộng / trừ **hạn mức tháng** thủ công (thao tác admin).
 *
 * Tách riêng khỏi `creditPurchasedTokens` vì hai nguồn có ý nghĩa khác hẳn nhau:
 * hạn mức tháng bị xoá khi sang chu kỳ mới, còn điểm mua thêm là tiền thật khách
 * đã trả. Cộng nhầm nguồn là hoặc cho không khách một khoản không bao giờ mất hạn,
 * hoặc thu hồi mất tiền khách đã mua.
 *
 * Chặn vượt trần `monthly_allowance`: cấp quá hạn mức của gói thì con số trên giao
 * diện khách ("còn 700.000 / 500.000") vô nghĩa, và sang chu kỳ sau phần dư biến mất
 * không dấu vết. Muốn cho khách nhiều hơn thì nâng hạn mức của gói, hoặc cộng vào
 * nguồn điểm mua thêm.
 */
export async function adjustMonthlyTokens(
  conn: PoolConnection,
  input: {
    userId: number;
    amount: number;
    description?: string | null;
    createdBy?: number | null;
  },
): Promise<{ balanceAfter: number; ledgerId: number }> {
  const { userId, amount } = input;
  if (!Number.isInteger(amount) || amount === 0) throw badRequest('Số điểm không hợp lệ.');

  const state = await lockAccountState(conn, userId);
  const balanceAfter = state.monthlyTokens + amount;

  if (balanceAfter < 0) {
    throw new AppError(
      402,
      `Không đủ hạn mức tháng để trừ. Hiện còn ${state.monthlyTokens.toLocaleString('vi-VN')}, ` +
        `cần trừ ${Math.abs(amount).toLocaleString('vi-VN')}.`,
      'insufficient_tokens',
    );
  }
  if (balanceAfter > state.monthlyAllowance) {
    throw badRequest(
      `Hạn mức tháng không được vượt quá ${state.monthlyAllowance.toLocaleString('vi-VN')} điểm của gói. ` +
        'Hãy nâng hạn mức của gói, hoặc cộng vào nguồn điểm mua thêm.',
    );
  }

  await conn.query('UPDATE users SET monthly_tokens = ? WHERE id = ?', [balanceAfter, userId]);
  const ledgerId = await writeLedger(conn, {
    userId,
    type: 'adjust',
    bucket: 'monthly',
    amount,
    balanceAfter,
    description: input.description ?? null,
    createdBy: input.createdBy ?? null,
  });

  return { balanceAfter, ledgerId };
}
