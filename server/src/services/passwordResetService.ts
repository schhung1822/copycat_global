import crypto from 'node:crypto';
import { execute, query, queryOne, type RowDataPacket } from '../db.js';
import { env } from '../env.js';
import { hashPassword } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { buildPasswordResetMail, isMailConfigured, sendMail } from './mailService.js';

interface ResetRow extends RowDataPacket {
  id: number;
  user_id: number;
  expires_at: Date;
  used_at: Date | null;
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  full_name: string | null;
  status: 'active' | 'banned';
}

/** Số tài khoản tối đa xử lý cho một lần yêu cầu (xem `findAccounts`). */
const MAX_MATCHES = 3;

/** Khoảng nghỉ tối thiểu giữa hai lần gửi mail cho cùng một tài khoản. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Chỉ lưu bản băm của token.
 *
 * SHA-256 chứ không phải bcrypt: token đã là 32 byte ngẫu nhiên nên không đoán
 * được bằng cách thử, thứ bcrypt sinh ra để chống. Đổi lại SHA-256 cho ra chuỗi
 * cố định 64 ký tự, tra bằng chỉ mục UNIQUE trong một lượt — bcrypt thì phải
 * quét từng dòng mà so.
 */
const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Các dạng số điện thoại có thể đã lưu trong DB cho cùng một số khách nhập.
 *
 * Khách đăng ký bằng "0912 345 678" nhưng lúc quên mật khẩu lại gõ
 * "+84912345678" là chuyện thường. So khớp cả bốn dạng phổ biến, còn dấu cách và
 * gạch nối thì để SQL gỡ.
 */
function phoneCandidates(input: string): string[] {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8) return [];

  const local = digits.startsWith('84') ? `0${digits.slice(2)}` : digits.startsWith('0') ? digits : `0${digits}`;
  const international = `84${local.slice(1)}`;

  return [...new Set([digits, local, international, `+${international}`])];
}

const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

/**
 * Tìm tài khoản theo email hoặc số điện thoại.
 *
 * Trả về DANH SÁCH chứ không phải một tài khoản: cột `phone` không có ràng buộc
 * duy nhất nên hai tài khoản có thể chung một số. Gửi mail cho tất cả tài khoản
 * khớp vẫn an toàn — mỗi mail chỉ đi tới hộp thư của chính tài khoản đó, không
 * tài khoản nào biết gì về tài khoản kia.
 */
async function findAccounts(identifier: string): Promise<UserRow[]> {
  if (isEmail(identifier)) {
    const user = await queryOne<UserRow>(
      'SELECT id, email, full_name, status FROM users WHERE email = ? LIMIT 1',
      [identifier.toLowerCase()],
    );
    return user ? [user] : [];
  }

  const candidates = phoneCandidates(identifier);
  if (candidates.length === 0) return [];

  return query<UserRow>(
    `SELECT id, email, full_name, status
       FROM users
      WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', '') IN (${candidates.map(() => '?').join(',')})
      ORDER BY id
      LIMIT ${MAX_MATCHES}`,
    candidates,
  );
}

/**
 * Nhận yêu cầu quên mật khẩu.
 *
 * KHÔNG bao giờ cho biết tài khoản có tồn tại hay không — kể cả qua thông báo
 * lỗi lẫn qua việc gọi hàm này có ném lỗi hay không. Nếu phân biệt được, trang
 * quên mật khẩu trở thành công cụ dò xem email/số điện thoại nào đã đăng ký.
 * Vì vậy hàm luôn trả về bình thường, mọi sự cố chỉ ghi vào log của server.
 */
export async function requestPasswordReset(identifier: string, requestIp: string | null): Promise<void> {
  const accounts = await findAccounts(identifier.trim());

  for (const account of accounts) {
    // Tài khoản bị khoá thì không cho đặt lại mật khẩu, nhưng vẫn im lặng.
    if (account.status === 'banned') continue;

    /*
     * Chống spam mail: vừa gửi cách đây chưa tới một phút thì bỏ qua lần này.
     * Không có nó, ai cũng bấm được nút liên tục để dội mail vào hộp thư người
     * khác, và nhà cung cấp SMTP sẽ chặn tài khoản gửi.
     */
    const recent = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM password_resets
        WHERE user_id = ? AND used_at IS NULL AND created_at > (NOW() - INTERVAL ? SECOND)`,
      [account.id, RESEND_COOLDOWN_SECONDS],
    );
    if ((recent?.total ?? 0) > 0) continue;

    // Link cũ mất hiệu lực ngay khi xin link mới: mỗi lúc chỉ một link còn sống.
    await execute('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [account.id]);

    const token = crypto.randomBytes(32).toString('base64url');
    await execute(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, request_ip)
       VALUES (?, ?, (NOW() + INTERVAL ? MINUTE), ?)`,
      [account.id, hashToken(token), env.passwordResetMinutes, requestIp],
    );

    const link = `${env.appUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    const mail = buildPasswordResetMail({
      name: account.full_name,
      link,
      minutes: env.passwordResetMinutes,
    });

    try {
      await sendMail({ ...mail, to: account.email });
    } catch (error) {
      /*
       * Gửi hỏng thì chỉ ghi log. Ném lỗi ra ngoài sẽ khiến trang báo "gửi mail
       * thất bại" cho email có thật và "đã gửi" cho email không tồn tại — đúng
       * cái rò rỉ mà cả luồng này đang tránh.
       */
      console.error(`[quên mật khẩu] không gửi được mail cho tài khoản #${account.id}:`, error);
    }
  }

  if (accounts.length > 0 && !isMailConfigured()) {
    console.error('[quên mật khẩu] SMTP chưa cấu hình nên không có mail nào được gửi. Kiểm tra SMTP_* trong .env.');
  }
}

/**
 * Đổi mật khẩu bằng token trong mail.
 *
 * Ở đây thì ngược lại: báo lỗi rõ ràng là đúng. Người dùng đang cầm một liên kết
 * hỏng và cần biết vì sao — token sai, hết hạn hay đã dùng rồi — chứ không phải
 * đoán mò. Bản thân token không tiết lộ gì về tài khoản nào cả.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const row = await queryOne<ResetRow>(
    'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? LIMIT 1',
    [hashToken(token)],
  );

  if (!row) throw badRequest('This link is not valid. Please request a new one.', 'invalid_token');
  if (row.used_at) throw badRequest('This link has already been used. Please request a new one.', 'used_token');
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw badRequest('This link has expired. Please request a new one.', 'expired_token');
  }

  const user = await queryOne<UserRow>('SELECT id, email, full_name, status FROM users WHERE id = ?', [row.user_id]);
  if (!user) throw badRequest('Account not found.', 'invalid_token');
  if (user.status === 'banned') throw badRequest('Your account has been suspended.', 'account_banned');

  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(newPassword), user.id]);

  // Vô hiệu hoá mọi link còn sống của tài khoản này, kể cả link vừa dùng.
  await execute('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
}

/**
 * Xem token còn dùng được không, để trang đặt lại mật khẩu báo hỏng NGAY khi mở
 * thay vì bắt người dùng gõ xong mật khẩu mới rồi mới biết.
 */
export async function checkResetToken(token: string): Promise<boolean> {
  const row = await queryOne<ResetRow>(
    'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? LIMIT 1',
    [hashToken(token)],
  );
  return Boolean(row && !row.used_at && new Date(row.expires_at).getTime() > Date.now());
}
