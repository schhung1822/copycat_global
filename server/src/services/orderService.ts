import crypto from 'node:crypto';
import { execute, query, queryOne, withTransaction, type PoolConnection, type ResultSetHeader, type RowDataPacket } from '../db.js';
import { env } from '../env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { recordOrderCommission } from './affiliateService.js';
import { activateSubscription, type PlanRow } from './subscriptionService.js';
import { creditPurchasedTokens } from './tokenService.js';

export interface PackageRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  price_usd_cents: number;
  base_tokens: number;
  bonus_tokens: number;
  description: string | null;
  is_popular: number;
  is_active: number;
  sort_order: number;
}

export interface OrderRow extends RowDataPacket {
  id: number;
  code: string;
  user_id: number;
  order_type: 'subscription' | 'token_package';
  plan_id: number | null;
  subscription_months: number | null;
  package_id: number | null;
  package_code: string | null;
  package_name: string;
  amount_usd_cents: number;
  credit_usd_cents: number;
  is_upgrade: number;
  base_tokens: number;
  bonus_tokens: number;
  total_tokens: number;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  payment_method: string;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  paid_source: string | null;
  payment_ref: string | null;
  paid_amount_usd_cents: number | null;
  paid_at: Date | null;
  fulfilled_at: Date | null;
  approved_by: number | null;
  note: string | null;
  expires_at: Date | null;
  created_at: Date;
}

/**
 * Bỏ các ký tự dễ nhìn nhầm (0/O, 1/I).
 *
 * Mã đơn không còn phải gõ tay vào nội dung chuyển khoản, nhưng khách vẫn đọc nó
 * qua điện thoại khi liên hệ hỗ trợ nên vẫn đáng để tránh ký tự dễ nhầm.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(): string {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `${env.orderPrefix}${out}`;
}

export async function listActivePackages(): Promise<PackageRow[]> {
  return query<PackageRow>('SELECT * FROM token_packages WHERE is_active = 1 ORDER BY sort_order, price_usd_cents');
}

/**
 * Tạo đơn mua điểm ở trạng thái chờ thanh toán.
 *
 * Đơn được ghi TRƯỚC khi mở phiên Stripe Checkout, không phải sau: phiên Stripe
 * mang `client_reference_id` là mã đơn, nên đơn phải tồn tại trước thì webhook
 * quay về mới có chỗ để khớp. Ngược lại — tạo phiên trước rồi mới ghi đơn — thì
 * khách thanh toán trong lúc server chết là mất trắng giao dịch.
 *
 * Đây là loại đơn DUY NHẤT khách còn tạo được — gói tháng đã ngừng bán. Đơn
 * `subscription` chỉ còn tồn tại ở dạng dữ liệu cũ; xem `fulfillOrder`.
 */
export async function createOrder(userId: number, packageId: number): Promise<OrderRow> {
  const pkg = await queryOne<PackageRow>('SELECT * FROM token_packages WHERE id = ? AND is_active = 1', [packageId]);
  if (!pkg) throw badRequest('This credit pack no longer exists or is not on sale.');

  const pending = await queryOne<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM orders WHERE user_id = ? AND status = 'pending'`,
    [userId],
  );
  if ((pending?.total ?? 0) >= 5) {
    throw conflict('You have too many unpaid orders. Please complete or cancel some of them first.', 'too_many_pending');
  }

  // Rất khó trùng, nhưng vẫn thử lại vài lần cho chắc.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const result = await execute(
        `INSERT INTO orders
           (code, user_id, order_type, package_id, package_code, package_name,
            amount_usd_cents, base_tokens, bonus_tokens, total_tokens, payment_method, expires_at)
         VALUES (?, ?, 'token_package', ?, ?, ?, ?, ?, ?, ?, 'stripe', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
        [
          code,
          userId,
          pkg.id,
          pkg.code,
          pkg.name,
          pkg.price_usd_cents,
          pkg.base_tokens,
          pkg.bonus_tokens,
          pkg.base_tokens + pkg.bonus_tokens,
          env.orderExpireMinutes,
        ],
      );
      const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE id = ?', [result.insertId]);
      if (!order) throw new Error('Không tạo được đơn.');
      return order;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ER_DUP_ENTRY')) throw error;
    }
  }

  throw new Error('Không sinh được mã đơn duy nhất, vui lòng thử lại.');
}

export interface MarkPaidInput {
  /** stripe | manual | external */
  source: string;
  paymentRef?: string | null;
  paidAmountUsdCents?: number | null;
  approvedBy?: number | null;
  note?: string | null;
}

export type MarkPaidOutcome =
  | { ok: true; order: OrderRow; tokensCredited: number; subscriptionExpiresAt: Date | null }
  | { ok: false; reason: 'already_paid' | 'not_pending' | 'amount_mismatch'; order: OrderRow; message: string };

/**
 * Xác nhận đơn đã thanh toán và cộng điểm.
 *
 * An toàn khi gọi lại nhiều lần: dòng đơn bị khoá FOR UPDATE và chỉ đơn ở trạng
 * thái `pending` mới được cộng điểm, nên webhook bắn trùng hay admin bấm duyệt
 * hai lần cũng không cộng điểm hai lần.
 */
export async function markOrderPaid(orderCode: string, input: MarkPaidInput): Promise<MarkPaidOutcome> {
  return withTransaction(async (conn: PoolConnection) => {
    const [rows] = await conn.query<OrderRow[]>('SELECT * FROM orders WHERE code = ? FOR UPDATE', [orderCode]);
    const order = rows[0];
    if (!order) throw notFound(`Không tìm thấy đơn ${orderCode}.`);

    if (order.status === 'paid') {
      return { ok: false, reason: 'already_paid', order, message: `Đơn ${orderCode} đã được thanh toán trước đó.` };
    }
    // Đơn hết hạn vẫn được cộng điểm: khách chuyển tiền muộn thì tiền vẫn về tài khoản,
    // từ chối ở đây sẽ thành thu tiền mà không giao hàng. Chỉ đơn bị huỷ mới bị chặn.
    if (order.status !== 'pending' && order.status !== 'expired') {
      return {
        ok: false,
        reason: 'not_pending',
        order,
        message: `Đơn ${orderCode} đang ở trạng thái "${order.status}", không thể xác nhận.`,
      };
    }

    // Thu thiếu tiền thì không tự cộng điểm — để admin xử lý tay.
    const paidAmount = input.paidAmountUsdCents ?? order.amount_usd_cents;
    if (input.source !== 'manual' && paidAmount < order.amount_usd_cents) {
      const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
      return {
        ok: false,
        reason: 'amount_mismatch',
        order,
        message: `Số tiền nhận được (${usd(paidAmount)}) nhỏ hơn giá trị đơn (${usd(order.amount_usd_cents)}).`,
      };
    }

    await conn.query(
      `UPDATE orders
          SET status = 'paid', paid_source = ?, payment_ref = ?, paid_amount_usd_cents = ?,
              paid_at = NOW(), approved_by = ?, note = COALESCE(?, note)
        WHERE id = ?`,
      [input.source, input.paymentRef ?? null, paidAmount, input.approvedBy ?? null, input.note ?? null, order.id],
    );

    const { subscriptionExpiresAt } = await fulfillOrder(conn, order, input.approvedBy ?? null);

    const [updated] = await conn.query<OrderRow[]>('SELECT * FROM orders WHERE id = ?', [order.id]);
    return { ok: true, order: updated[0], tokensCredited: order.total_tokens, subscriptionExpiresAt };
  });
}

/**
 * "Giao hàng" cho một đơn đã thanh toán: cộng điểm vào ví khách.
 *
 * Tách riêng khỏi `markOrderPaid` để cả hai đường vào đều dùng chung một bản
 * nghiệp vụ: đường trong ứng dụng (webhook, admin duyệt) và đường đối soát cho
 * các đơn bị hệ thống ngoài đổi `status` thẳng trong database.
 *
 * NHÁNH `subscription` LÀ DÀNH CHO ĐƠN CŨ, không phải chức năng đang bán. Gói
 * tháng đã ngừng bán nhưng vẫn có thể còn đơn `pending` sinh ra trước đó mà
 * khách chuyển khoản muộn — từ chối giao là thu tiền mà không giao hàng. Chỉ
 * xoá nhánh này khi bảng `orders` không còn đơn subscription nào chưa giao.
 *
 * Bắt buộc gọi trong transaction đã khoá dòng đơn bằng FOR UPDATE.
 */
async function fulfillOrder(
  conn: PoolConnection,
  order: OrderRow,
  approvedBy: number | null,
): Promise<{ subscriptionExpiresAt: Date | null }> {
  let subscriptionExpiresAt: Date | null = null;

  if (order.order_type === 'subscription') {
    // Gói tháng không cộng điểm vào ví; hạn mức được cấp theo chu kỳ tháng.
    const [planRows] = await conn.query<PlanRow[]>('SELECT * FROM subscription_plans WHERE id = ?', [order.plan_id]);
    const plan = planRows[0];
    const activated = await activateSubscription(
      conn,
      order.user_id,
      {
        id: order.plan_id,
        code: order.package_code,
        // Tên gói sạch ("Gói 1 năm"), không lấy tên đơn ("Nâng lên Gói 1 năm").
        name: plan?.name ?? order.package_name,
        months: order.subscription_months ?? plan?.months ?? 1,
        /*
         * GIÁ NIÊM YẾT của gói, không phải số tiền khách trả.
         *
         * Với đơn nâng gói, amount_usd_cents đã bị trừ phần khấu trừ. Lưu số đã trừ
         * vào thuê bao sẽ làm hỏng hai thứ ở lần nâng sau: khách bị tính khấu trừ
         * trên giá thấp hơn thực tế, và gói cao nhất vẫn hiện ra như một lựa chọn
         * để "nâng lên chính nó" vì giá niêm yết luôn lớn hơn số đã trả.
         *
         * amount + credit = giá niêm yết (credit = 0 với đơn thường).
         */
        priceUsdCents: order.amount_usd_cents + order.credit_usd_cents,
        // Gói bị xoá khỏi bảng giá thì vẫn dùng được hạn mức mặc định 500.000.
        allowance: plan?.monthly_token_allowance ?? 500_000,
      },
      order.id,
      // Nâng gói: gói mới tính giờ từ bây giờ, không nối tiếp hạn cũ.
      { restart: Boolean(order.is_upgrade) },
    );
    subscriptionExpiresAt = activated.expiresAt;
  } else {
    await creditPurchasedTokens(conn, {
      userId: order.user_id,
      amount: order.total_tokens,
      type: 'topup',
      refType: 'order',
      refId: order.id,
      description: `Credit purchase · ${order.package_name} · order ${order.code}`,
      createdBy: approvedBy,
    });
  }

  await conn.query('UPDATE users SET total_topup_usd_cents = total_topup_usd_cents + ? WHERE id = ?', [
    order.amount_usd_cents,
    order.user_id,
  ]);

  /*
   * Hoa hồng cho người đã giới thiệu khách này.
   *
   * Nằm trong cùng transaction với việc cộng điểm: hoặc khách nhận được hàng và
   * affiliate được ghi công, hoặc cả hai cùng không xảy ra. Hàm tự bỏ qua khi
   * khách không đến từ link giới thiệu nào, nên gọi vô điều kiện ở đây là đủ.
   */
  await recordOrderCommission(conn, order);

  await conn.query('UPDATE orders SET fulfilled_at = NOW() WHERE id = ?', [order.id]);

  return { subscriptionExpiresAt };
}

/** Đảm bảo chỉ một lượt đối soát chạy tại một thời điểm. */
let reconciling = false;

/**
 * Quét các đơn đã `paid` nhưng chưa được giao hàng rồi xử lý chúng.
 *
 * Đây là đường vào cho hệ thống ngoài: workflow của bạn chỉ cần
 *
 *     UPDATE orders SET status = 'paid' WHERE code = 'NAPXXXXXX';
 *
 * là xong. Server sẽ tự phát hiện, kích hoạt gói hoặc cộng điểm, ghi sổ cái và
 * đánh dấu `fulfilled_at`. Không cần workflow biết gì về nghiệp vụ điểm.
 *
 * An toàn tuyệt đối với việc gọi trùng: mỗi đơn được khoá FOR UPDATE và chỉ xử lý
 * khi `fulfilled_at` vẫn còn NULL, nên chạy song song hay chạy lại đều không cộng
 * điểm hai lần.
 */
export async function fulfillPaidOrders(): Promise<number> {
  if (reconciling) return 0;
  reconciling = true;

  try {
    const pending = await query<OrderRow>(
      `SELECT id FROM orders WHERE status = 'paid' AND fulfilled_at IS NULL ORDER BY id LIMIT 200`,
    );

    let done = 0;
    for (const row of pending) {
      try {
        const processed = await withTransaction(async (conn) => {
          const [locked] = await conn.query<OrderRow[]>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [row.id]);
          const order = locked[0];
          // Kiểm tra lại bên trong khoá: một tiến trình khác có thể vừa xử lý xong.
          if (!order || order.status !== 'paid' || order.fulfilled_at) return false;

          // Hệ thống ngoài thường chỉ đổi mỗi `status`, bù các trường còn thiếu để
          // báo cáo doanh thu theo ngày không bị sót đơn.
          await conn.query(
            `UPDATE orders
                SET paid_at = COALESCE(paid_at, NOW()),
                    paid_source = COALESCE(paid_source, 'external'),
                    paid_amount_usd_cents = COALESCE(paid_amount_usd_cents, amount_usd_cents)
              WHERE id = ?`,
            [order.id],
          );

          await fulfillOrder(conn, order, null);
          return true;
        });

        if (processed) {
          done += 1;
          console.log(`[đối soát] Đã xử lý đơn #${row.id} do hệ thống ngoài đánh dấu đã thanh toán.`);
        }
      } catch (error) {
        // Một đơn lỗi không được làm chết cả lượt quét.
        console.error(`[đối soát] Không xử lý được đơn #${row.id}:`, error);
      }
    }

    return done;
  } finally {
    reconciling = false;
  }
}

export async function cancelOrder(userId: number, orderId: number): Promise<OrderRow> {
  const result = await execute(`UPDATE orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'`, [
    orderId,
    userId,
  ]);
  if (result.affectedRows === 0) throw badRequest('Only orders awaiting payment can be cancelled.');

  const order = await queryOne<OrderRow>('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw notFound('Order not found.');
  return order;
}

/** Đánh dấu hết hạn cho các đơn quá thời gian mà chưa thanh toán. */
export async function expireStaleOrders(): Promise<number> {
  const result: ResultSetHeader = await execute(
    `UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`,
  );
  return result.affectedRows;
}

export function serializeOrder(order: OrderRow) {
  return {
    id: order.id,
    code: order.code,
    orderType: order.order_type,
    subscriptionMonths: order.subscription_months,
    isUpgrade: Boolean(order.is_upgrade),
    creditUsdCents: order.credit_usd_cents,
    packageName: order.package_name,
    amountUsdCents: order.amount_usd_cents,
    baseTokens: order.base_tokens,
    bonusTokens: order.bonus_tokens,
    totalTokens: order.total_tokens,
    status: order.status,
    paymentMethod: order.payment_method,
    paidSource: order.paid_source,
    paymentRef: order.payment_ref,
    paidAt: order.paid_at,
    expiresAt: order.expires_at,
    createdAt: order.created_at,
    note: order.note,
  };
}
