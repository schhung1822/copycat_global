import React, { useEffect, useRef, useState } from 'react';
import { Alert, Card, EmptyState, PageLoader, StatCard, TableWrap } from '../components/ui';
import { api, qs } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { formatDateTime, formatNumber, formatUsd } from '../lib/format';
import type { AffiliateCommission, AffiliateReferral, AffiliateSummary } from '../types';

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending payout',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/60',
  paid: 'bg-green-900/30 text-green-400 border-green-900/60',
  cancelled: 'bg-dark-800 text-gray-500 border-dark-700',
};

/** Ô hiện link giới thiệu kèm nút sao chép. */
const ReferralLinkBox: React.FC<{ link: string }> = ({ link }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    // Truyền thẳng ô đang hiển thị link: khi phải dùng đường lui, khách nhìn
    // thấy đoạn chữ được bôi đen sẵn ngay trước mắt.
    const ok = await copyText(link, inputRef.current);
    setState(ok ? 'copied' : 'failed');
    // Chỉ tự tắt thông báo thành công. Câu hướng dẫn khi chép hỏng phải ở lại
    // cho tới lần bấm sau, không thì khách chưa kịp đọc nó đã biến mất.
    if (ok) setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={inputRef}
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 bg-dark-950 border border-dark-700 rounded-xl px-3 py-2.5 text-sm text-brand-500 font-mono outline-none focus:border-brand-500"
        />
        <button
          onClick={copy}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold rounded-xl px-5 py-2.5 transition-colors whitespace-nowrap"
        >
          {state === 'copied' ? '✓ Copied' : 'Copy link'}
        </button>
      </div>

      {state === 'failed' && (
        <p className="text-[11px] text-amber-400">
          Your browser blocked automatic copying. The link is already selected — press <strong>Ctrl+C</strong> (or{' '}
          <strong>⌘+C</strong>) to copy it.
        </p>
      )}
    </div>
  );
};

/**
 * Trang theo dõi của cộng tác viên tiếp thị liên kết.
 *
 * Chỉ tài khoản được admin cấp vai trò affiliate mới vào được (server chặn bằng
 * `requireAffiliate`, giao diện chặn thêm ở `App.tsx`). Email của khách hiển thị
 * ở dạng đã che — cộng tác viên nhận ra khách của mình là đủ, không cần cầm cả
 * danh sách email của công ty.
 */
export const AffiliatePage: React.FC = () => {
  const [summary, setSummary] = useState<AffiliateSummary | null>(null);
  const [commissions, setCommissions] = useState<AffiliateCommission[]>([]);
  const [referrals, setReferrals] = useState<AffiliateReferral[]>([]);
  const [tab, setTab] = useState<'commissions' | 'referrals'>('commissions');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void api.get<AffiliateSummary>('/affiliate/summary').then(setSummary);
  }, []);

  // Đổi tab thì quay về trang 1 — giữ nguyên số trang cũ dễ rơi vào một trang
  // trống khi danh sách bên kia ngắn hơn.
  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    const path = tab === 'commissions' ? '/affiliate/commissions' : '/affiliate/referrals';
    void api
      .get<{ commissions?: AffiliateCommission[]; referrals?: AffiliateReferral[]; total: number }>(
        `${path}${qs({ page, limit: PAGE_SIZE })}`,
      )
      .then((data) => {
        setCommissions(data.commissions ?? []);
        setReferrals(data.referrals ?? []);
        setTotal(data.total);
      });
  }, [tab, page]);

  if (!summary) return <PageLoader />;

  const { stats } = summary;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Affiliate program</h1>
        <p className="text-sm text-gray-500 mt-1">
          Share your link. Every customer who signs up through it earns you commission on every order they place.
        </p>
      </div>

      {!summary.enabled && (
        <Alert tone="warning">
          The affiliate program is currently <strong>paused</strong>. Commission already recorded is kept and will still
          be paid out, but new orders during this period do not earn commission.
        </Alert>
      )}

      {!summary.isAffiliate && (
        <Alert tone="info">
          You are viewing this page as an administrator. Your own account has not been given the affiliate role, so it
          has no referral link yet.
        </Alert>
      )}

      {summary.referralLink && (
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold text-gray-100">Your referral link</h2>
            <span className="text-[11px] text-gray-500">
              Code: <strong className="text-gray-300 font-mono">{summary.code}</strong>
            </span>
          </div>
          <ReferralLinkBox link={summary.referralLink} />
          <p className="text-[11px] text-gray-600">
            Anyone who clicks your link is remembered for <strong className="text-gray-500">60 days</strong> — they do
            not have to sign up right away. Commission applies only to{' '}
            <strong className="text-gray-500">new accounts</strong> created through the link, not to existing customers.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Pending payout"
          value={formatUsd(stats.pendingUsdCents)}
          sub="paid out on the next cycle"
          tone={stats.pendingUsdCents > 0 ? 'positive' : 'default'}
        />
        <StatCard label="Paid out" value={formatUsd(stats.paidUsdCents)} sub="total received so far" />
        <StatCard
          label="Referred customers"
          value={formatNumber(stats.referrals)}
          sub={`${formatNumber(stats.payingReferrals)} have placed an order`}
        />
        <StatCard
          label="Revenue generated"
          value={formatUsd(stats.revenueUsdCents)}
          sub={`${formatNumber(stats.orders)} paid orders`}
        />
      </div>

      <Alert tone="info">
        You earn <strong>{summary.commissionPercent}% of the profit</strong> on each order, where profit is what the
        customer paid minus the provider cost of the credits sold and fixed costs. The full breakdown for every order is
        in the table below.
      </Alert>

      <Card className="p-4">
        <div className="flex gap-1 border-b border-dark-800 mb-3">
          {(
            [
              ['commissions', 'Commission by order'],
              ['referrals', 'Referred customers'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-brand-500 text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'commissions' ? (
          commissions.length === 0 ? (
            <EmptyState
              title="No commission yet."
              hint="Commission shows up here as soon as a referred customer pays their first order."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                  <th className="text-left font-bold py-2">Date</th>
                  <th className="text-left font-bold py-2">Customer</th>
                  <th className="text-left font-bold py-2">Order</th>
                  <th className="text-right font-bold py-2">Revenue</th>
                  <th className="text-right font-bold py-2">Profit</th>
                  <th className="text-right font-bold py-2">Commission</th>
                  <th className="text-left font-bold py-2 pl-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((row) => (
                  <tr key={row.id} className="border-b border-dark-850 last:border-0">
                    <td className="py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                    <td className="py-2.5 text-xs text-gray-400">{row.customer}</td>
                    <td className="py-2.5 text-xs text-gray-500 font-mono">{row.orderCode}</td>
                    <td className="py-2.5 text-right text-gray-300">{formatUsd(row.revenueUsdCents)}</td>
                    <td
                      className="py-2.5 text-right text-gray-400"
                      title={
                        `Revenue ${formatUsd(row.revenueUsdCents)} − credit cost ${formatUsd(row.tokenCostUsdCents)}` +
                        (row.fixedCostUsdCents > 0 ? ` − fixed costs ${formatUsd(row.fixedCostUsdCents)}` : '')
                      }
                    >
                      {formatUsd(row.profitUsdCents)}
                    </td>
                    <td className="py-2.5 text-right font-semibold text-brand-500">
                      {formatUsd(row.commissionUsdCents)}
                      <span className="text-[10px] text-gray-600 font-normal"> · {row.commissionPercent}%</span>
                    </td>
                    <td className="py-2.5 pl-4">
                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
                          STATUS_CLASS[row.status]
                        }`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                      {row.paidAt && (
                        <p className="text-[10px] text-gray-600 mt-1 whitespace-nowrap">{formatDateTime(row.paidAt)}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )
        ) : referrals.length === 0 ? (
          <EmptyState title="Nobody has signed up through your link yet." hint="Share the link above to get started." />
        ) : (
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Customer</th>
                <th className="text-left font-bold py-2">Joined</th>
                <th className="text-right font-bold py-2">Spent</th>
                <th className="text-right font-bold py-2">Your commission</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((row) => (
                <tr key={row.id} className="border-b border-dark-850 last:border-0">
                  <td className="py-2.5 text-xs text-gray-400">{row.customer}</td>
                  <td className="py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(row.joinedAt)}</td>
                  <td className="py-2.5 text-right text-gray-300">{formatUsd(row.revenueUsdCents)}</td>
                  <td className="py-2.5 text-right font-semibold text-brand-500">{formatUsd(row.commissionUsdCents)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg bg-dark-850 text-gray-300 text-sm disabled:opacity-30"
            >
              ← Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg bg-dark-850 text-gray-300 text-sm disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </Card>
    </div>
  );
};
