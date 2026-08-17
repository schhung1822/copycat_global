import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Alert, Card, EmptyState, Field, StatCard, TableWrap, inputClass, selectClass } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { formatDateTimeVi, formatNumberVi, formatUsd } from '../../lib/format';
import type { AdminAffiliate, AdminCommission, AffiliateExample, AffiliateSettings, CommissionStatus } from '../../types';

const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: 'Chờ chi trả',
  paid: 'Đã trả',
  cancelled: 'Đã huỷ',
};

const COMMISSION_STATUS_CLASS: Record<CommissionStatus, string> = {
  pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/60',
  paid: 'bg-green-900/30 text-green-400 border-green-900/60',
  cancelled: 'bg-dark-800 text-gray-500 border-dark-700',
};

/**
 * Quản trị chương trình tiếp thị liên kết: tỉ lệ hoa hồng, danh sách cộng tác
 * viên và sổ chi trả.
 *
 * Cấp / thu hồi vai trò affiliate nằm ở tab **Khách hàng** (nút "Affiliate" trên
 * từng dòng) — đó là nơi admin đã có sẵn ô tìm kiếm theo email và toàn bộ thông
 * tin của khách để quyết định.
 */
export const AffiliateTab: React.FC = () => {
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [affiliates, setAffiliates] = useState<AdminAffiliate[] | null>(null);
  const [commissions, setCommissions] = useState<AdminCommission[]>([]);
  const [totals, setTotals] = useState({ pendingUsdCents: 0, paidUsdCents: 0 });
  const [statusFilter, setStatusFilter] = useState('');
  const [affiliateFilter, setAffiliateFilter] = useState(0);

  const loadAffiliates = useCallback(async () => {
    const data = await api.get<{ affiliates: AdminAffiliate[] }>('/admin/affiliate/affiliates');
    setAffiliates(data.affiliates);
  }, []);

  const loadCommissions = useCallback(async () => {
    const data = await api.get<{ commissions: AdminCommission[]; pendingUsdCents: number; paidUsdCents: number }>(
      `/admin/affiliate/commissions${qs({ status: statusFilter, affiliateId: affiliateFilter || '', limit: 50 })}`,
    );
    setCommissions(data.commissions);
    setTotals({ pendingUsdCents: data.pendingUsdCents, paidUsdCents: data.paidUsdCents });
  }, [statusFilter, affiliateFilter]);

  useEffect(() => {
    void loadAffiliates();
  }, [loadAffiliates]);

  useEffect(() => {
    void loadCommissions();
  }, [loadCommissions]);

  const reloadAll = async () => {
    await Promise.all([loadAffiliates(), loadCommissions()]);
  };

  const changeStatus = async (row: AdminCommission, status: CommissionStatus) => {
    try {
      await api.post(`/admin/affiliate/commissions/${row.id}/status`, { status });
      setMessage({
        tone: 'success',
        text: `Đơn ${row.orderCode}: hoa hồng ${formatUsd(row.commissionUsdCents)} của ${row.affiliate.email} đã chuyển sang "${COMMISSION_STATUS_LABEL[status]}".`,
      });
      await reloadAll();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Thao tác thất bại.' });
    }
  };

  const payAll = async (affiliate: AdminAffiliate) => {
    if (
      !confirm(
        `Đánh dấu đã chi trả toàn bộ ${formatUsd(affiliate.stats.pendingUsdCents)} hoa hồng đang chờ của ${affiliate.email}?\n\n` +
          'Thao tác này chỉ ghi nhận trong hệ thống — tiền phải được chuyển bằng tay ở ngân hàng.',
      )
    ) {
      return;
    }

    try {
      const data = await api.post<{ count: number; amountUsdCents: number }>(
        `/admin/affiliate/affiliates/${affiliate.id}/pay`,
      );
      setMessage({
        tone: 'success',
        text: `Đã chốt ${data.count} khoản (${formatUsd(data.amountUsdCents)}) cho ${affiliate.email}.`,
      });
      await reloadAll();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Thao tác thất bại.' });
    }
  };

  const totalPending = (affiliates ?? []).reduce((sum, item) => sum + item.stats.pendingUsdCents, 0);
  const totalPaid = (affiliates ?? []).reduce((sum, item) => sum + item.stats.paidUsdCents, 0);
  const totalRevenue = (affiliates ?? []).reduce((sum, item) => sum + item.stats.revenueUsdCents, 0);
  const totalReferrals = (affiliates ?? []).reduce((sum, item) => sum + item.stats.referrals, 0);

  return (
    <div className="space-y-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Đang nợ cộng tác viên"
          value={formatUsd(totalPending)}
          sub="hoa hồng chưa chi trả"
          tone={totalPending > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Đã chi trả" value={formatUsd(totalPaid)} sub="tổng từ trước tới nay" />
        <StatCard label="Doanh thu từ giới thiệu" value={formatUsd(totalRevenue)} sub="các đơn có người giới thiệu" />
        <StatCard
          label="Khách đến từ link"
          value={formatNumberVi(totalReferrals)}
          sub={`${formatNumberVi(affiliates?.length ?? 0)} cộng tác viên`}
        />
      </div>

      <SettingsCard onSaved={reloadAll} onMessage={setMessage} />

      <Card className="p-4">
        <h2 className="font-bold text-gray-100 mb-3">Cộng tác viên</h2>
        {!affiliates ? (
          <p className="text-sm text-gray-600 py-6 text-center">Đang tải...</p>
        ) : affiliates.length === 0 ? (
          <EmptyState
            title="Chưa có cộng tác viên nào."
            hint='Sang tab "Khách hàng", tìm tài khoản rồi bấm nút "Affiliate" để cấp vai trò.'
          />
        ) : (
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Cộng tác viên</th>
                <th className="text-left font-bold py-2">Link giới thiệu</th>
                <th className="text-right font-bold py-2">Khách</th>
                <th className="text-right font-bold py-2">Doanh thu</th>
                <th className="text-right font-bold py-2">Chờ trả</th>
                <th className="text-right font-bold py-2">Đã trả</th>
                <th className="text-right font-bold py-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((row) => (
                <tr key={row.id} className="border-b border-dark-850 last:border-0 align-top">
                  <td className="py-2.5">
                    <p className="text-gray-300 text-xs">{row.email}</p>
                    <p className="text-[10px] text-gray-600">{row.fullName || 'Chưa đặt tên'}</p>
                  </td>
                  <td className="py-2.5">
                    <code className="text-[11px] text-brand-500">{row.code ?? '—'}</code>
                    {row.referralLink && (
                      <p className="text-[10px] text-gray-600 truncate max-w-[220px]" title={row.referralLink}>
                        {row.referralLink}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-gray-300">
                    {formatNumberVi(row.stats.referrals)}
                    <p className="text-[10px] text-gray-600">{formatNumberVi(row.stats.payingReferrals)} đã mua</p>
                  </td>
                  <td className="py-2.5 text-right text-gray-300">{formatUsd(row.stats.revenueUsdCents)}</td>
                  <td
                    className={`py-2.5 text-right font-semibold ${
                      row.stats.pendingUsdCents > 0 ? 'text-amber-400' : 'text-gray-600'
                    }`}
                  >
                    {formatUsd(row.stats.pendingUsdCents)}
                  </td>
                  <td className="py-2.5 text-right text-gray-400">{formatUsd(row.stats.paidUsdCents)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setAffiliateFilter(affiliateFilter === row.id ? 0 : row.id)}
                      className={`text-xs px-2 transition-colors ${
                        affiliateFilter === row.id ? 'text-brand-500' : 'text-gray-400 hover:text-gray-100'
                      }`}
                    >
                      {affiliateFilter === row.id ? 'Bỏ lọc' : 'Xem sổ'}
                    </button>
                    <button
                      onClick={() => payAll(row)}
                      disabled={row.stats.pendingCount === 0}
                      className="text-xs text-green-500 hover:text-green-400 px-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Chốt trả
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-bold text-gray-100">Sổ hoa hồng</h2>
          <select
            className={`${selectClass} !w-auto !py-1.5 text-xs`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="pending">Chờ chi trả</option>
            <option value="paid">Đã trả</option>
            <option value="cancelled">Đã huỷ</option>
          </select>
          {affiliateFilter > 0 && (
            <button onClick={() => setAffiliateFilter(0)} className="text-xs text-brand-500 hover:underline">
              Đang lọc theo 1 cộng tác viên — bỏ lọc
            </button>
          )}
          <span className="ml-auto text-xs text-gray-500">
            Chờ trả <strong className="text-amber-400">{formatUsd(totals.pendingUsdCents)}</strong> · đã trả{' '}
            <strong className="text-gray-300">{formatUsd(totals.paidUsdCents)}</strong>
          </span>
        </div>

        {commissions.length === 0 ? (
          <EmptyState title="Không có khoản hoa hồng nào khớp bộ lọc." />
        ) : (
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Thời gian</th>
                <th className="text-left font-bold py-2">Cộng tác viên</th>
                <th className="text-left font-bold py-2">Khách / đơn</th>
                <th className="text-right font-bold py-2">Doanh thu</th>
                <th className="text-right font-bold py-2">Giá vốn + CP</th>
                <th className="text-right font-bold py-2">Lợi nhuận</th>
                <th className="text-right font-bold py-2">Hoa hồng</th>
                <th className="text-right font-bold py-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((row) => (
                <tr key={row.id} className="border-b border-dark-850 last:border-0 align-top">
                  <td className="py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDateTimeVi(row.createdAt)}</td>
                  <td className="py-2.5 text-xs text-gray-300">{row.affiliate.email}</td>
                  <td className="py-2.5">
                    <p className="text-xs text-gray-400">{row.customer.email}</p>
                    <p className="text-[10px] text-gray-600 font-mono">{row.orderCode}</p>
                  </td>
                  <td className="py-2.5 text-right text-gray-300">{formatUsd(row.revenueUsdCents)}</td>
                  <td className="py-2.5 text-right text-gray-500 text-xs">
                    {formatUsd(row.tokenCostUsdCents + row.fixedCostUsdCents)}
                    {row.fixedCostUsdCents > 0 && (
                      <p className="text-[10px] text-gray-600">gồm CP cố định {formatUsd(row.fixedCostUsdCents)}</p>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-gray-400">{formatUsd(row.profitUsdCents)}</td>
                  <td className="py-2.5 text-right">
                    <span className="font-semibold text-brand-500">{formatUsd(row.commissionUsdCents)}</span>
                    <p className="mt-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                          COMMISSION_STATUS_CLASS[row.status]
                        }`}
                      >
                        {COMMISSION_STATUS_LABEL[row.status]}
                      </span>
                    </p>
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {row.status !== 'paid' && (
                      <button
                        onClick={() => changeStatus(row, 'paid')}
                        className="text-xs text-green-500 hover:text-green-400 px-2 transition-colors"
                      >
                        Đã trả
                      </button>
                    )}
                    {row.status !== 'cancelled' ? (
                      <button
                        onClick={() => changeStatus(row, 'cancelled')}
                        className="text-xs text-gray-500 hover:text-red-400 px-2 transition-colors"
                        title="Dùng khi đơn bị hoàn tiền hoặc phát hiện gian lận"
                      >
                        Huỷ
                      </button>
                    ) : (
                      <button
                        onClick={() => changeStatus(row, 'pending')}
                        className="text-xs text-gray-500 hover:text-gray-300 px-2 transition-colors"
                      >
                        Khôi phục
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

/**
 * Cấu hình tỉ lệ hoa hồng và chi phí cố định.
 *
 * Ví dụ minh hoạ do SERVER tính trên một gói điểm đang bán thật, nên con số admin
 * nhìn thấy trước khi lưu đúng bằng con số sẽ được ghi vào sổ. Ví dụ chỉ cập nhật
 * sau khi bấm Lưu — cố ý, để nó luôn phản ánh cấu hình đang thực sự có hiệu lực
 * chứ không phải thứ admin mới gõ dở trong ô nhập.
 */
const SettingsCard: React.FC<{
  onSaved: () => void | Promise<void>;
  onMessage: (message: { tone: 'success' | 'error'; text: string }) => void;
}> = ({ onSaved, onMessage }) => {
  const [settings, setSettings] = useState<AffiliateSettings | null>(null);
  const [example, setExample] = useState<AffiliateExample | null>(null);
  const [form, setForm] = useState({ commissionPercent: '', fixedCostDollars: '', fixedCostPercent: '' });
  const [enabled, setEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const data = await api.get<{ settings: AffiliateSettings; example: AffiliateExample | null }>(
      '/admin/affiliate/settings',
    );
    setSettings(data.settings);
    setExample(data.example);
    setEnabled(data.settings.enabled);
    setForm({
      commissionPercent: String(data.settings.commissionPercent),
      fixedCostDollars: (data.settings.fixedCostUsdCents / 100).toFixed(2),
      fixedCostPercent: String(data.settings.fixedCostPercent),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const percent = Number(form.commissionPercent);
    // Admin gõ bằng đô-la, hệ thống lưu bằng cent — xem chú thích ở PricingTab.
    const fixedCents = Math.round(Number(form.fixedCostDollars) * 100);
    const fixedPercent = Number(form.fixedCostPercent);

    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return onMessage({ tone: 'error', text: 'Tỉ lệ hoa hồng phải nằm trong khoảng 0 – 100%.' });
    }
    if (!Number.isFinite(fixedCents) || fixedCents < 0) {
      return onMessage({ tone: 'error', text: 'Chi phí cố định mỗi đơn phải là số không âm.' });
    }
    if (!Number.isFinite(fixedPercent) || fixedPercent < 0 || fixedPercent > 100) {
      return onMessage({ tone: 'error', text: 'Chi phí cố định theo doanh thu phải nằm trong khoảng 0 – 100%.' });
    }

    setIsSaving(true);
    try {
      await api.patch('/admin/affiliate/settings', {
        enabled,
        commissionPercent: percent,
        fixedCostUsdCents: fixedCents,
        fixedCostPercent: fixedPercent,
      });
      await load();
      await onSaved();
      onMessage({
        tone: 'success',
        text: `Đã lưu: hoa hồng ${percent}% lợi nhuận${enabled ? '' : ' · chương trình đang TẠM DỪNG'}.`,
      });
    } catch (err) {
      onMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Lưu thất bại.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) return null;

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: e.target.value })),
  });

  return (
    <Card className="p-5">
      <h2 className="font-bold text-gray-100">Cấu hình chương trình</h2>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Hoa hồng = (số tiền khách trả − giá vốn số điểm đã bán − chi phí cố định) × tỉ lệ. Thay đổi chỉ áp dụng cho đơn
        phát sinh <strong className="text-gray-400">từ sau khi lưu</strong>; các khoản đã ghi nhận giữ nguyên tỉ lệ cũ.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Tỉ lệ hoa hồng (%)" hint="Phần trăm trên lợi nhuận của mỗi đơn.">
            <input className={inputClass} inputMode="decimal" {...field('commissionPercent')} />
          </Field>
          <Field label="Chi phí cố định mỗi đơn ($)" hint="Phí Stripe, phí xử lý... trừ thẳng vào từng đơn.">
            <input className={inputClass} inputMode="decimal" {...field('fixedCostDollars')} />
          </Field>
          <Field label="Chi phí cố định theo doanh thu (%)" hint="Hạ tầng, nhân sự, marketing... phân bổ theo doanh thu.">
            <input className={inputClass} inputMode="decimal" {...field('fixedCostPercent')} />
          </Field>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-brand-500"
          />
          <span className="text-sm text-gray-300">
            Chương trình đang chạy
            <span className="block text-[11px] text-gray-600">
              Tắt đi thì đơn mới không sinh hoa hồng nữa, nhưng link giới thiệu vẫn hoạt động và các khoản đã ghi nhận
              vẫn phải chi trả.
            </span>
          </span>
        </label>

        {example && (
          <div className="rounded-xl border border-dark-800 bg-dark-950/60 px-4 py-3 text-[11px] text-gray-500 leading-relaxed">
            <strong className="text-gray-400">Ví dụ theo cấu hình đang áp dụng</strong> — gói{' '}
            <strong className="text-gray-300">{example.packageName}</strong> ({formatNumberVi(example.tokens)} điểm):
            <br />
            {formatUsd(example.revenueUsdCents)} doanh thu − {formatUsd(example.tokenCostUsdCents)} giá vốn điểm
            {example.fixedCostUsdCents > 0 && <> − {formatUsd(example.fixedCostUsdCents)} chi phí cố định</>} ={' '}
            <strong className="text-gray-300">{formatUsd(example.profitUsdCents)}</strong> lợi nhuận → cộng tác viên nhận{' '}
            <strong className="text-brand-500">{formatUsd(example.commissionUsdCents)}</strong> ({example.commissionPercent}
            %).
            {example.profitUsdCents <= 0 && (
              <span className="block mt-1 text-amber-400">
                Lợi nhuận không dương nên đơn kiểu này không sinh hoa hồng. Kiểm tra lại chi phí cố định.
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" isLoading={isSaving} className="!rounded-xl">
            Lưu cấu hình
          </Button>
        </div>
      </form>
    </Card>
  );
};
