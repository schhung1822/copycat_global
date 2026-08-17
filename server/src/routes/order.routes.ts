import { Router } from 'express';
import { query, queryOne, type RowDataPacket } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { AppError, asyncHandler, notFound } from '../lib/errors.js';
import { parsePaging, requireInt } from '../lib/validate.js';
import {
  cancelOrder,
  createOrder,
  expireStaleOrders,
  serializeOrder,
  type OrderRow,
} from '../services/orderService.js';
import { readAccountState } from '../services/subscriptionService.js';
import { closeCheckout, openCheckout, stripeConfigured, syncOrderFromStripe } from '../services/stripeService.js';

export const orderRouter = Router();

orderRouter.use(requireAuth);

/** Danh sách đơn của chính người dùng. */
orderRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    await expireStaleOrders();
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 20);

    const orders = await query<OrderRow>('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', [
      req.user!.id,
      limit,
      offset,
    ]);
    const total = await queryOne<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM orders WHERE user_id = ?',
      [req.user!.id],
    );

    res.json({ orders: orders.map(serializeOrder), page, limit, total: total?.total ?? 0 });
  }),
);

/**
 * Mua điểm: tạo đơn rồi mở phiên Stripe Checkout.
 *
 * Trả về `checkoutUrl` để trình duyệt chuyển hướng sang trang thanh toán của
 * Stripe. Đơn được ghi vào database TRƯỚC khi gọi Stripe — xem `createOrder`.
 */
orderRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const packageId = requireInt(req.body, 'packageId', { min: 1, label: 'Credit pack' });

    // Kiểm tra TRƯỚC khi ghi đơn: không có Stripe thì `openCheckout` sẽ ném lỗi và
    // để lại một đơn `pending` mồ côi, vừa làm bẩn lịch sử của khách vừa ăn vào
    // hạn mức "tối đa 5 đơn chờ" của họ.
    if (!stripeConfigured()) {
      throw new AppError(503, 'Payments are not available right now. Please try again later.', 'stripe_not_configured');
    }

    const order = await createOrder(req.user!.id, packageId);
    const checkoutUrl = await openCheckout(order, req.user!);

    res.status(201).json({ order: serializeOrder(order), checkoutUrl });
  }),
);

/**
 * Mở lại trang thanh toán của một đơn còn dang dở.
 *
 * Khách đóng tab giữa chừng rồi quay lại thì đi đường này. `openCheckout` tái sử
 * dụng đúng phiên Stripe cũ nếu nó còn mở, nên không sinh ra hai ý định thu tiền
 * song song trên cùng một đơn.
 */
orderRouter.post(
  '/:code/checkout',
  asyncHandler(async (req, res) => {
    const load = () =>
      queryOne<OrderRow>('SELECT * FROM orders WHERE code = ? AND user_id = ?', [req.params.code, req.user!.id]);

    let order = await load();
    if (!order) throw notFound('Order not found.');

    /*
     * Hỏi Stripe TRƯỚC khi mở phiên mới.
     *
     * Khách có thể đã trả tiền xong mà webhook chưa kịp về: đơn trong database
     * vẫn là `pending` trong khi phiên Stripe đã ở trạng thái đã thanh toán. Mở
     * thêm phiên thứ hai lúc đó là mời khách trả tiền lần hai cho cùng một gói.
     */
    if (await syncOrderFromStripe(order)) order = (await load()) ?? order;

    if (order.status === 'paid') {
      res.json({ order: serializeOrder(order), checkoutUrl: null, alreadyPaid: true });
      return;
    }

    const checkoutUrl = await openCheckout(order, req.user!);
    res.json({ order: serializeOrder(order), checkoutUrl });
  }),
);

/**
 * Chi tiết một đơn — client gọi lặp lại sau khi quay về từ Stripe.
 *
 * Mỗi lượt gọi cũng hỏi thẳng Stripe xem tiền đã về chưa. Nhờ vậy khách thấy
 * điểm được cộng ngay cả khi webhook đang trễ hoặc chưa được cấu hình.
 */
orderRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    await expireStaleOrders();

    const load = () =>
      queryOne<OrderRow>('SELECT * FROM orders WHERE code = ? AND user_id = ?', [req.params.code, req.user!.id]);

    let order = await load();
    if (!order) throw notFound('Order not found.');

    if (await syncOrderFromStripe(order)) {
      order = (await load()) ?? order;
    }

    // Số dư đọc lại từ database: `req.user` được nạp ở đầu request nên nó là số
    // dư TRƯỚC khi lượt đồng bộ ngay trên đây cộng điểm.
    const state = await readAccountState(req.user!.id);

    res.json({ order: serializeOrder(order), tokenBalance: state.availableTokens });
  }),
);

orderRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const order = await cancelOrder(req.user!.id, Number(req.params.id));
    // Đóng nốt phiên Stripe: để nó sống thì khách còn mở lại được link cũ và trả
    // tiền cho một đơn đã huỷ.
    await closeCheckout(order);
    res.json({ ok: true });
  }),
);
