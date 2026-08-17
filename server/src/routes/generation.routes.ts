import { Router } from 'express';
import { query, queryOne, type RowDataPacket } from '../db.js';
import { readAccountState } from '../services/subscriptionService.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { optionalString, parsePaging, requireInt, requireString, requireStringArray } from '../lib/validate.js';
import {
  createGenerations,
  deleteGeneration,
  redoGeneration,
  serializeGeneration,
  type GenerationRow,
} from '../services/generationService.js';

export const generationRouter = Router();

generationRouter.use(requireAuth);

/**
 * Tạo một lô ảnh.
 *
 * Client gửi ảnh mẫu + ảnh sản phẩm dạng data URI. Server lưu mỗi ảnh đúng một
 * lần rồi nhân bản thành `referenceImages.length × quantityPerReference` lệnh vẽ,
 * nên payload không phình lên khi tạo nhiều ảnh.
 */
generationRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await createGenerations(req.user!.id, {
      modelCode: requireString(req.body, 'modelCode', { label: 'Model' }),
      aspectRatio: requireString(req.body, 'aspectRatio', { label: 'Aspect ratio' }),
      prompt: typeof req.body.prompt === 'string' ? req.body.prompt : '',
      referenceImages: requireStringArray(req.body, 'referenceImages', { max: 8, label: 'Reference images' }),
      productImages: requireStringArray(req.body, 'productImages', { max: 3, label: 'Product images' }),
      quantityPerReference: requireInt(req.body, 'quantityPerReference', { min: 1, max: 4, label: 'Quantity' }),
      clientSession: optionalString(req.body, 'clientSession', 64),
    });

    const rows = await query<GenerationRow>(
      `SELECT * FROM generations WHERE id IN (${result.generationIds.map(() => '?').join(',')}) ORDER BY id DESC`,
      result.generationIds,
    );

    res.status(202).json({
      batchId: result.batchId,
      tokenCost: result.tokenCost,
      tokenBalance: result.balance,
      generations: rows.map(serializeGeneration),
    });
  }),
);

/** Lịch sử ảnh của người dùng. */
generationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePaging(req.query as Record<string, unknown>, 24);

    // Nhận nhiều trạng thái phân tách bằng dấu phẩy, vd ?status=queued,processing
    // để trang tạo ảnh lấy đúng những ảnh còn đang chạy.
    const allowed = ['queued', 'processing', 'success', 'failed', 'refunded'];
    const statuses = String(req.query.status ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => allowed.includes(value));

    // Ảnh khách đã xoá chỉ bị ẩn khỏi giao diện, dòng vẫn nằm trong DB để trang
    // Quản trị tính đúng doanh thu và giá vốn.
    const filters = ['user_id = ?', 'deleted_at IS NULL'];
    const params: unknown[] = [req.user!.id];
    if (statuses.length > 0) {
      filters.push(`status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }

    /*
     * ?session=... để một tab chỉ nạp lại việc của chính nó.
     *
     * Là bộ lọc TUỲ CHỌN chứ không bắt buộc: trang Lịch sử cố tình không gửi, vì
     * ở đó khách muốn xem toàn bộ ảnh mình từng tạo, bất kể tạo từ tab nào.
     */
    const session = typeof req.query.session === 'string' ? req.query.session.trim().slice(0, 64) : '';
    if (session) {
      filters.push('client_session = ?');
      params.push(session);
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const rows = await query<GenerationRow>(`SELECT * FROM generations ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset,
    ]);
    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM generations ${where}`,
      params,
    );

    res.json({ generations: rows.map(serializeGeneration), page, limit, total: total?.total ?? 0 });
  }),
);

/**
 * Tra trạng thái nhiều ảnh cùng lúc — client dùng để cập nhật lưới kết quả
 * mà không phải gọi một request cho mỗi ảnh.
 */
generationRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = raw
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 50);

    /*
     * PHẢI trả về tổng dùng được (hạn mức tháng + điểm đã mua), không phải cột
     * users.token_balance — cột đó chỉ là phần điểm MUA THÊM.
     *
     * Giao diện gọi endpoint này 3 giây một lần trong lúc vẽ ảnh và ghi đè số dư
     * đang hiển thị bằng giá trị trả về. Trả nhầm cột khiến khách nào tiêu bằng
     * hạn mức tháng (token_balance = 0) thấy số dư tụt về 0 ngay khi bắt đầu tạo
     * ảnh, kèm theo nút bấm đổi thành "Hết hạn mức".
     */
    if (ids.length === 0) {
      const state = await readAccountState(req.user!.id);
      res.json({ generations: [], tokenBalance: state.availableTokens });
      return;
    }

    const rows = await query<GenerationRow>(
      `SELECT * FROM generations
        WHERE user_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
      [req.user!.id, ...ids],
    );
    const state = await readAccountState(req.user!.id);

    res.json({ generations: rows.map(serializeGeneration), tokenBalance: state.availableTokens });
  }),
);

generationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne<GenerationRow>(
      'SELECT * FROM generations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [Number(req.params.id), req.user!.id],
    );
    if (!row) throw notFound('Image not found.');
    res.json({ generation: serializeGeneration(row) });
  }),
);

/**
 * Xoá một ảnh khỏi trang Lịch sử.
 *
 * Xoá mềm — xem `deleteGeneration`. Không hoàn điểm: ảnh đã vẽ xong là dịch vụ
 * đã cung cấp, khách dọn màn hình của mình chứ không phải huỷ đơn.
 */
generationRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteGeneration(req.user!.id, Number(req.params.id));
    res.status(204).end();
  }),
);

/** Vẽ lại với prompt mới, dùng lại ảnh đầu vào cũ. Trừ điểm như một ảnh mới. */
generationRouter.post(
  '/:id/redo',
  asyncHandler(async (req, res) => {
    const result = await redoGeneration(
      req.user!.id,
      Number(req.params.id),
      typeof req.body.prompt === 'string' ? req.body.prompt : '',
    );

    const row = await queryOne<GenerationRow>('SELECT * FROM generations WHERE id = ?', [result.generationId]);
    res.status(202).json({
      generation: row ? serializeGeneration(row) : null,
      tokenCost: result.tokenCost,
      tokenBalance: result.balance,
    });
  }),
);
