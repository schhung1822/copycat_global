/*
 * Thông điệp ở đây viết bằng tiếng Anh: phần lớn được sinh ra từ dữ liệu khách
 * gửi lên. Vài route quản trị cũng dùng chung các hàm này, nên `label` bên phía
 * admin cũng để tiếng Anh cho câu không bị nửa Việt nửa Anh.
 */
import { badRequest } from './errors.js';

type Body = Record<string, unknown>;

export function requireString(body: Body, field: string, opts: { min?: number; max?: number; label?: string } = {}): string {
  const label = opts.label ?? field;
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${label} is required.`);

  const trimmed = value.trim();
  if (opts.min && trimmed.length < opts.min) throw badRequest(`${label} must be at least ${opts.min} characters.`);
  if (opts.max && trimmed.length > opts.max) throw badRequest(`${label} must be at most ${opts.max} characters.`);
  return trimmed;
}

export function optionalString(body: Body, field: string, max = 190): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  return value.trim().slice(0, max);
}

export function requireInt(body: Body, field: string, opts: { min?: number; max?: number; label?: string } = {}): number {
  const label = opts.label ?? field;
  const value = Number(body[field]);
  if (!Number.isFinite(value) || !Number.isInteger(value)) throw badRequest(`${label} must be a whole number.`);
  if (opts.min !== undefined && value < opts.min) throw badRequest(`${label} must be ${opts.min} or more.`);
  if (opts.max !== undefined && value > opts.max) throw badRequest(`${label} must be ${opts.max} or less.`);
  return value;
}

export function requireStringArray(body: Body, field: string, opts: { max?: number; label?: string } = {}): string[] {
  const label = opts.label ?? field;
  const value = body[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${label} must be a list.`);
  if (opts.max && value.length > opts.max) throw badRequest(`${label} accepts at most ${opts.max} items.`);

  return value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') throw badRequest(`${label} contains an invalid item.`);
    return item;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireEmail(body: Body, field = 'email'): string {
  const value = requireString(body, field, { label: 'Email', max: 190 }).toLowerCase();
  if (!EMAIL_RE.test(value)) throw badRequest('That email address is not valid.');
  return value;
}

/** Đọc tham số phân trang từ query string. */
export function parsePaging(query: Record<string, unknown>, defaultLimit = 24, maxLimit = 100) {
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), maxLimit);
  const page = Math.max(Number(query.page) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}
