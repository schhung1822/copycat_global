import type { NextFunction, Request, Response, RequestHandler } from 'express';

/** Lỗi có chủ đích, thông điệp sẽ được trả thẳng cho người dùng. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, code = 'bad_request', details?: unknown) =>
  new AppError(400, message, code, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new AppError(404, message, 'not_found');
export const conflict = (message: string, code = 'conflict') => new AppError(409, message, code);

/** Bọc handler async để lỗi được đẩy về error middleware thay vì làm treo request. */
export const asyncHandler =
  <T extends RequestHandler>(handler: T): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Lỗi hay gặp từ MySQL — dịch sang thông điệp dễ hiểu.
  if (message.includes('ER_DUP_ENTRY')) {
    res.status(409).json({ error: 'That record already exists.', code: 'duplicate' });
    return;
  }

  console.error('[lỗi không mong đợi]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'internal_error' });
}
