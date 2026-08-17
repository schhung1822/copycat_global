import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { queryOne, type RowDataPacket } from '../db.js';
import { forbidden, unauthorized } from './errors.js';

export const AUTH_COOKIE = 'copycat_token';

export interface AuthUser extends RowDataPacket {
  id: number;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  /**
   * Vai trò affiliate đứng riêng chứ không phải một giá trị của `role`: `role`
   * bị ghi đè từ ADMIN_EMAILS mỗi lần đọc phiên (xem `loadUser`), và một admin
   * cũng có thể đồng thời là affiliate.
   */
  is_affiliate: number;
  affiliate_code: string | null;
  token_balance: number;
  created_at: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 10);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Email nằm trong ADMIN_EMAILS (.env) luôn được coi là admin, kể cả khi cột role
 * trong DB chưa kịp đồng bộ. Đây là nguồn sự thật duy nhất về quyền admin.
 */
export const isAdminEmail = (email: string): boolean => env.adminEmails.includes(email.toLowerCase());

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();

  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[AUTH_COOKIE];
  return cookie ?? null;
}

async function loadUser(req: Request): Promise<AuthUser | null> {
  const token = extractToken(req);
  if (!token) return null;

  let userId: number;
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    userId = Number(payload.sub);
  } catch {
    return null;
  }
  if (!Number.isInteger(userId)) return null;

  const user = await queryOne<AuthUser>(
    `SELECT id, email, full_name, phone, role, status, is_affiliate, affiliate_code, token_balance, created_at
       FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return null;

  // .env thắng DB: đảm bảo quyền admin luôn phản ánh đúng cấu hình hiện tại.
  user.role = isAdminEmail(user.email) ? 'admin' : 'user';
  return user;
}

/** Gắn req.user nếu có token hợp lệ, không chặn request nếu chưa đăng nhập. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await loadUser(req);
    if (user) req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user ?? (await loadUser(req));
    if (!user) throw unauthorized('Your session is invalid or has expired.');
    if (user.status === 'banned') throw forbidden('Your account has been suspended.');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (error?: unknown) => {
    if (error) return next(error);
    if (req.user?.role !== 'admin') return next(forbidden('Khu vực này chỉ dành cho quản trị viên.'));
    next();
  });
}

/**
 * Khu vực dành cho cộng tác viên tiếp thị liên kết.
 *
 * Admin đi qua được mà không cần cấp cờ affiliate cho chính mình — họ vẫn phải
 * xem được trang này để hỗ trợ và kiểm chứng số liệu.
 */
export async function requireAffiliate(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (error?: unknown) => {
    if (error) return next(error);
    if (req.user?.role !== 'admin' && req.user?.is_affiliate !== 1) {
      return next(forbidden('Khu vực này chỉ dành cho cộng tác viên tiếp thị liên kết.'));
    }
    next();
  });
}
