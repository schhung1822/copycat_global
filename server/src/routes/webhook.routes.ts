import express, { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { handleStripeEvent, verifyWebhook } from '../services/stripeService.js';

export const webhookRouter = Router();

/**
 * Stripe — cấu hình endpoint trỏ tới {APP_URL}/api/webhooks/stripe
 * và dán "Signing secret" (whsec_...) vào STRIPE_WEBHOOK_SECRET trong .env.
 *
 * `express.raw` chứ KHÔNG phải `express.json`: chữ ký của Stripe được tính trên
 * đúng chuỗi byte gốc của request. Chỉ cần đi qua một bước parse rồi stringify
 * lại là byte đổi (thứ tự khoá, khoảng trắng, escape unicode) và mọi chữ ký hợp
 * lệ đều trượt. Vì vậy router này phải được gắn TRƯỚC `express.json()` toàn cục
 * trong index.ts.
 */
webhookRouter.post(
  '/stripe',
  express.raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const event = verifyWebhook(req.body as Buffer, req.headers['stripe-signature'] as string | undefined);
    const result = await handleStripeEvent(event);

    /*
     * Luôn trả 200 khi đã xác minh được chữ ký, kể cả khi không khớp đơn nào.
     *
     * Stripe coi mọi mã khác 2xx là "chưa nhận được" và bắn lại tới ba ngày. Một
     * sự kiện không bao giờ khớp được (đơn đã bị xoá, sự kiện của môi trường
     * test) sẽ được thử lại vô ích hàng trăm lần. Sự kiện vẫn được ghi đầy đủ
     * vào bảng `payment_events` để admin tra soát.
     */
    res.json({ received: true, ...result });
  }),
);
