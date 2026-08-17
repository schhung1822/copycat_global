import Stripe from 'stripe';
import { execute } from '../db.js';
import { env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { markOrderPaid, type MarkPaidOutcome, type OrderRow } from './orderService.js';

/**
 * Cổng thanh toán Stripe (chế độ Checkout — trang thanh toán do Stripe host).
 *
 * Vì sao chọn Checkout thay vì nhúng form thẻ: toàn bộ dữ liệu thẻ không bao giờ
 * chạm vào máy chủ này, nên phạm vi tuân thủ PCI rút về mức thấp nhất (SAQ A),
 * và 3-D Secure, ví Apple/Google Pay, thuế, đa ngôn ngữ đều do Stripe lo.
 *
 * BA ĐƯỜNG cùng đưa một đơn về trạng thái đã trả, cố ý dư thừa:
 *   1. Webhook `checkout.session.completed` — đường chính, gần như tức thì.
 *   2. `syncOrderFromStripe` — khách quay lại trang đơn thì server hỏi thẳng
 *      Stripe. Cứu được trường hợp webhook chưa cấu hình hoặc đang bị trễ.
 *   3. `fulfillPaidOrders` (orderService) — vòng đối soát định kỳ.
 * Cả ba đều đi qua `markOrderPaid`, vốn khoá dòng đơn bằng FOR UPDATE và chỉ cộng
 * điểm cho đơn chưa giao, nên chạy chồng nhau cũng không cộng điểm hai lần.
 */

let client: Stripe | null = null;

export const stripeConfigured = (): boolean => Boolean(env.stripe.secretKey);

export function getStripe(): Stripe {
  if (!stripeConfigured()) {
    throw badRequest('Payments are not available right now. Please try again later.', 'stripe_not_configured');
  }
  if (!client) {
    client = new Stripe(env.stripe.secretKey, {
      // Gọi lại vài lần khi mạng chập chờn. Stripe khử trùng lặp bằng
      // idempotency key nội bộ nên retry không tạo hai lần thu tiền.
      maxNetworkRetries: 2,
      appInfo: { name: 'Design Copycat AI' },
    });
  }
  return client;
}

/** Địa chỉ web dùng để dựng link quay về sau khi thanh toán. */
function appUrl(path: string): string {
  return `${env.appUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * Mở (hoặc mở lại) phiên Stripe Checkout cho một đơn.
 *
 * Khách bấm "Pay now" hai lần, hoặc quay lại đơn còn dở sau khi đóng tab, thì
 * phải vào ĐÚNG phiên cũ chứ không phải phiên mới: mỗi phiên là một ý định thu
 * tiền riêng, để hai phiên cùng sống trên một đơn là mời khách trả tiền hai lần
 * cho cùng một gói.
 */
export async function openCheckout(order: OrderRow, user: { id: number; email: string }): Promise<string> {
  const stripe = getStripe();

  if (order.stripe_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(order.stripe_session_id).catch(() => null);
    if (existing?.status === 'open' && existing.url) return existing.url;
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      client_reference_id: order.code,
      customer_email: user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: env.stripe.currency,
            // Stripe nhận số nguyên đơn vị nhỏ nhất của tiền tệ — trùng đúng đơn
            // vị hệ thống đang lưu, nên không có bước quy đổi nào để làm sai.
            unit_amount: order.amount_usd_cents,
            product_data: {
              name: `${order.package_name} — ${order.total_tokens.toLocaleString('en-US')} credits`,
              description: `Design Copycat AI credit pack · order ${order.code}`,
            },
          },
        },
      ],
      // Nguồn sự thật khi webhook về: đọc metadata thay vì tra ngược theo email.
      metadata: { orderId: String(order.id), orderCode: order.code, userId: String(user.id) },
      payment_intent_data: {
        metadata: { orderId: String(order.id), orderCode: order.code, userId: String(user.id) },
      },
      success_url: appUrl(`/credits?order=${order.code}&checkout=success`),
      cancel_url: appUrl(`/credits?order=${order.code}&checkout=cancelled`),
    },
    /*
     * Khoá chống trùng: hai request cùng lúc (khách bấm hai lần, hoặc request
     * đầu timeout và trình duyệt gửi lại) chỉ tạo ra MỘT phiên thu tiền.
     *
     * Khoá phải mang cả id phiên hiện tại chứ không chỉ mã đơn: phiên Stripe hết
     * hạn sau 24 giờ, và nếu khoá cố định thì lần mở lại sau đó Stripe trả về
     * đúng cái phiên đã chết ấy — khách bấm "Complete payment" và rơi vào một
     * trang không dùng được, mãi mãi.
     */
    { idempotencyKey: `checkout_${order.code}_${order.stripe_session_id ?? 'new'}` },
  );

  if (!session.url) throw new Error('Stripe không trả về link thanh toán.');

  await execute('UPDATE orders SET stripe_session_id = ? WHERE id = ?', [session.id, order.id]);
  return session.url;
}

/** Huỷ phiên Checkout còn mở của một đơn đã bị khách huỷ. */
export async function closeCheckout(order: OrderRow): Promise<void> {
  if (!order.stripe_session_id || !stripeConfigured()) return;
  try {
    await getStripe().checkout.sessions.expire(order.stripe_session_id);
  } catch {
    // Phiên đã hết hạn hoặc đã thanh toán — không có gì để đóng, bỏ qua.
  }
}

/**
 * Hỏi thẳng Stripe xem đơn đã được trả chưa, rồi cộng điểm nếu rồi.
 *
 * Gọi khi khách mở trang đơn. Đây là lưới an toàn cho khoảng thời gian giữa lúc
 * khách bấm xong ở Stripe và lúc webhook về — và là đường DUY NHẤT hoạt động khi
 * STRIPE_WEBHOOK_SECRET chưa được cấu hình.
 *
 * Trả về true nếu lượt gọi này vừa làm đơn chuyển sang đã thanh toán.
 */
export async function syncOrderFromStripe(order: OrderRow): Promise<boolean> {
  if (!stripeConfigured()) return false;
  if (!order.stripe_session_id) return false;
  if (order.status !== 'pending' && order.status !== 'expired') return false;

  const session = await getStripe()
    .checkout.sessions.retrieve(order.stripe_session_id)
    .catch(() => null);
  if (!session || session.payment_status === 'unpaid') return false;

  const outcome = await applyPaidSession(session);
  return outcome?.ok === true;
}

/**
 * Ghi nhận một phiên Checkout đã thanh toán vào đơn tương ứng.
 *
 * Dùng chung cho cả webhook lẫn đường hỏi thẳng Stripe, để chỉ tồn tại MỘT bản
 * quy tắc "phiên nào thì được cộng điểm".
 */
async function applyPaidSession(session: Stripe.Checkout.Session): Promise<MarkPaidOutcome | null> {
  // `paid` = đã thu xong. `no_payment_required` = đơn 0đ (mã giảm giá 100%), vẫn
  // phải giao hàng. Mọi trạng thái khác (`unpaid`) thì chưa có tiền về.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return null;

  const orderCode = session.client_reference_id ?? session.metadata?.orderCode ?? null;
  if (!orderCode) return null;

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

  const outcome = await markOrderPaid(orderCode, {
    source: 'stripe',
    paymentRef: paymentIntent ?? session.id,
    // amount_total là số tiền Stripe thực sự thu, đã trừ mã giảm giá. Dùng nó chứ
    // không dùng giá gói: khách dùng coupon hợp lệ mà bị chặn vì "thiếu tiền" là sai.
    paidAmountUsdCents: session.amount_total ?? null,
  });

  if (paymentIntent) {
    await execute('UPDATE orders SET stripe_payment_intent = ? WHERE id = ?', [paymentIntent, outcome.order.id]);
  }
  return outcome;
}

/**
 * Xác minh chữ ký rồi xử lý một webhook Stripe.
 *
 * Chữ ký là BẮT BUỘC: không có nó thì bất kỳ ai biết địa chỉ endpoint cũng gửi
 * được một gói tin "đã thanh toán" giả để tự cộng điểm cho mình. Vì vậy thiếu
 * STRIPE_WEBHOOK_SECRET thì hàm từ chối chứ không chạy ở chế độ tin tưởng.
 */
export function verifyWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!env.stripe.webhookSecret) {
    throw badRequest('Stripe webhook chưa được cấu hình (thiếu STRIPE_WEBHOOK_SECRET).', 'webhook_disabled');
  }
  if (!signature) throw badRequest('Thiếu header stripe-signature.', 'bad_signature');

  return getStripe().webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);
}

export interface WebhookResult {
  status: 'matched' | 'duplicate' | 'unmatched' | 'error' | 'ignored';
  message: string;
}

/**
 * Xử lý một sự kiện Stripe đã xác minh chữ ký.
 *
 * Chống xử lý trùng bằng khoá duy nhất `(provider, external_id)` trên bảng
 * `payment_events`: Stripe bắn lại cùng một sự kiện (điều hoàn toàn bình thường —
 * họ retry cho tới khi nhận 2xx) thì lần thứ hai không chèn được dòng và dừng ngay.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookResult> {
  const handled = new Set([
    'checkout.session.completed',
    // Thanh toán chậm (chuyển khoản SEPA, một số ví): phiên đóng trước, tiền về sau.
    'checkout.session.async_payment_succeeded',
  ]);

  if (!handled.has(event.type)) {
    return { status: 'ignored', message: `Bỏ qua sự kiện ${event.type}.` };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const orderCode = session.client_reference_id ?? session.metadata?.orderCode ?? null;

  const inserted = await execute(
    `INSERT IGNORE INTO payment_events (provider, external_id, order_code, amount_usd_cents, content, status, raw_payload)
     VALUES ('stripe', ?, ?, ?, ?, 'unmatched', ?)`,
    [
      event.id,
      orderCode,
      session.amount_total ?? null,
      `${event.type} · ${session.id}`.slice(0, 500),
      JSON.stringify(event),
    ],
  );
  if (inserted.affectedRows === 0) {
    return { status: 'duplicate', message: 'Sự kiện đã được xử lý trước đó.' };
  }
  const eventId = inserted.insertId;

  const finish = async (status: WebhookResult['status'], message: string, orderId?: number) => {
    await execute('UPDATE payment_events SET status = ?, message = ?, order_id = ? WHERE id = ?', [
      status === 'ignored' ? 'unmatched' : status,
      message.slice(0, 500),
      orderId ?? null,
      eventId,
    ]);
    return { status, message };
  };

  if (!orderCode) {
    return finish('unmatched', 'Phiên Checkout không mang mã đơn — cần quản trị viên duyệt tay.');
  }

  try {
    const outcome = await applyPaidSession(session);
    if (!outcome) {
      return finish('unmatched', `Phiên ${session.id} chưa ở trạng thái đã thanh toán.`);
    }
    if (outcome.ok) {
      const message = `Đã cộng ${outcome.tokensCredited.toLocaleString('vi-VN')} điểm cho đơn ${orderCode}.`;
      return finish('matched', message, outcome.order.id);
    }
    return finish(outcome.reason === 'already_paid' ? 'duplicate' : 'error', outcome.message, outcome.order.id);
  } catch (error) {
    return finish('error', error instanceof Error ? error.message : String(error));
  }
}
