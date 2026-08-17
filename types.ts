// ---------------------------------------------------------------------------
//  Kiểu dữ liệu dùng chung ở frontend.
//  Các interface *Dto* khớp đúng với JSON server trả về.
// ---------------------------------------------------------------------------

/** Ảnh người dùng chọn ở trình duyệt, đã resize & nén trước khi gửi lên server. */
export interface ImageState {
  file: File | null;
  previewUrl: string | null;
  base64: string | null;
  mimeType: string | null;
  width?: number;
  height?: number;
}

export interface User {
  id: number;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: 'user' | 'admin';
  createdAt: string;

  /*
   * --- Tiếp thị liên kết ---
   * Vai trò affiliate tách khỏi `role`: quyền admin suy ra từ ADMIN_EMAILS trong
   * .env, còn affiliate do admin cấp trong trang quản trị, và một người có thể
   * vừa là admin vừa là affiliate.
   */
  isAffiliate: boolean;
  affiliateCode: string | null;

  /*
   * --- Di sản gói tháng ---
   * Gói tháng đã ngừng bán. Các trường dưới đây chỉ còn khác 0 với những khách
   * mua gói từ trước (hoặc được admin cấp tay) và đang trong thời hạn — giao
   * diện phải xử lý được cả hai trường hợp cho tới khi gói cuối cùng hết hạn.
   */
  isSubscribed: boolean;
  subscriptionExpiresAt: string | null;
  /** Hạn mức điểm được cấp mỗi tháng theo gói */
  monthlyAllowance: number;
  /** Hạn mức còn lại của chu kỳ tháng hiện tại (không cộng dồn sang tháng sau) */
  monthlyTokens: number;
  /** Thời điểm hạn mức được cấp lại */
  monthlyPeriodEnd: string | null;

  /** Điểm đã mua — không hết hạn. Đây là nguồn điểm duy nhất của khách mới. */
  purchasedTokens: number;
  /** Tổng dùng được ngay = monthlyTokens + purchasedTokens */
  tokenBalance: number;
}

export interface ModelOption {
  code: string;
  label: string;
  family: string;
  resolution: string;
  tokenCost: number;
  /** Model admin chọn làm mốc quy số điểm ra số ảnh trên thẻ gói điểm */
  isEstimateReference: boolean;
  notes: string | null;
}

export interface TokenPackage {
  id: number;
  code: string;
  name: string;
  /** Giá bán, tính bằng USD cent — trùng đúng đơn vị Stripe nhận. */
  priceUsdCents: number;
  baseTokens: number;
  bonusTokens: number;
  totalTokens: number;
  /** Đơn giá mỗi điểm tính bằng cent (số rất nhỏ, giữ 4 chữ số thập phân). */
  pricePerTokenCents: number;
  bonusPercent: number;
  description: string | null;
  isPopular: boolean;
}

export interface SiteInfo {
  companyName: string;
  companyAddress: string;
  supportEmail: string;
  supportPhone: string;
  policyUpdatedAt: string;
  /** Số phút đơn hàng còn hiệu lực, dùng trong trang Chính sách */
  orderExpireMinutes: number;
}

export interface Catalog {
  models: ModelOption[];
  packages: TokenPackage[];
  site: SiteInfo;
}

export type GenerationStatus = 'queued' | 'processing' | 'success' | 'failed' | 'refunded';

export interface Generation {
  id: number;
  batchId: string | null;
  modelCode: string;
  modelLabel: string;
  resolution: string;
  aspectRatio: string;
  prompt: string | null;
  tokenCost: number;
  status: GenerationStatus;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
  imageUrl: string | null;
  referenceUrl: string | null;
  productUrls: string[];
}

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'expired';

export interface Order {
  id: number;
  code: string;
  orderType: 'subscription' | 'token_package';
  subscriptionMonths: number | null;
  isUpgrade: boolean;
  /** Nâng gói: số tiền được khấu trừ từ phần chưa dùng của gói cũ (cent) */
  creditUsdCents: number;
  packageName: string;
  amountUsdCents: number;
  baseTokens: number;
  bonusTokens: number;
  totalTokens: number;
  status: OrderStatus;
  /** stripe | manual — cách đơn được thanh toán */
  paymentMethod: string;
  paidSource: string | null;
  paymentRef: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  note: string | null;
}

export interface TokenTransaction {
  id: number;
  type: 'topup' | 'spend' | 'refund' | 'adjust' | 'grant' | 'expire';
  bucket: 'monthly' | 'purchased';
  amount: number;
  balanceAfter: number;
  description: string | null;
  refType: string | null;
  refId: number | null;
  createdAt: string;
}

export interface WalletSummary {
  tokenBalance: number;
  monthlyTokens: number;
  monthlyAllowance: number;
  monthlyPeriodEnd: string | null;
  purchasedTokens: number;
  isSubscribed: boolean;
  subscriptionExpiresAt: string | null;
  subscriptionName: string | null;
  totalTopupUsdCents: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalImages: number;
  successImages: number;
}

// ---------------------------------------------------------------------------
//  Admin
// ---------------------------------------------------------------------------

export interface AdminOverview {
  revenue: {
    total: number;
    today: number;
    last7Days: number;
    last30Days: number;
    paidOrders: number;
    pendingOrders: number;
    averageOrderValue: number;
    subscriptionRevenue: number;
    extraTokenRevenue: number;
  };
  subscribers: {
    active: number;
    expiringIn7Days: number;
    monthlyTokensRemaining: number;
  };
  users: {
    total: number;
    newToday: number;
    new30Days: number;
    outstandingTokens: number;
    outstandingLiabilityUsdCents: number;
  };
  tokens: {
    /** Điểm đã bán ra qua các đơn đã thanh toán */
    sold: number;
    /** Đã tiêu ròng, đọc từ sổ cái và đã trừ phần hoàn cho ảnh lỗi */
    used: number;
    usedToday: number;
    usedLast30Days: number;
    /** Phần tiêu từ nguồn điểm khách bỏ tiền mua, không tính hạn mức tháng cũ */
    usedPurchased: number;
    /** Đã hoàn lại vì ảnh lỗi */
    refunded: number;
  };
  generations: {
    total: number;
    success: number;
    failed: number;
    today: number;
    successRate: number;
    avgDurationSec: number;
  };
  cost: {
    apiCostUsd: number;
    apiCostUsdCents: number;
    grossProfitUsdCents: number;
    grossMarginPercent: number;
    /** Số điểm quy ra $1 giá vốn nhà cung cấp (mặc định 10.000) */
    creditsPerUsd: number;
  };
  system: {
    /** `users` = số khách đang có ảnh chạy, để biết trần chung có bị một người chiếm hết không */
    queue: { pending: number; running: number; users: number };
    providers: { name: string; configured: boolean }[];
    adminEmails: string[];
    downloadResults: boolean;
  };
}

export interface DailyPoint {
  day: string;
  revenueUsdCents: number;
  orders: number;
  newUsers: number;
  images: number;
  successImages: number;
  tokensSpent: number;
  apiCostUsdCents: number;
}

export interface AdminUser {
  id: number;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  isAffiliate: boolean;
  affiliateCode: string | null;
  /** Email người đã giới thiệu khách này, null nếu khách tự tìm đến. */
  referrerEmail: string | null;
  /** Tổng dùng được ngay = monthlyTokens + purchasedTokens */
  tokenBalance: number;
  /** Điểm mua thêm — không hết hạn */
  purchasedTokens: number;
  /** Hạn mức tháng còn lại */
  monthlyTokens: number;
  /** Hạn mức được cấp mỗi tháng theo gói */
  monthlyAllowance: number;
  monthlyPeriodEnd: string | null;
  subscriptionExpiresAt: string | null;
  /** Tên gói của thuê bao gần nhất, null nếu chưa mua gói nào */
  planName: string | null;
  totalTopupUsdCents: number;
  tokensIn: number;
  tokensOut: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminOrder extends Order {
  user: { id: number; email: string; fullName: string | null };
}

export interface AdminModelPricing {
  id: number;
  code: string;
  provider: string;
  providerModel: string;
  label: string;
  family: string;
  resolution: string;
  apiCostUsd: number;
  apiCostUsdCents: number;
  tokenCost: number;
  sellPriceUsdCents: number;
  marginPercent: number;
  isActive: boolean;
  /** Model làm mốc quy số điểm ra số ảnh trên thẻ gói điểm — chỉ một model được bật */
  isEstimateReference: boolean;
  sortOrder: number;
  notes: string | null;
}

export interface AdminPlan {
  id: number;
  code: string;
  name: string;
  months: number;
  priceUsdCents: number;
  pricePerMonthUsdCents: number;
  /** 0 = gói không tặng điểm hàng tháng (gói miễn phí), khách chỉ dùng điểm mua thêm */
  monthlyTokenAllowance: number;
  /** Hạn mức quy ra tiền vốn, tính bằng cent */
  allowanceCostUsdCents: number;
  description: string | null;
  isPopular: boolean;
  /** Tắt = không bán trên trang bảng giá, nhưng admin vẫn cấp tay được */
  isActive: boolean;
  sortOrder: number;
}

export interface AdminPackage {
  id: number;
  code: string;
  name: string;
  priceUsdCents: number;
  baseTokens: number;
  bonusTokens: number;
  totalTokens: number;
  pricePerTokenCents: number;
  description: string | null;
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface ModelReport {
  modelCode: string;
  modelLabel: string;
  provider: string;
  total: number;
  success: number;
  tokensSpent: number;
  tokenValueUsdCents: number;
  apiCostUsdCents: number;
  marginPercent: number;
}

// ---------------------------------------------------------------------------
//  Tiếp thị liên kết
// ---------------------------------------------------------------------------

export type CommissionStatus = 'pending' | 'paid' | 'cancelled';

/**
 * Một khoản hoa hồng, chụp lại toàn bộ cách tính tại thời điểm ghi nhận:
 *
 *     lợi nhuận = doanh thu − giá vốn điểm đã bán − chi phí cố định
 *     hoa hồng  = lợi nhuận × commissionPercent
 *
 * Nhờ chụp lại mà admin đổi tỉ lệ về sau không làm sai lệch các khoản đã chốt.
 */
export interface AffiliateCommission {
  id: number;
  orderCode: string;
  revenueUsdCents: number;
  tokenCostUsdCents: number;
  fixedCostUsdCents: number;
  profitUsdCents: number;
  commissionPercent: number;
  commissionUsdCents: number;
  status: CommissionStatus;
  paidAt: string | null;
  note: string | null;
  createdAt: string;
  /** Email khách đã che bớt (trang của cộng tác viên) */
  customer: string;
}

export interface AffiliateStats {
  referrals: number;
  payingReferrals: number;
  orders: number;
  revenueUsdCents: number;
  profitUsdCents: number;
  commissionUsdCents: number;
  pendingUsdCents: number;
  /** Số khoản đang chờ — đơn không có lãi cho hoa hồng $0 nên tiền và số lượng không suy ra nhau. */
  pendingCount: number;
  paidUsdCents: number;
}

export interface AffiliateSummary {
  isAffiliate: boolean;
  /** Chương trình có đang chạy không — admin tắt được ở trang quản trị. */
  enabled: boolean;
  commissionPercent: number;
  code: string | null;
  referralLink: string | null;
  stats: AffiliateStats;
}

export interface AffiliateReferral {
  id: number;
  customer: string;
  joinedAt: string;
  revenueUsdCents: number;
  commissionUsdCents: number;
}

export interface AffiliateSettings {
  enabled: boolean;
  commissionPercent: number;
  /** Chi phí cố định trừ thẳng mỗi đơn, tính bằng cent (phí Stripe, phí xử lý...) */
  fixedCostUsdCents: number;
  /** Chi phí cố định phân bổ theo % doanh thu (hạ tầng, nhân sự, marketing...) */
  fixedCostPercent: number;
}

/** Ví dụ tính trên một gói điểm đang bán, do server tính để khớp đúng công thức thật. */
export interface AffiliateExample {
  packageName: string;
  tokens: number;
  revenueUsdCents: number;
  tokenCostUsdCents: number;
  fixedCostUsdCents: number;
  profitUsdCents: number;
  commissionPercent: number;
  commissionUsdCents: number;
}

export interface AdminAffiliate {
  id: number;
  email: string;
  fullName: string | null;
  status: 'active' | 'banned';
  code: string | null;
  referralLink: string | null;
  createdAt: string;
  stats: AffiliateStats;
}

export interface AdminCommission extends Omit<AffiliateCommission, 'customer'> {
  affiliate: { id: number; email: string };
  customer: { id: number; email: string };
}

// Tab "Webhook" đã bỏ khỏi bảng điều khiển nên không còn kiểu PaymentEvent ở
// frontend. Webhook Stripe vẫn chạy và vẫn ghi bảng `payment_events`; khi cần tra
// một giao dịch thất lạc thì gọi thẳng `GET /api/admin/payment-events` (xem README).
