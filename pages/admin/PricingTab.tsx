import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Card, TableWrap } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatNumberVi, formatUsd } from '../../lib/format';
import type { AdminModelPricing, AdminPackage, AdminPlan } from '../../types';

/**
 * Số tiền lưu bằng CENT nhưng admin gõ bằng ĐÔ-LA.
 *
 * Bắt người vận hành gõ "4999" cho gói $49,99 là công thức sai giá: gõ thiếu một
 * số 0 thì gói $49,99 thành $4,99 mà nhìn vào ô nhập không thấy gì bất thường.
 */
const centsToDollars = (cents: number): string => (cents / 100).toFixed(2);
const dollarsToCents = (value: string): number => Math.round(Number(value.replace(/[^0-9.-]/g, '')) * 100);

/** Ô nhập chỉnh sửa tại chỗ: chỉ gọi API khi giá trị thực sự đổi và rời khỏi ô. */
const EditableCell: React.FC<{
  value: string | number;
  onSave: (value: string) => Promise<void>;
  align?: 'left' | 'right';
  width?: string;
}> = ({ value, onSave, align = 'right', width = 'w-20' }) => {
  const [draft, setDraft] = useState(String(value));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setDraft(String(value)), [value]);

  const commit = async () => {
    if (draft === String(value)) return;
    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <input
      className={`${width} bg-dark-850 border border-dark-700 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-brand-500 outline-none transition-colors ${
        align === 'right' ? 'text-right' : ''
      } ${isSaving ? 'opacity-50' : ''}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      disabled={isSaving}
    />
  );
};

export const PricingTab: React.FC = () => {
  const [models, setModels] = useState<AdminModelPricing[]>([]);
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [creditsPerUsd, setUsdToVnd] = useState(28000);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [modelData, packageData, planData] = await Promise.all([
      api.get<{ models: AdminModelPricing[]; creditsPerUsd: number }>('/admin/pricing'),
      api.get<{ packages: AdminPackage[] }>('/admin/packages'),
      api.get<{ plans: AdminPlan[] }>('/admin/plans'),
    ]);
    setModels(modelData.models);
    setUsdToVnd(modelData.creditsPerUsd);
    setPackages(packageData.packages);
    setPlans(planData.plans);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateModel = async (id: number, patch: Record<string, unknown>) => {
    setMessage(null);
    try {
      await api.patch(`/admin/pricing/${id}`, patch);
      await load();
      setMessage({ tone: 'success', text: 'Đã lưu bảng giá.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Lưu thất bại.' });
      await load();
    }
  };

  const updatePackage = async (id: number, patch: Record<string, unknown>) => {
    setMessage(null);
    try {
      await api.patch(`/admin/packages/${id}`, patch);
      await load();
      setMessage({ tone: 'success', text: 'Đã lưu gói nạp.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Lưu thất bại.' });
      await load();
    }
  };

  const updatePlan = async (id: number, patch: Record<string, unknown>) => {
    setMessage(null);
    try {
      await api.patch(`/admin/plans/${id}`, patch);
      await load();
      setMessage({ tone: 'success', text: 'Đã lưu gói dịch vụ.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Lưu thất bại.' });
      await load();
    }
  };

  return (
    <div className="space-y-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-bold text-gray-100">Gói tháng — đã ngừng bán</h2>
          <p className="text-xs text-gray-500 mt-1">
            Hệ thống nay <strong>chỉ bán điểm</strong>: khách mua điểm là dùng được ngay, không phải mua gói. Bảng này
            giữ lại để bạn <strong>cấp gói tay</strong> cho khách VIP ở tab Khách hàng → nút "Gói", và để các gói đã bán
            trước đây chạy hết hạn. Cột <strong>Bán</strong> không còn tác dụng gì với khách — không có màn hình nào của
            khách hiện các gói này nữa. <strong>Hạn mức</strong> được cấp lại mỗi tháng và không cộng dồn; 10.000 điểm = $1
            giá vốn.
          </p>
        </div>

        <TableWrap>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
              <th className="text-left font-bold py-2">Mã</th>
              <th className="text-left font-bold py-2">Tên gói</th>
              <th className="text-right font-bold py-2">Chu kỳ</th>
              <th className="text-right font-bold py-2">Giá cả kỳ ($)</th>
              <th className="text-right font-bold py-2">Quy ra/tháng</th>
              <th className="text-right font-bold py-2">Hạn mức/tháng</th>
              <th className="text-center font-bold py-2">Nổi bật</th>
              <th className="text-center font-bold py-2">Bán</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="border-b border-dark-850 last:border-0">
                <td className="py-2 text-gray-500 text-xs font-mono">{plan.code}</td>
                <td className="py-2">
                  <EditableCell
                    value={plan.name}
                    align="left"
                    width="w-32"
                    onSave={(value) => updatePlan(plan.id, { name: value })}
                  />
                </td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={plan.months}
                    width="w-14"
                    onSave={(value) => updatePlan(plan.id, { months: Number(value) })}
                  />
                </td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={centsToDollars(plan.priceUsdCents)}
                    width="w-28"
                    onSave={(value) => updatePlan(plan.id, { priceUsdCents: dollarsToCents(value) })}
                  />
                </td>
                <td className="py-2 text-right text-gray-400 text-xs">{formatUsd(plan.pricePerMonthUsdCents)}</td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={plan.monthlyTokenAllowance}
                    width="w-24"
                    onSave={(value) => updatePlan(plan.id, { monthlyTokenAllowance: Number(value) })}
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={plan.isPopular}
                    onChange={(e) => updatePlan(plan.id, { isPopular: e.target.checked })}
                    className="accent-brand-500 cursor-pointer"
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={plan.isActive}
                    onChange={(e) => updatePlan(plan.id, { isActive: e.target.checked })}
                    className="accent-brand-500 cursor-pointer"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-bold text-gray-100">Bảng giá model</h2>
          <p className="text-xs text-gray-500 mt-1">
            <strong>Giá vốn</strong> là giá nhà cung cấp thu mỗi ảnh (theo bảng giá Kie.ai).{' '}
            <strong>Điểm thu</strong> là số điểm trừ của khách. Sửa trực tiếp trong ô rồi bấm ra ngoài để lưu.
          </p>
          <p className="text-xs text-gray-500 mt-1.5">
            <strong>Mốc quy đổi</strong> chọn model dùng để tính dòng "Tạo được tới N ảnh" trên thẻ gói điểm — ở cả
            trang giới thiệu lẫn trang Mua điểm. Công thức: <em>số điểm của gói ÷ Điểm thu của model này</em>, làm tròn
            xuống. Đổi Điểm thu ở đây là số ảnh trên thẻ gói tự đổi theo. Chỉ một model được chọn.
          </p>
        </div>

        <TableWrap>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
              <th className="text-left font-bold py-2">Model</th>
              <th className="text-left font-bold py-2">Slug gửi API</th>
              <th className="text-left font-bold py-2">Độ phân giải</th>
              <th className="text-right font-bold py-2">Giá vốn (USD)</th>
              <th className="text-right font-bold py-2">Điểm thu</th>
              <th className="text-right font-bold py-2">Giá bán</th>
              <th className="text-right font-bold py-2">Biên</th>
              <th className="text-center font-bold py-2">Mốc quy đổi</th>
              <th className="text-center font-bold py-2">Bán</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id} className="border-b border-dark-850 last:border-0">
                <td className="py-2 text-gray-300 text-xs">{model.label}</td>
                <td className="py-2">
                  <EditableCell
                    value={model.providerModel}
                    align="left"
                    width="w-36"
                    onSave={(value) => updateModel(model.id, { providerModel: value })}
                  />
                </td>
                <td className="py-2 text-gray-400 text-xs">{model.resolution}</td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={model.apiCostUsd}
                    width="w-20"
                    onSave={(value) => updateModel(model.id, { apiCostUsd: Number(value) })}
                  />
                </td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={model.tokenCost}
                    width="w-16"
                    onSave={(value) => updateModel(model.id, { tokenCost: Number(value) })}
                  />
                </td>
                <td className="py-2 text-right text-gray-300 text-xs">{formatUsd(model.sellPriceUsdCents)}</td>
                <td
                  className={`py-2 text-right text-xs font-semibold ${
                    model.marginPercent >= 50 ? 'text-green-400' : model.marginPercent >= 30 ? 'text-amber-400' : 'text-red-400'
                  }`}
                >
                  {model.marginPercent}%
                </td>
                <td className="py-2 text-center">
                  {/*
                    Radio chứ không phải checkbox: chỉ MỘT model được làm mốc, và
                    radio nói đúng điều đó cho người dùng ngay từ hình dáng. Cùng
                    một `name` nên trình duyệt tự bỏ chọn dòng cũ; server cũng tự
                    tắt cờ ở các dòng còn lại trong cùng transaction.

                    Khoá ở model đã tắt bán: bảng giá công khai chỉ trả về model
                    đang bán, nên chọn model tắt thì phía khách không thấy nó và
                    số ảnh lặng lẽ rơi về model dự phòng — admin sửa Điểm thu mãi
                    mà con số ngoài trang không nhúc nhích, không hiểu vì sao.
                  */}
                  <input
                    type="radio"
                    name="estimate-reference"
                    checked={model.isEstimateReference}
                    disabled={!model.isActive}
                    title={
                      model.isActive
                        ? 'Dùng model này để tính "Tạo được tới N ảnh" trên thẻ gói điểm'
                        : 'Phải bật Bán trước thì mới chọn làm mốc quy đổi được'
                    }
                    onChange={() => updateModel(model.id, { isEstimateReference: true })}
                    className="accent-brand-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={model.isActive}
                    onChange={(e) => updateModel(model.id, { isActive: e.target.checked })}
                    className="accent-brand-500 cursor-pointer"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>

        <p className="text-[11px] text-gray-600 mt-3">
          Quy ước điểm hiện tại: <strong>{formatNumberVi(creditsPerUsd)} điểm = $1 giá vốn</strong> nhà cung cấp (sửa
          bằng <code>CREDITS_PER_USD</code> trong <code>.env</code> — đọc chú thích trong <code>env.ts</code> trước khi
          đụng tới). Cột <strong>Giá bán</strong> là doanh thu của một ảnh theo đơn giá bán gấp đôi giá vốn.
        </p>
      </Card>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-bold text-gray-100">Gói điểm</h2>
          <p className="text-xs text-gray-500 mt-1">
            Sản phẩm <strong>duy nhất đang bán</strong>. Quy tắc định giá: bán <strong>gấp đôi giá vốn</strong>, tức
            $1 mua được 5.000 điểm. Giá nhập bằng <strong>đô-la</strong> (vd 49.99), hệ thống tự quy sang cent. Điểm đã
            mua không hết hạn.
            <br />
            <strong>Tên gói</strong> và <strong>Mô tả</strong> HIỂN THỊ CHO KHÁCH ở trang giới thiệu và trang Mua điểm
            nên phải viết bằng <strong>tiếng Anh</strong> — để trống mô tả thì thẻ không hiện dòng đó.
          </p>
        </div>

        <TableWrap>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
              <th className="text-left font-bold py-2">Mã</th>
              <th className="text-left font-bold py-2">Tên gói</th>
              <th className="text-left font-bold py-2">Mô tả</th>
              <th className="text-right font-bold py-2">Giá bán ($)</th>
              <th className="text-right font-bold py-2">Điểm cơ bản</th>
              <th className="text-right font-bold py-2">Điểm thưởng</th>
              <th className="text-right font-bold py-2">Tổng nhận</th>
              <th className="text-right font-bold py-2">Giá/điểm (¢)</th>
              <th className="text-center font-bold py-2">Nổi bật</th>
              <th className="text-center font-bold py-2">Bán</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={pkg.id} className="border-b border-dark-850 last:border-0">
                <td className="py-2 text-gray-500 text-xs font-mono">{pkg.code}</td>
                <td className="py-2">
                  <EditableCell
                    value={pkg.name}
                    align="left"
                    width="w-32"
                    onSave={(value) => updatePackage(pkg.id, { name: value })}
                  />
                </td>
                <td className="py-2">
                  <EditableCell
                    value={pkg.description ?? ''}
                    align="left"
                    width="w-64"
                    onSave={(value) => updatePackage(pkg.id, { description: value.trim() || null })}
                  />
                </td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={centsToDollars(pkg.priceUsdCents)}
                    width="w-24"
                    onSave={(value) => updatePackage(pkg.id, { priceUsdCents: dollarsToCents(value) })}
                  />
                </td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={pkg.baseTokens}
                    width="w-20"
                    onSave={(value) => updatePackage(pkg.id, { baseTokens: Number(value) })}
                  />
                </td>
                <td className="py-2 text-right">
                  <EditableCell
                    value={pkg.bonusTokens}
                    width="w-20"
                    onSave={(value) => updatePackage(pkg.id, { bonusTokens: Number(value) })}
                  />
                </td>
                <td className="py-2 text-right text-brand-500 font-semibold text-xs">
                  {formatNumberVi(pkg.totalTokens)}
                </td>
                <td className="py-2 text-right text-gray-500 text-xs">
                  {pkg.pricePerTokenCents.toFixed(4)}¢
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={pkg.isPopular}
                    onChange={(e) => updatePackage(pkg.id, { isPopular: e.target.checked })}
                    className="accent-brand-500 cursor-pointer"
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={pkg.isActive}
                    onChange={(e) => updatePackage(pkg.id, { isActive: e.target.checked })}
                    className="accent-brand-500 cursor-pointer"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
};
