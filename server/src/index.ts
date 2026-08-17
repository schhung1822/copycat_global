import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { assertConnection, closePool, migrate } from './db.js';
import { checkEnv, env, ROOT_DIR } from './env.js';
import { attachUser } from './lib/auth.js';
import { errorHandler } from './lib/errors.js';
import { adminRouter } from './routes/admin.routes.js';
import { affiliateRouter } from './routes/affiliate.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { generationRouter } from './routes/generation.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { walletRouter } from './routes/wallet.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';
import { seed } from './seed.js';
import { recoverStaleGenerations } from './services/generationService.js';
import { expireStaleOrders, fulfillPaidOrders } from './services/orderService.js';
import { expireStaleSubscriptions } from './services/subscriptionService.js';
import { ensureStorage } from './services/storageService.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

/*
 * Webhook đứng TRƯỚC express.json() và trước attachUser.
 *
 * Trước attachUser vì cổng thanh toán xác thực bằng chữ ký riêng chứ không có
 * phiên đăng nhập. Trước express.json() vì Stripe ký trên chuỗi byte gốc của
 * request — parse thành object rồi dựng lại là chữ ký không còn khớp; router tự
 * gắn `express.raw` cho riêng đường dẫn của mình.
 */
app.use('/api/webhooks', webhookRouter);

// Ảnh gửi lên dưới dạng base64 nên body có thể khá lớn.
app.use(express.json({ limit: '40mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use(attachUser);
app.use('/api/auth', authRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/orders', orderRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/generations', generationRouter);
app.use('/api/affiliate', affiliateRouter);
app.use('/api/admin', adminRouter);

// Ảnh đầu vào và ảnh kết quả đã tải về server.
app.use(
  '/files',
  // fallthrough mặc định: ảnh không tồn tại rơi xuống handler 404 JSON ở cuối,
  // thay vì ném lỗi và bị ghi nhận nhầm thành lỗi hệ thống.
  express.static(env.storageDir, { maxAge: '30d', immutable: true }),
);

// Khi đã `npm run build`, server phục vụ luôn bản web tĩnh (chạy 1 tiến trình duy nhất).
const distDir = path.join(ROOT_DIR, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|files).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'not_found' });
});

app.use(errorHandler);

async function start(): Promise<void> {
  checkEnv();

  if (env.db.autoMigrate) {
    await migrate();
    console.log('[khởi động] Đã kiểm tra / tạo xong cấu trúc cơ sở dữ liệu.');
  }
  await assertConnection();
  await seed();
  await ensureStorage();
  await recoverStaleGenerations();

  // Xử lý ngay các đơn đã được đánh dấu 'paid' trong lúc server không chạy.
  const recovered = await fulfillPaidOrders();
  if (recovered > 0) console.log(`[khởi động] Đã xử lý ${recovered} đơn thanh toán còn tồn.`);

  // Đối soát đơn do hệ thống ngoài đánh dấu đã thanh toán.
  // Đây là đường để workflow bên ngoài chỉ cần UPDATE orders SET status='paid',
  // server tự kích hoạt gói / cộng điểm.
  const syncTimer = setInterval(() => {
    void fulfillPaidOrders().catch((error) => console.error('[đối soát đơn]', error));
  }, env.orderSyncIntervalSeconds * 1000);
  syncTimer.unref();

  // Dọn đơn quá hạn và đánh dấu thuê bao hết hạn, mỗi 5 phút.
  // Hạn mức tháng KHÔNG reset ở đây — nó được cấp lại ngay lúc khách dùng tới,
  // nên số liệu luôn đúng kể cả khi server vừa khởi động lại.
  const cleanupTimer = setInterval(() => {
    void expireStaleOrders().catch((error) => console.error('[dọn đơn hết hạn]', error));
    void expireStaleSubscriptions().catch((error) => console.error('[dọn thuê bao hết hạn]', error));
  }, 5 * 60 * 1000);
  cleanupTimer.unref();

  // In trước khi mở cổng, để thông tin này vẫn hiện ra kể cả khi bind thất bại.
  if (fs.existsSync(distDir)) {
    console.log('[khởi động] Đã tìm thấy thư mục dist/, server phục vụ luôn giao diện web.');
  } else {
    console.warn(
      '[khởi động] KHÔNG thấy thư mục dist/. Truy cập thẳng vào cổng này sẽ chỉ nhận JSON 404.\n' +
        '            Chạy `npm run build` nếu đây là môi trường chạy thật, hoặc `npm run dev` nếu đang phát triển.',
    );
  }

  const server = app.listen(env.port, env.host, () => {
    console.log(`[khởi động] API đang lắng nghe tại ${env.host}:${env.port}`);
  });

  // Không có handler thì lỗi bind cổng sẽ ném ra dạng stack trace khó đọc.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n[khởi động thất bại] Cổng ${env.port} đang bị tiến trình khác chiếm.\n` +
          '  Gần như luôn là do một bản server cũ vẫn còn chạy. Xem nó là ai:\n' +
          `      ss -tlnp | grep :${env.port}\n` +
          '      pm2 list\n' +
          '  Dọn sạch rồi chạy lại:\n' +
          '      pm2 delete all\n' +
          '      pkill -f "server/src/index.ts"\n' +
          '  Nếu muốn chạy song song nhiều bản, đổi PORT trong file .env.',
      );
    } else if (error.code === 'EACCES') {
      console.error(
        `\n[khởi động thất bại] Không có quyền mở cổng ${env.port}.\n` +
          '  Cổng dưới 1024 cần quyền root. Hãy dùng cổng lớn hơn (vd 4000) rồi cho nginx trỏ vào.',
      );
    } else {
      console.error('\n[khởi động thất bại]', error.message);
    }
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[tắt] Nhận tín hiệu ${signal}, đang đóng kết nối...`);
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('\n[khởi động thất bại]', error instanceof Error ? error.message : error);
  process.exit(1);
});
