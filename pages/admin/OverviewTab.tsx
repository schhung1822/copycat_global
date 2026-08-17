import React, { useEffect, useState } from 'react';
import { BarChart, CHART_COLORS } from '../../components/BarChart';
import { Alert, Card, PageLoader, StatCard, TableWrap } from '../../components/ui';
import { api } from '../../lib/api';
import { formatNumberVi, formatUsd } from '../../lib/format';
import type { AdminOverview, DailyPoint, ModelReport } from '../../types';

/** Rút gọn số tiền lớn cho trục dọc: 1.200.000đ -> 1,2tr */
/**
 * Nhãn tiền rút gọn cho trục biểu đồ. Nhận vào CENT, in ra đô-la.
 *
 * Trục dọc chỉ rộng chừng 40px nên "$12,345.00" đè lên nhau; rút về "$12.3k"
 * vẫn đọc được đúng độ lớn, còn con số chính xác nằm ở tooltip và các ô thống kê.
 */
const compactUsd = (cents: number): string => {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
};

export const OverviewTab: React.FC = () => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [models, setModels] = useState<ModelReport[]>([]);
  const [topUsers, setTopUsers] = useState<any[]>([]);
  const [days, setDays] = useState(30);

  useEffect(() => {
    void Promise.all([
      api.get<AdminOverview>('/admin/overview'),
      api.get<{ models: ModelReport[] }>('/admin/reports/models'),
      api.get<{ users: any[] }>('/admin/reports/top-users'),
    ]).then(([overviewData, modelData, userData]) => {
      setOverview(overviewData);
      setModels(modelData.models);
      setTopUsers(userData.users);
    });
  }, []);

  useEffect(() => {
    void api.get<{ series: DailyPoint[] }>(`/admin/reports/daily?days=${days}`).then((data) => setDaily(data.series));
  }, [days]);

  if (!overview) return <PageLoader label="Đang tải..." />;

  const labels = daily.map((point) => point.day.slice(5).replace('-', '/'));
  const unconfiguredProviders = overview.system.providers.filter((provider) => !provider.configured);

  return (
    <div className="space-y-6">
      {unconfiguredProviders.length > 0 && (
        <Alert tone="warning">
          Nhà cung cấp chưa cấu hình API key: <strong>{unconfiguredProviders.map((p) => p.name).join(', ')}</strong>.
          Khách sẽ không tạo được ảnh cho tới khi điền key vào file <code>.env</code>.
        </Alert>
      )}

      {/* ---- Chỉ số chính ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Doanh thu hôm nay"
          value={formatUsd(overview.revenue.today)}
          sub={`7 ngày: ${formatUsd(overview.revenue.last7Days)}`}
        />
        <StatCard
          label="Doanh thu 30 ngày"
          value={formatUsd(overview.revenue.last30Days)}
          sub={`Tổng: ${formatUsd(overview.revenue.total)}`}
        />
        <StatCard
          label="Lợi nhuận gộp"
          value={formatUsd(overview.cost.grossProfitUsdCents)}
          sub={`Biên ${overview.cost.grossMarginPercent}% · vốn ${formatUsd(overview.cost.apiCostUsdCents)}`}
          tone={overview.cost.grossProfitUsdCents >= 0 ? 'positive' : 'negative'}
        />
        <StatCard
          label="Đơn chờ thanh toán"
          value={formatNumberVi(overview.revenue.pendingOrders)}
          sub={`${formatNumberVi(overview.revenue.paidOrders)} đơn đã thanh toán`}
          tone={overview.revenue.pendingOrders > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ---- Thuê bao ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/*
          Ba ô dưới đây là DI SẢN của mô hình gói tháng đã ngừng bán. Giữ lại vì
          doanh thu cũ vẫn phải đối soát được, và vì còn khách đang dùng dở gói.
          Xoá được khi ô "Gói tháng còn hạn" về 0 và không cần tra doanh thu cũ nữa.
        */}
        <StatCard
          label="Gói tháng còn hạn"
          value={formatNumberVi(overview.subscribers.active)}
          sub={`đã ngừng bán · ${overview.subscribers.expiringIn7Days} hết hạn trong 7 ngày`}
          tone={overview.subscribers.expiringIn7Days > 0 ? 'warning' : 'positive'}
        />
        <StatCard
          label="Doanh thu bán điểm"
          value={formatUsd(overview.revenue.extraTokenRevenue)}
          sub={`${Math.round(
            (overview.revenue.extraTokenRevenue / Math.max(overview.revenue.total, 1)) * 100,
          )}% tổng doanh thu`}
        />
        <StatCard
          label="Doanh thu gói tháng"
          value={formatUsd(overview.revenue.subscriptionRevenue)}
          sub="di sản, không còn phát sinh mới"
        />
        <StatCard
          label="Hạn mức chưa dùng"
          value={formatNumberVi(overview.subscribers.monthlyTokensRemaining)}
          sub="điểm của gói cũ, mất khi sang chu kỳ mới"
        />
      </div>

      {/* ---- Dòng chảy điểm ----
          Bốn ô đọc theo thứ tự là toàn bộ vòng đời của điểm: bán ra → khách tiêu
          → phần hoàn lại vì ảnh lỗi → phần còn nằm trong ví. Số "đã dùng" lấy từ
          sổ cái token_transactions, đã trừ phần hoàn nên là con số tiêu THẬT. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Điểm đã bán"
          value={formatNumberVi(overview.tokens.sold)}
          sub={`qua ${formatNumberVi(overview.revenue.paidOrders)} đơn đã thanh toán`}
        />
        <StatCard
          label="Điểm khách đã dùng"
          value={formatNumberVi(overview.tokens.used)}
          sub={
            `${formatNumberVi(overview.tokens.usedToday)} hôm nay · ` +
            `${formatNumberVi(overview.tokens.usedLast30Days)} trong 30 ngày`
          }
          tone="positive"
        />
        <StatCard
          label="Đã hoàn vì ảnh lỗi"
          value={formatNumberVi(overview.tokens.refunded)}
          sub={
            overview.tokens.used + overview.tokens.refunded > 0
              ? `${
                  Math.round(
                    (overview.tokens.refunded / (overview.tokens.used + overview.tokens.refunded)) * 1000,
                  ) / 10
                }% số điểm đã trừ`
              : 'chưa có ảnh lỗi nào'
          }
          tone={overview.tokens.refunded > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Điểm chưa dùng"
          value={formatNumberVi(overview.users.outstandingTokens)}
          sub={`Khách đã trả ~${formatUsd(overview.users.outstandingLiabilityUsdCents)} cho số này`}
          tone="warning"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Khách hàng"
          value={formatNumberVi(overview.users.total)}
          sub={`+${overview.users.newToday} hôm nay · +${overview.users.new30Days} trong 30 ngày`}
        />
        <StatCard
          label="Ảnh đã tạo"
          value={formatNumberVi(overview.generations.total)}
          sub={`${overview.generations.today} hôm nay · tỉ lệ thành công ${overview.generations.successRate}%`}
        />
        <StatCard
          label="Điểm trung bình mỗi ảnh"
          value={
            overview.generations.success > 0
              ? formatNumberVi(Math.round(overview.tokens.used / overview.generations.success))
              : '—'
          }
          sub={`trên ${formatNumberVi(overview.generations.success)} ảnh thành công`}
        />
        <StatCard
          label="Hàng đợi"
          value={`${overview.system.queue.running} / ${overview.system.queue.running + overview.system.queue.pending}`}
          sub={
            `Đang vẽ cho ${overview.system.queue.users} khách · ` +
            `trung bình ${overview.generations.avgDurationSec}s mỗi ảnh`
          }
        />
      </div>

      {/* ---- Biểu đồ ---- */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="font-bold text-gray-100">Doanh thu và chi phí vốn theo ngày</h2>
          <div className="flex gap-1">
            {[7, 30, 90].map((option) => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                  days === option ? 'bg-dark-700 text-gray-100' : 'bg-dark-850 text-gray-500 hover:text-gray-300'
                }`}
              >
                {option} ngày
              </button>
            ))}
          </div>
        </div>

        <BarChart
          labels={labels}
          format={compactUsd}
          series={[
            {
              key: 'revenue',
              label: 'Doanh thu',
              color: CHART_COLORS.primary,
              values: daily.map((point) => point.revenueUsdCents),
            },
            {
              key: 'cost',
              label: 'Chi phí API',
              color: CHART_COLORS.secondary,
              values: daily.map((point) => point.apiCostUsdCents),
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <h2 className="font-bold text-gray-100 mb-4">Số ảnh tạo mỗi ngày</h2>
          <BarChart
            labels={labels}
            format={(value) => formatNumberVi(Math.round(value))}
            height={160}
            series={[
              {
                key: 'images',
                label: 'Ảnh',
                color: CHART_COLORS.primary,
                values: daily.map((point) => point.images),
              },
            ]}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-bold text-gray-100 mb-4">Điểm khách dùng mỗi ngày</h2>
          {/*
            Trục dọc rút gọn giống biểu đồ doanh thu: số điểm hằng ngày lên tới
            hàng chục nghìn, in đủ chữ số thì nhãn trục đè lên nhau.
          */}
          <BarChart
            labels={labels}
            format={(value) => compactUsd(value)}
            height={160}
            series={[
              {
                key: 'tokens',
                label: 'Điểm',
                color: CHART_COLORS.primary,
                values: daily.map((point) => point.tokensSpent),
              },
            ]}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-bold text-gray-100 mb-4">Khách đăng ký mới mỗi ngày</h2>
          <BarChart
            labels={labels}
            format={(value) => formatNumberVi(Math.round(value))}
            height={160}
            series={[
              {
                key: 'users',
                label: 'Khách mới',
                color: CHART_COLORS.secondary,
                values: daily.map((point) => point.newUsers),
              },
            ]}
          />
        </Card>
      </div>

      {/* ---- Bảng phụ ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-bold text-gray-100 mb-3">Hiệu quả theo model</h2>
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Model</th>
                <th className="text-right font-bold py-2">Lượt</th>
                <th className="text-right font-bold py-2">Doanh thu quy đổi</th>
                <th className="text-right font-bold py-2">Chi phí</th>
                <th className="text-right font-bold py-2">Biên</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-600 text-xs">
                    Chưa có dữ liệu.
                  </td>
                </tr>
              ) : (
                models.map((model) => (
                  <tr key={model.modelCode} className="border-b border-dark-850 last:border-0">
                    <td className="py-2.5 text-gray-300">{model.modelLabel}</td>
                    <td className="py-2.5 text-right text-gray-400">
                      {formatNumberVi(model.success)}/{formatNumberVi(model.total)}
                    </td>
                    <td className="py-2.5 text-right text-gray-300">{formatUsd(model.tokenValueUsdCents)}</td>
                    <td className="py-2.5 text-right text-gray-500">{formatUsd(model.apiCostUsdCents)}</td>
                    <td
                      className={`py-2.5 text-right font-semibold ${
                        model.marginPercent >= 50 ? 'text-green-400' : 'text-amber-400'
                      }`}
                    >
                      {model.marginPercent}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </Card>

        <Card className="p-5">
          <h2 className="font-bold text-gray-100 mb-3">Khách hàng chi nhiều nhất</h2>
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Khách hàng</th>
                <th className="text-right font-bold py-2">Đã nạp</th>
                <th className="text-right font-bold py-2">Điểm đã dùng</th>
                <th className="text-right font-bold py-2">Còn lại</th>
                <th className="text-right font-bold py-2">Ảnh</th>
              </tr>
            </thead>
            <tbody>
              {topUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-gray-600 text-xs">
                    Chưa có dữ liệu.
                  </td>
                </tr>
              ) : (
                topUsers.map((user) => (
                  <tr key={user.id} className="border-b border-dark-850 last:border-0">
                    <td className="py-2.5 text-gray-300 truncate max-w-[200px]">{user.fullName || user.email}</td>
                    <td className="py-2.5 text-right text-gray-300">{formatUsd(user.totalTopupUsdCents)}</td>
                    <td className="py-2.5 text-right text-gray-300">{formatNumberVi(user.tokensSpent)}</td>
                    <td className="py-2.5 text-right text-brand-500">{formatNumberVi(user.tokenBalance)}</td>
                    <td className="py-2.5 text-right text-gray-500">{formatNumberVi(user.images)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-bold text-gray-100 mb-3">Cấu hình hệ thống</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Email quản trị (.env)</p>
            <p className="text-gray-300 mt-1 break-all">{overview.system.adminEmails.join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Quy ước điểm</p>
            <p className="text-gray-300 mt-1">{formatNumberVi(overview.cost.creditsPerUsd)} điểm = $1 giá vốn</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Lưu ảnh về server</p>
            <p className="text-gray-300 mt-1">{overview.system.downloadResults ? 'Bật' : 'Tắt'}</p>
          </div>
        </div>
      </Card>
    </div>
  );
};
