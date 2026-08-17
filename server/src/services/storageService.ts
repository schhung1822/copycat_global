import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { stripRoleLabel } from './labelGuard.js';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Tối đa 12MB cho mỗi ảnh đầu vào sau khi đã giải mã base64. */
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(path.join(env.storageDir, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(env.storageDir, 'results'), { recursive: true });
}

/** Thư mục con theo tháng để một folder không phình ra quá lớn. */
function datedDir(kind: 'inputs' | 'results'): string {
  const now = new Date();
  return path.posix.join(kind, `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
}

async function writeFile(relDir: string, ext: string, data: Buffer): Promise<string> {
  const fileName = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const relPath = path.posix.join(relDir, fileName);
  const absPath = path.join(env.storageDir, relPath);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, data);
  return relPath;
}

/**
 * Lưu ảnh do client gửi lên (data URI hoặc base64 thuần) xuống ổ đĩa.
 * Trả về đường dẫn tương đối so với thư mục storage.
 */
export async function saveBase64Image(input: string, fallbackMime = 'image/jpeg'): Promise<string> {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(input.trim());
  const mime = (match?.[1] ?? fallbackMime).toLowerCase();
  const rawBase64 = match?.[2] ?? input.trim();

  const ext = MIME_EXT[mime];
  if (!ext) throw badRequest(`Unsupported image format: ${mime}`);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(rawBase64, 'base64');
  } catch {
    throw badRequest('That image file is not valid.');
  }
  if (buffer.length === 0) throw badRequest('That image file is empty.');
  if (buffer.length > MAX_INPUT_BYTES) {
    throw badRequest(`Image too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). The limit is 12MB per image.`);
  }

  return writeFile(datedDir('inputs'), ext, buffer);
}

/**
 * Tải ảnh kết quả từ nhà cung cấp về server để link không bị hết hạn.
 *
 * Cũng là nơi gỡ dải nhãn vai trò nếu model lỡ chép nó sang ảnh kết quả — đây là
 * chỗ duy nhất trong luồng có sẵn byte của ảnh. Đặt DOWNLOAD_RESULTS=false thì
 * bước dọn này không chạy được và khách có thể thấy dải nhãn.
 */
export async function downloadResult(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ảnh kết quả (HTTP ${res.status}).`);

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const extFromUrl = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
  const ext = MIME_EXT[contentType] ?? (['jpg', 'jpeg', 'png', 'webp'].includes(extFromUrl) ? extFromUrl : 'png');

  const downloaded = Buffer.from(await res.arrayBuffer());
  const { buffer, cropped } = stripRoleLabel(downloaded);
  if (cropped) console.log('[storage] Đã cắt dải nhãn vai trò khỏi ảnh kết quả.');

  return writeFile(datedDir('results'), ext, buffer);
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Đọc lại một ảnh đã lưu thành data URI để gửi cho nhà cung cấp.
 * Nhờ vậy job trong hàng đợi không phải giữ base64 trong RAM, và lệnh "vẽ lại"
 * dùng lại đúng ảnh đầu vào cũ mà không cần client upload lần nữa.
 */
export async function readAsDataUri(relPath: string): Promise<string> {
  const absPath = path.join(env.storageDir, relPath);
  if (!absPath.startsWith(env.storageDir)) throw badRequest('Invalid image path.');

  const buffer = await fs.readFile(absPath);
  const ext = path.extname(absPath).replace('.', '').toLowerCase();
  return `data:${EXT_MIME[ext] ?? 'image/jpeg'};base64,${buffer.toString('base64')}`;
}

/** Đổi đường dẫn lưu trữ thành URL client gọi được. */
export const toPublicUrl = (relPath: string | null | undefined): string | null =>
  relPath ? `/files/${relPath.split(path.sep).join('/')}` : null;

export async function deleteStoredFile(relPath: string | null | undefined): Promise<void> {
  if (!relPath) return;
  const absPath = path.join(env.storageDir, relPath);
  // Chặn path traversal nếu dữ liệu trong DB bị chỉnh sửa bất thường.
  if (!absPath.startsWith(env.storageDir)) return;
  await fs.rm(absPath, { force: true });
}
