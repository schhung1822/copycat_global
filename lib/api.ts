/**
 * Lớp gọi API duy nhất của frontend.
 *
 * Xác thực đi bằng cookie httpOnly do server đặt; token cũng được giữ trong
 * localStorage và gửi kèm header Authorization để vẫn chạy được khi web và API
 * nằm khác tên miền (lúc đó trình duyệt có thể chặn cookie).
 */

const TOKEN_KEY = 'copycat_token';

export const getStoredToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setStoredToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* trình duyệt chặn localStorage — vẫn còn cookie để xác thực */
  }
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Hết điểm — dùng để hiện nút "Buy credits" thay vì báo lỗi chung chung. */
  get isInsufficientTokens(): boolean {
    return this.code === 'insufficient_tokens';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your internet connection and try again.', 'network');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? `Server error (${response.status}).`,
      data?.code ?? 'error',
      data?.details,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Dựng query string, bỏ qua các giá trị rỗng. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}
