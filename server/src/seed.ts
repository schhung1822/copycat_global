import { execute, query, queryOne, type RowDataPacket } from './db.js';
import { env } from './env.js';
import { hashPassword } from './lib/auth.js';

/**
 * Dữ liệu khởi tạo.
 *
 * `api_cost_usd`  = giá vốn mỗi ảnh theo bảng giá Kie.ai.
 * `token_cost`    = số điểm trừ của khách mỗi ảnh.
 *
 * QUY ƯỚC ĐƠN VỊ: **10.000 điểm = 1 USD giá vốn nhà cung cấp**, nên
 *
 *     token_cost = api_cost_usd × CREDITS_PER_USD    (mặc định 10.000)
 *
 * Nhờ vậy "$25 tiền điểm theo giá gốc" quy thẳng thành 250.000 điểm, và gói bán
 * gấp đôi giá vốn chỉ đơn giản là $1 mua được 5.000 điểm.
 *
 *   Model                    Giá vốn   Điểm/ảnh   Số ảnh với gói $49.99
 *   GPT Image 2 – 1K         $0.03        300        ~833
 *   GPT Image 2 – 2K         $0.05        500        ~500
 *   GPT Image 2 – 4K         $0.08        800        ~312
 *   Nano Banana 2 – 1K       $0.04        400        ~625
 *   Nano Banana 2 – 2K       $0.06        600        ~416
 *   Nano Banana 2 – 4K       $0.09        900        ~277
 *   Nano Banana Pro – 1K/2K  $0.09        900        ~277
 *   Nano Banana Pro – 4K     $0.12      1.200        ~208
 *
 * Đổi CREDITS_PER_USD trong .env thì phải cập nhật lại token_cost trong trang
 * Quản trị → Bảng giá cho khớp — xem chú thích trong env.ts trước khi đụng tới.
 *
 * `label` và `notes` HIỂN THỊ CHO KHÁCH ở trang tạo ảnh nên viết bằng tiếng Anh.
 * Mọi chuỗi chỉ admin nhìn thấy vẫn giữ tiếng Việt.
 *
 * `provider_model` là slug gửi lên API bên thứ 3, lấy theo tài liệu chính thức
 * (https://docs.kie.ai/llms.txt). Mỗi slug phải có đặc tả tham số tương ứng trong
 * `providers/kie.ts` vì các model dùng tên trường ảnh khác nhau
 * (`image_input` / `image_urls` / `input_urls`).
 */
const MODEL_PRICING = [
  {
    code: 'nano-banana-pro-1k',
    provider: 'kie',
    provider_model: 'nano-banana-pro',
    label: 'Nano Banana Pro — 1K',
    family: 'nano-banana-pro',
    resolution: '1K',
    api_cost_usd: 0.09,
    token_cost: 900,
    sort_order: 10,
    notes: 'Highest fidelity — follows the reference layout most closely.',
  },
  {
    code: 'nano-banana-pro-2k',
    provider: 'kie',
    provider_model: 'nano-banana-pro',
    label: 'Nano Banana Pro — 2K',
    family: 'nano-banana-pro',
    resolution: '2K',
    api_cost_usd: 0.09,
    token_cost: 900,
    sort_order: 11,
    notes: 'Same cost as the 1K version, so prefer this one.',
  },
  {
    code: 'nano-banana-pro-4k',
    provider: 'kie',
    provider_model: 'nano-banana-pro',
    label: 'Nano Banana Pro — 4K',
    family: 'nano-banana-pro',
    resolution: '4K',
    api_cost_usd: 0.12,
    token_cost: 1200,
    sort_order: 12,
    notes: 'Maximum resolution — use this one for print.',
  },
  {
    code: 'nano-banana-2-1k',
    provider: 'kie',
    provider_model: 'nano-banana-2',
    label: 'Nano Banana 2 — 1K',
    family: 'nano-banana-2',
    resolution: '1K',
    api_cost_usd: 0.04,
    token_cost: 400,
    sort_order: 20,
    notes: null,
  },
  {
    code: 'nano-banana-2-2k',
    provider: 'kie',
    provider_model: 'nano-banana-2',
    label: 'Nano Banana 2 — 2K',
    family: 'nano-banana-2',
    resolution: '2K',
    api_cost_usd: 0.06,
    token_cost: 600,
    sort_order: 21,
    notes: null,
  },
  {
    code: 'nano-banana-2-4k',
    provider: 'kie',
    provider_model: 'nano-banana-2',
    label: 'Nano Banana 2 — 4K',
    family: 'nano-banana-2',
    resolution: '4K',
    api_cost_usd: 0.09,
    token_cost: 900,
    sort_order: 22,
    notes: null,
  },
  {
    code: 'gpt-image-2-1k',
    provider: 'kie',
    provider_model: 'gpt-image-2-image-to-image',
    label: 'GPT Image 2 — 1K',
    family: 'gpt-image-2',
    resolution: '1K',
    api_cost_usd: 0.03,
    token_cost: 300,
    sort_order: 30,
    notes: 'Cheapest option — good for testing a layout before the final run.',
  },
  {
    code: 'gpt-image-2-2k',
    provider: 'kie',
    provider_model: 'gpt-image-2-image-to-image',
    label: 'GPT Image 2 — 2K',
    family: 'gpt-image-2',
    resolution: '2K',
    api_cost_usd: 0.05,
    token_cost: 500,
    sort_order: 31,
    notes: null,
  },
  {
    code: 'gpt-image-2-4k',
    provider: 'kie',
    provider_model: 'gpt-image-2-image-to-image',
    label: 'GPT Image 2 — 4K',
    family: 'gpt-image-2',
    resolution: '4K',
    api_cost_usd: 0.08,
    token_cost: 800,
    sort_order: 32,
    notes: null,
  },
  {
    // Kie.ai không công bố giá của bản Lite ở tài liệu công khai, nên model này
    // được tạo sẵn nhưng TẮT BÁN. Điền giá vốn và số điểm thật rồi mới bật.
    code: 'nano-banana-2-lite',
    provider: 'kie',
    provider_model: 'nano-banana-2-lite',
    label: 'Nano Banana 2 Lite',
    family: 'nano-banana-2-lite',
    resolution: '1K',
    api_cost_usd: 0,
    token_cost: 250,
    sort_order: 40,
    is_active: 0,
    notes: 'NOT ON SALE: fill in the real provider cost and credit price before enabling. This model has no 2K/4K option.',
  },
] as const;

/**
 * GÓI THUÊ BAO THÁNG — ĐÃ NGỪNG BÁN.
 *
 * Sản phẩm nay chỉ bán điểm (xem `TOKEN_PACKAGES`): mua điểm là dùng được ngay.
 * Toàn bộ gói ở đây để `is_active = 0` nên không xuất hiện ở bất kỳ đâu trên
 * giao diện khách — chúng chỉ còn để admin cấp tay cho khách VIP trong Quản trị
 * → Khách hàng → nút "Gói", và để những gói đã bán trước đây chạy hết hạn.
 *
 * Giá ghi bằng USD cent. Các gói này KHÔNG bán nên con số chỉ còn ý nghĩa khi
 * admin cấp tay: nó là giá trị ghi vào bản ghi `subscriptions` để đối soát.
 */
const MONTHLY_TOKEN_ALLOWANCE = 500_000;

const SUBSCRIPTION_PLANS = [
  {
    code: 'FREE',
    name: 'Gói miễn phí',
    months: 12,
    price_usd_cents: 0,
    monthly_token_allowance: 0,
    description: 'Không được tặng điểm hàng tháng — khách nạp điểm lẻ để dùng.',
    is_popular: 0,
    is_active: 0,
    sort_order: 0,
  },
  {
    code: 'MONTHLY_1',
    name: 'Gói 1 tháng',
    months: 1,
    price_usd_cents: 9_999,
    description: 'Đã ngừng bán — chỉ admin cấp tay.',
    is_popular: 0,
    is_active: 0,
    sort_order: 10,
  },
  {
    code: 'MONTHLY_3',
    name: 'Gói 3 tháng',
    months: 3,
    price_usd_cents: 28_499,
    description: 'Đã ngừng bán — chỉ admin cấp tay.',
    is_popular: 0,
    is_active: 0,
    sort_order: 20,
  },
  {
    code: 'MONTHLY_6',
    name: 'Gói 6 tháng',
    months: 6,
    price_usd_cents: 53_999,
    description: 'Đã ngừng bán — chỉ admin cấp tay.',
    is_popular: 0,
    is_active: 0,
    sort_order: 30,
  },
  {
    code: 'MONTHLY_12',
    name: 'Gói 1 năm',
    months: 12,
    price_usd_cents: 101_999,
    description: 'Đã ngừng bán — chỉ admin cấp tay.',
    is_popular: 0,
    is_active: 0,
    sort_order: 40,
  },
] as const;

/**
 * GÓI ĐIỂM — sản phẩm duy nhất đang bán.
 *
 * Quy tắc: khách nhận được **một nửa** lượng điểm so với số tiền bỏ ra tính theo
 * giá vốn (tức bán gấp đôi giá vốn). Vì 10.000 điểm = $1 giá vốn, $1 tiền bán
 * mua được 5.000 điểm. Giá niêm yết làm tròn xuống mốc x9,99:
 *
 *   Gói        Điểm nhận    Giá vốn số điểm    Đơn giá
 *   $9,99         50.000            $5,00      $0,0002/điểm
 *   $19,99       100.000           $10,00      $0,0002/điểm
 *   $49,99       250.000           $25,00      $0,0002/điểm
 *   $99,99       500.000           $50,00      $0,0002/điểm
 *   $199,99    1.000.000          $100,00      $0,0002/điểm
 *
 * `name` và `description` HIỂN THỊ CHO KHÁCH nên viết bằng tiếng Anh.
 * Điểm KHÔNG hết hạn — mua bao nhiêu dùng dần bấy nhiêu.
 */
const TOKEN_PACKAGES = [
  {
    code: 'CREDITS_10',
    name: 'Starter',
    price_usd_cents: 999,
    base_tokens: MONTHLY_TOKEN_ALLOWANCE / 10,
    bonus_tokens: 0,
    description: 'A quick top-up to try things out.',
    is_popular: 0,
    sort_order: 5,
  },
  {
    code: 'CREDITS_20',
    name: 'Basic',
    price_usd_cents: 1_999,
    base_tokens: MONTHLY_TOKEN_ALLOWANCE / 5,
    bonus_tokens: 0,
    description: 'Enough for a few dozen images a month.',
    is_popular: 0,
    sort_order: 10,
  },
  {
    code: 'CREDITS_50',
    name: 'Pro',
    price_usd_cents: 4_999,
    base_tokens: MONTHLY_TOKEN_ALLOWANCE / 2,
    bonus_tokens: 0,
    description: 'The most popular choice for online stores.',
    is_popular: 1,
    sort_order: 20,
  },
  {
    code: 'CREDITS_100',
    name: 'Business',
    price_usd_cents: 9_999,
    base_tokens: MONTHLY_TOKEN_ALLOWANCE,
    bonus_tokens: 0,
    description: 'Covers a full campaign end to end.',
    is_popular: 0,
    sort_order: 30,
  },
  {
    code: 'CREDITS_200',
    name: 'Agency',
    price_usd_cents: 19_999,
    base_tokens: MONTHLY_TOKEN_ALLOWANCE * 2,
    bonus_tokens: 0,
    description: 'For teams producing content at volume.',
    is_popular: 0,
    sort_order: 40,
  },
] as const;

const DEFAULT_SETTINGS: Record<string, string> = {
  site_name: 'Design Copycat AI',
  free_tokens_on_signup: '0',

  /*
   * Tiếp thị liên kết. Sửa trong Quản trị → Affiliate, không phải ở đây —
   * `INSERT IGNORE` bên dưới không ghi đè giá trị admin đã đặt.
   *
   * Hoa hồng = (doanh thu đơn − giá vốn số điểm đã bán − chi phí cố định) × tỉ lệ.
   * Hai khoản chi phí cố định mặc định bằng 0: chỉ chủ hệ thống mới biết mỗi đơn
   * thực sự gánh thêm bao nhiêu, đặt bừa một con số là tính sai hoa hồng ngay từ
   * đơn đầu tiên.
   */
  affiliate_enabled: '1',
  affiliate_commission_percent: '40',
  affiliate_fixed_cost_usd_cents: '0',
  affiliate_fixed_cost_percent: '0',
};

/**
 * Nạp dữ liệu mặc định. Dùng INSERT IGNORE nên chạy lại nhiều lần không ghi đè
 * những gì admin đã chỉnh trong bảng điều khiển.
 */
export async function seed(): Promise<void> {
  await repairKnownBadModelSlugs();
  await migratePricingToCostUnits();
  await retireSubscriptionPlans();

  for (const model of MODEL_PRICING) {
    await execute(
      `INSERT IGNORE INTO model_pricing
         (code, provider, provider_model, label, family, resolution, api_cost_usd, token_cost, sort_order, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model.code,
        model.provider,
        model.provider_model,
        model.label,
        model.family,
        model.resolution,
        model.api_cost_usd,
        model.token_cost,
        model.sort_order,
        'is_active' in model ? model.is_active : 1,
        model.notes ?? null,
      ],
    );
  }

  for (const pkg of TOKEN_PACKAGES) {
    await execute(
      `INSERT IGNORE INTO token_packages
         (code, name, price_usd_cents, base_tokens, bonus_tokens, description, is_popular, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pkg.code,
        pkg.name,
        pkg.price_usd_cents,
        pkg.base_tokens,
        pkg.bonus_tokens,
        pkg.description,
        pkg.is_popular,
        pkg.sort_order,
      ],
    );
  }

  for (const plan of SUBSCRIPTION_PLANS) {
    await execute(
      `INSERT IGNORE INTO subscription_plans
         (code, name, months, price_usd_cents, monthly_token_allowance, description, is_popular, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.code,
        plan.name,
        plan.months,
        plan.price_usd_cents,
        'monthly_token_allowance' in plan ? plan.monthly_token_allowance : MONTHLY_TOKEN_ALLOWANCE,
        plan.description,
        plan.is_popular,
        'is_active' in plan ? plan.is_active : 1,
        plan.sort_order,
      ],
    );
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await execute('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
  }

  // Phải chạy SAU vòng chèn model ở trên: với database mới tinh, bảng
  // model_pricing lúc đầu còn rỗng nên chạy sớm hơn thì không có gì để đánh dấu.
  await ensureEstimateReferenceModel();

  await syncAdminRoles();
  await bootstrapAdminAccount();
  await warnUnpricedModels();
}

/**
 * Đảm bảo luôn có đúng một model làm mốc quy "số điểm" ra "số ảnh".
 *
 * Con số "Tạo được tới N ảnh" trên thẻ gói điểm được tính bằng
 * `số điểm của gói ÷ token_cost của model mốc`. Không có model nào được đánh dấu
 * thì thẻ gói mất hẳn dòng đó — trang bán hàng thiếu mất con số dễ hiểu nhất.
 *
 * KHÔNG ghi đè lựa chọn của admin: chỉ chạy khi chưa có dòng nào được bật. Admin
 * đổi mốc ở Quản trị → Bảng giá, cột "Mốc quy đổi".
 */
const DEFAULT_ESTIMATE_REFERENCE_CODE = 'gpt-image-2-2k';

async function ensureEstimateReferenceModel(): Promise<void> {
  const current = await queryOne<RowDataPacket & { code: string }>(
    'SELECT code FROM model_pricing WHERE is_estimate_reference = 1 LIMIT 1',
  );
  if (current) return;

  // Model mặc định có thể đã bị admin tắt bán hoặc xoá — lùi về model đang bán
  // rẻ nhất để trang bán hàng luôn có số ảnh hiển thị.
  /*
   * Thứ tự ưu tiên: đang bán trước, rồi mới tới model mặc định, rồi rẻ nhất.
   *
   * `is_active DESC` phải đứng TRƯỚC `(code = ?) DESC`: catalog công khai chỉ trả
   * về model đang bán, nên đánh dấu một model đã tắt bán thì phía khách không
   * thấy nó và lại rơi vào nhánh dự phòng — coi như đánh dấu vô ích.
   */
  const target = await queryOne<RowDataPacket & { id: number; label: string }>(
    `SELECT id, label FROM model_pricing
      WHERE token_cost > 0 AND (code = ? OR is_active = 1)
      ORDER BY is_active DESC, (code = ?) DESC, token_cost ASC
      LIMIT 1`,
    [DEFAULT_ESTIMATE_REFERENCE_CODE, DEFAULT_ESTIMATE_REFERENCE_CODE],
  );
  if (!target) return;

  await execute('UPDATE model_pricing SET is_estimate_reference = 1 WHERE id = ?', [target.id]);
  console.log(`[seed] Đã chọn "${target.label}" làm mốc quy đổi số ảnh trên thẻ gói điểm.`);
}

/**
 * Ngừng bán toàn bộ gói thuê bao tháng. CHẠY ĐÚNG MỘT LẦN.
 *
 * `INSERT IGNORE` ở trên không đụng tới dòng đã tồn tại, nên với database đang
 * chạy thật thì các gói MONTHLY_* vẫn giữ `is_active = 1` từ đời trước. Không có
 * câu này thì chúng biến mất khỏi giao diện khách (do catalog không trả về plans
 * nữa) nhưng vẫn hiện "Đang bán" trong Quản trị → Bảng giá, đọc rất khó hiểu.
 *
 * Cột mốc lưu trong bảng `settings` chứ không chạy lại mỗi lần khởi động: admin
 * vẫn có quyền bật lại một gói trong trang Quản trị, chạy lại vô điều kiện thì
 * lần restart sau lại âm thầm tắt đi.
 *
 * Chỉ tắt cờ bán, KHÔNG xoá dòng: các bản ghi `subscriptions` đã bán tham chiếu
 * tới chúng, và trang Quản trị vẫn cần danh sách này để cấp gói tay cho khách VIP.
 */
const SUBSCRIPTION_RETIRED_KEY = 'subscription_plans_retired_at';

async function retireSubscriptionPlans(): Promise<void> {
  const done = await queryOne<RowDataPacket & { setting_value: string | null }>(
    'SELECT setting_value FROM settings WHERE setting_key = ?',
    [SUBSCRIPTION_RETIRED_KEY],
  );
  if (done) return;

  const result = await execute('UPDATE subscription_plans SET is_active = 0 WHERE is_active = 1');
  await execute('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, NOW())', [
    SUBSCRIPTION_RETIRED_KEY,
  ]);

  if (result.affectedRows > 0) {
    console.log(`[seed] Đã ngừng bán ${result.affectedRows} gói thuê bao tháng — hệ thống nay chỉ bán điểm.`);
  }
}

/**
 * Chuyển dữ liệu cũ sang đơn vị điểm hiện hành (10.000 điểm = $1 giá vốn).
 *
 * Bảng giá đã qua ba đời đơn vị: 1 điểm ≈ 100đ giá bán → 1 điểm = 1đ giá vốn →
 * 1 điểm = $0,0001 giá vốn. Vì vậy mỗi model có nhiều giá trị cũ có thể gặp.
 *
 * CHỈ sửa dòng vẫn giữ đúng một trong các giá trị seed cũ — dòng nào admin đã tự
 * chỉnh thì để nguyên, tránh ghi đè quyết định của người vận hành.
 */
async function migratePricingToCostUnits(): Promise<void> {
  const modelFixes: { code: string; oldCosts: number[]; newCost: number }[] = [
    { code: 'nano-banana-pro-1k', oldCosts: [80, 2520], newCost: 900 },
    { code: 'nano-banana-pro-2k', oldCosts: [80, 2520], newCost: 900 },
    { code: 'nano-banana-pro-4k', oldCosts: [105, 3360], newCost: 1200 },
    { code: 'nano-banana-2-1k', oldCosts: [40, 1120], newCost: 400 },
    { code: 'nano-banana-2-2k', oldCosts: [55, 1680], newCost: 600 },
    { code: 'nano-banana-2-4k', oldCosts: [80, 2520], newCost: 900 },
    { code: 'gpt-image-2-1k', oldCosts: [30, 840], newCost: 300 },
    { code: 'gpt-image-2-2k', oldCosts: [45, 1400], newCost: 500 },
    { code: 'gpt-image-2-4k', oldCosts: [70, 2240], newCost: 800 },
    { code: 'nano-banana-2-lite', oldCosts: [25, 700], newCost: 250 },
  ];

  let converted = 0;
  for (const fix of modelFixes) {
    const placeholders = fix.oldCosts.map(() => '?').join(',');
    const result = await execute(
      `UPDATE model_pricing SET token_cost = ? WHERE code = ? AND token_cost IN (${placeholders})`,
      [fix.newCost, fix.code, ...fix.oldCosts],
    );
    converted += result.affectedRows;
  }
  if (converted > 0) {
    console.log(`[seed] Đã quy đổi ${converted} dòng bảng giá sang đơn vị điểm mới (10.000 điểm = $1 giá vốn).`);
  }

  /*
   * Ngừng bán mọi gói điểm định giá bằng VNĐ.
   *
   * Cột `price_usd_cents` của chúng đang giữ nguyên con số VNĐ cũ (migration chỉ
   * đổi tên cột, xem db.ts), nên để bán tiếp là bán gói 99.000 với giá $990.
   * Bộ gói USD mới dùng mã CREDITS_* nên không đụng tới các dòng này.
   */
  const retired = await execute(
    `UPDATE token_packages SET is_active = 0
      WHERE code IN ('STARTER','CREATOR','CREATOR_PLUS','STUDIO','AGENCY',
                     'EXTRA_200K','EXTRA_500K','EXTRA_1M','EXTRA_2M',
                     'EXTRA_99','EXTRA_199','EXTRA_499','EXTRA_999','EXTRA_1999')
        AND is_active = 1`,
  );
  if (retired.affectedRows > 0) {
    console.log(`[seed] Đã ngừng bán ${retired.affectedRows} gói điểm định giá bằng VNĐ.`);
  }

  // Nano Banana 2 Lite từng bị chèn vào DB khi câu INSERT chưa có cột is_active,
  // nên nó mặc định bật bán với giá vốn 0 và số điểm đặt tạm — bán như vậy là
  // bán mù, không biết lãi lỗ. Chỉ tắt khi dòng vẫn giữ nguyên giá trị đặt tạm;
  // nếu admin đã điền giá thật thì tôn trọng quyết định đó.
  const liteOff = await execute(
    `UPDATE model_pricing SET is_active = 0
      WHERE code = 'nano-banana-2-lite' AND api_cost_usd = 0 AND token_cost = 250 AND is_active = 1`,
  );
  if (liteOff.affectedRows > 0) {
    console.log('[seed] Đã tắt bán Nano Banana 2 Lite (chưa có giá vốn thật).');
  }
}

/**
 * Cảnh báo model đang bán mà chưa khai giá vốn.
 *
 * Không có giá vốn thì không tính được lãi lỗ và báo cáo biên lợi nhuận sẽ sai,
 * nên đây luôn là dấu hiệu cấu hình thiếu chứ không phải chủ ý.
 */
async function warnUnpricedModels(): Promise<void> {
  const rows = await query<RowDataPacket & { code: string; label: string }>(
    'SELECT code, label FROM model_pricing WHERE is_active = 1 AND api_cost_usd <= 0',
  );
  for (const row of rows) {
    console.warn(
      `[cấu hình] Model "${row.label}" (${row.code}) đang BÁN nhưng giá vốn = 0. ` +
        'Vào Quản trị → Bảng giá điền giá vốn thật, nếu không báo cáo lợi nhuận sẽ sai.',
    );
  }
}

/**
 * Sửa các slug model đã bị ghi sai vào DB ở những lần chạy trước.
 *
 * `INSERT IGNORE` không cập nhật dòng đã tồn tại, nên chỉ sửa trong `MODEL_PRICING`
 * là không đủ. Hàm này chỉ đụng tới đúng giá trị sai đã biết — slug nào admin tự
 * đặt khác đi sẽ được giữ nguyên.
 */
async function repairKnownBadModelSlugs(): Promise<void> {
  const fixes: { wrong: string; correct: string }[] = [
    // Kie.ai không có model tên 'gpt-image-2'; bản image-to-image có slug đầy đủ.
    { wrong: 'gpt-image-2', correct: 'gpt-image-2-image-to-image' },
  ];

  for (const fix of fixes) {
    const result = await execute(
      `UPDATE model_pricing SET provider_model = ? WHERE provider = 'kie' AND provider_model = ?`,
      [fix.correct, fix.wrong],
    );
    if (result.affectedRows > 0) {
      console.log(`[seed] Đã sửa slug model "${fix.wrong}" → "${fix.correct}" (${result.affectedRows} dòng).`);
    }
  }
}

/**
 * Đồng bộ quyền admin theo ADMIN_EMAILS trong .env.
 * Chạy mỗi lần khởi động: thêm email vào .env rồi restart là tài khoản đó lên admin,
 * bỏ ra khỏi .env thì bị hạ xuống user.
 */
export async function syncAdminRoles(): Promise<void> {
  if (env.adminEmails.length > 0) {
    const placeholders = env.adminEmails.map(() => '?').join(',');
    await execute(
      `UPDATE users SET role = 'admin' WHERE LOWER(email) IN (${placeholders}) AND role <> 'admin'`,
      [...env.adminEmails],
    );
    await execute(
      `UPDATE users SET role = 'user' WHERE role = 'admin' AND LOWER(email) NOT IN (${placeholders})`,
      [...env.adminEmails],
    );
  } else {
    await execute(`UPDATE users SET role = 'user' WHERE role = 'admin'`);
  }

  const admins = await query<RowDataPacket & { email: string }>(
    `SELECT email FROM users WHERE role = 'admin' ORDER BY email`,
  );
  if (admins.length > 0) {
    console.log(`[seed] Tài khoản admin hiện tại: ${admins.map((a) => a.email).join(', ')}`);
  }
}

/** Tạo sẵn tài khoản admin nếu .env có khai báo ADMIN_BOOTSTRAP_*. */
async function bootstrapAdminAccount(): Promise<void> {
  const { email, password } = env.adminBootstrap;
  if (!email || !password) return;

  const existing = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return;

  const role = env.adminEmails.includes(email) ? 'admin' : 'user';
  await execute('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [
    email,
    await hashPassword(password),
    'Quản trị viên',
    role,
  ]);
  console.log(`[seed] Đã tạo tài khoản ${role}: ${email}`);

  if (role !== 'admin') {
    console.warn(`[seed] ${email} chưa có trong ADMIN_EMAILS nên chỉ là tài khoản thường.`);
  }
}
