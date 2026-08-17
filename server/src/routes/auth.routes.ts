import { Router } from 'express';
import { execute, queryOne, type RowDataPacket } from '../db.js';
import { env } from '../env.js';
import {
  AUTH_COOKIE,
  hashPassword,
  isAdminEmail,
  requireAuth,
  signToken,
  verifyPassword,
  type AuthUser,
} from '../lib/auth.js';
import { asyncHandler, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { optionalString, requireEmail, requireString } from '../lib/validate.js';
import { attachReferrer, resolveReferrer } from '../services/affiliateService.js';
import {
  checkResetToken,
  requestPasswordReset,
  resetPassword,
} from '../services/passwordResetService.js';
import { readAccountState, type AccountState } from '../services/subscriptionService.js';

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.isProd,
  maxAge: COOKIE_MAX_AGE_MS,
  path: '/',
};

type PublicUser = AuthUser & { state: AccountState };

const publicUser = (user: PublicUser) => ({
  id: user.id,
  email: user.email,
  fullName: user.full_name,
  phone: user.phone,
  role: user.role,
  createdAt: user.created_at,

  /*
   * Tiếp thị liên kết — giao diện dựa vào đây để hiện tab Affiliate.
   *
   * Cố ý KHÔNG trả link đầy đủ ở đây: link được dựng theo tên miền của request
   * đang gọi (xem `requestOrigin`), mà hàm này là một bộ tuần tự thuần không cầm
   * request. Trang Affiliate lấy link từ `/affiliate/summary`.
   */
  isAffiliate: user.is_affiliate === 1,
  affiliateCode: user.affiliate_code,

  // Thuê bao và hạn mức — giao diện dựa vào đây để mở/khoá chức năng tạo ảnh.
  isSubscribed: user.state.isSubscribed,
  subscriptionExpiresAt: user.state.subscriptionExpiresAt,
  monthlyAllowance: user.state.monthlyAllowance,
  monthlyTokens: user.state.monthlyTokens,
  monthlyPeriodEnd: user.state.monthlyPeriodEnd,
  purchasedTokens: user.state.purchasedTokens,
  tokenBalance: user.state.availableTokens,
});

async function loadPublicUser(userId: number): Promise<PublicUser> {
  const user = await queryOne<AuthUser>(
    `SELECT id, email, full_name, phone, role, status, is_affiliate, affiliate_code, token_balance, created_at
       FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) throw unauthorized();
  user.role = isAdminEmail(user.email) ? 'admin' : 'user';
  return Object.assign(user, { state: await readAccountState(userId) });
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body);
    const password = requireString(req.body, 'password', { label: 'Password', min: 6, max: 100 });
    const fullName = optionalString(req.body, 'fullName');
    const phone = optionalString(req.body, 'phone', 32);
    /*
     * Mã giới thiệu lấy từ link `…/?ref=MÃ` khách đã bấm vào.
     *
     * Tra người giới thiệu TRƯỚC khi tạo tài khoản, nhưng mã sai không chặn đăng
     * ký: khách gõ tay thiếu một ký tự thì vẫn phải vào được hệ thống, chỉ là
     * không ai được ghi công.
     */
    const referrerId = await resolveReferrer(optionalString(req.body, 'ref', 32));

    const existing = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) throw conflict('An account with this email already exists.', 'email_taken');

    const role = isAdminEmail(email) ? 'admin' : 'user';
    const freeTokens = Number(
      (await queryOne<RowDataPacket & { setting_value: string }>(
        "SELECT setting_value FROM settings WHERE setting_key = 'free_tokens_on_signup'",
      ))?.setting_value ?? 0,
    );

    const result = await execute(
      'INSERT INTO users (email, password_hash, full_name, phone, role) VALUES (?, ?, ?, ?, ?)',
      [email, await hashPassword(password), fullName, phone, role],
    );

    await attachReferrer(result.insertId, referrerId);

    // Token tặng khi đăng ký (mặc định 0, admin bật trong bảng settings).
    if (Number.isFinite(freeTokens) && freeTokens > 0) {
      const { creditPurchasedStandalone } = await import('../services/tokenService.js');
      await creditPurchasedStandalone({
        userId: result.insertId,
        amount: Math.trunc(freeTokens),
        type: 'adjust',
        description: 'Welcome credits',
      });
    }

    const user = await loadPublicUser(result.insertId);
    const token = signToken(user.id);
    res.cookie(AUTH_COOKIE, token, cookieOptions);
    res.status(201).json({ user: publicUser(user), token });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body);
    const password = requireString(req.body, 'password', { label: 'Password' });

    const row = await queryOne<AuthUser & { password_hash: string }>('SELECT * FROM users WHERE email = ?', [email]);
    // Thông điệp giống nhau cho cả hai trường hợp để không lộ email nào đã tồn tại.
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw unauthorized('Incorrect email or password.');
    }
    if (row.status === 'banned') throw forbidden('Your account has been suspended.');

    await execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);

    const user = await loadPublicUser(row.id);
    const token = signToken(user.id);
    res.cookie(AUTH_COOKIE, token, cookieOptions);
    res.json({ user: publicUser(user), token });
  }),
);

/**
 * Quên mật khẩu — nhận email HOẶC số điện thoại đã đăng ký.
 *
 * LUÔN trả về `{ ok: true }`, dù tài khoản có tồn tại hay không, gửi mail được
 * hay không. Nếu phản hồi khác nhau giữa hai trường hợp thì bất kỳ ai cũng dùng
 * được endpoint này để dò xem email/số điện thoại nào đã đăng ký ở đây.
 */
authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const identifier = requireString(req.body, 'identifier', {
      label: 'Email or phone number',
      min: 3,
      max: 190,
    });

    // Ghi IP để tra soát khi bị lạm dụng. `req.ip` đã tính sẵn theo trust proxy.
    await requestPasswordReset(identifier, req.ip ?? null);
    res.json({ ok: true });
  }),
);

/** Kiểm tra link còn dùng được không, để trang đặt lại báo hỏng ngay khi mở. */
authRouter.get(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    res.json({ valid: token ? await checkResetToken(token) : false });
  }),
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const token = requireString(req.body, 'token', { label: 'Reset token', max: 190 });
    const password = requireString(req.body, 'password', { label: 'New password', min: 6, max: 100 });

    await resetPassword(token, password);

    /*
     * Cố tình KHÔNG tự đăng nhập sau khi đổi. Ai mở được hộp thư thì đổi được
     * mật khẩu, nhưng bắt gõ lại mật khẩu mới một lần nữa ở màn đăng nhập là
     * lớp xác nhận cuối rằng người đó nhớ đúng thứ mình vừa đặt.
     */
    res.json({ ok: true });
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(await loadPublicUser(req.user!.id)) });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const fullName = optionalString(req.body, 'fullName');
    const phone = optionalString(req.body, 'phone', 32);

    await execute('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [fullName, phone, req.user!.id]);
    res.json({ user: publicUser(await loadPublicUser(req.user!.id)) });
  }),
);

authRouter.post(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const currentPassword = requireString(req.body, 'currentPassword', { label: 'Current password' });
    const newPassword = requireString(req.body, 'newPassword', { label: 'New password', min: 6, max: 100 });

    const row = await queryOne<RowDataPacket & { password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user!.id],
    );
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw unauthorized('Your current password is incorrect.');
    }

    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(newPassword), req.user!.id]);
    res.json({ ok: true });
  }),
);
