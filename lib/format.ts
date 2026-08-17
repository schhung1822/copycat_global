/**
 * Định dạng số, tiền và ngày giờ.
 *
 * HAI NGÔN NGỮ SỐNG CẠNH NHAU TRONG FILE NÀY:
 *   - Giao diện khách  → tiếng Anh, ngày giờ theo `en-US`.
 *   - Trang quản trị   → tiếng Việt (các bảng nhãn `*_VI` ở cuối file).
 * Cùng một con số nhưng hai nơi đọc bằng hai thứ tiếng, nên tách hẳn hàm/hằng
 * số ra thay vì truyền cờ ngôn ngữ — trộn vào một chỗ thì sớm muộn cũng có
 * chuỗi tiếng Việt lọt sang màn hình khách.
 */

const number = new Intl.NumberFormat('en-US');

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Số tiền, nhận vào **USD cent** (đơn vị lưu trong database và gửi cho Stripe).
 *
 * Chia cho 100 ngay tại đây thay vì để nơi gọi tự chia: chia rải rác khắp giao
 * diện là kiểu lỗi mà một chỗ quên chia sẽ hiện "$4,999.00" cho gói $49,99 và
 * không ai để ý cho tới khi khách hỏi.
 */
export const formatUsd = (cents: number | null | undefined): string => usd.format((Number(cents) || 0) / 100);

/** Số tiền nhỏ hơn một cent (đơn giá mỗi điểm) — cần thêm chữ số thập phân. */
export const formatUsdPrecise = (cents: number | null | undefined): string => {
  const value = (Number(cents) || 0) / 100;
  return `$${value.toFixed(value >= 0.01 ? 2 : 4)}`;
};

export const formatNumber = (value: number | null | undefined): string => number.format(Number(value) || 0);

export const formatTokens = (value: number | null | undefined): string =>
  `${number.format(Number(value) || 0)} credits`;

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

/** Đếm ngược tới thời điểm hết hạn, dạng "12:34". */
export function countdown(expiresAt: string | Date | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const target = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const remaining = target - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
//  Nhãn trạng thái — giao diện KHÁCH (tiếng Anh)
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  processing: 'Generating',
  success: 'Done',
  failed: 'Failed',
  refunded: 'Failed · refunded',
  pending: 'Awaiting payment',
  paid: 'Paid',
  cancelled: 'Cancelled',
  expired: 'Expired',
  active: 'Active',
  banned: 'Suspended',
};

export const BUCKET_LABEL: Record<string, string> = {
  monthly: 'Monthly allowance',
  purchased: 'Purchased credits',
};

export const TX_TYPE_LABEL: Record<string, string> = {
  topup: 'Credit purchase',
  spend: 'Image generation',
  refund: 'Refund',
  adjust: 'Adjustment',
  grant: 'Monthly allowance granted',
  expire: 'Monthly allowance expired',
};

// ---------------------------------------------------------------------------
//  Nhãn trạng thái — trang QUẢN TRỊ (tiếng Việt)
// ---------------------------------------------------------------------------

export const STATUS_LABEL_VI: Record<string, string> = {
  queued: 'Đang chờ',
  processing: 'Đang vẽ',
  success: 'Hoàn tất',
  failed: 'Lỗi',
  refunded: 'Lỗi · đã hoàn điểm',
  pending: 'Chờ thanh toán',
  paid: 'Đã thanh toán',
  cancelled: 'Đã huỷ',
  expired: 'Hết hạn',
  active: 'Đang hoạt động',
  banned: 'Đã khoá',
};

export const BUCKET_LABEL_VI: Record<string, string> = {
  monthly: 'Hạn mức tháng',
  purchased: 'Điểm mua thêm',
};

export const TX_TYPE_LABEL_VI: Record<string, string> = {
  topup: 'Nạp điểm',
  spend: 'Tạo ảnh',
  refund: 'Hoàn điểm',
  adjust: 'Điều chỉnh',
  grant: 'Cấp hạn mức tháng',
  expire: 'Hết hạn mức tháng',
};

/** Ngày giờ trong trang quản trị — định dạng Việt Nam. */
export function formatDateTimeVi(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateVi(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

/** Số lượng trong trang quản trị — dấu phân cách kiểu Việt Nam. */
const numberVi = new Intl.NumberFormat('vi-VN');

export const formatNumberVi = (value: number | null | undefined): string => numberVi.format(Number(value) || 0);

export const formatTokensVi = (value: number | null | undefined): string =>
  `${numberVi.format(Number(value) || 0)} điểm`;
