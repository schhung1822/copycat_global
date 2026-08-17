import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { Alert, Card, EmptyState, PageLoader, StatCard, TableWrap } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, qs } from '../lib/api';
import { BUCKET_LABEL, formatDateTime, formatNumber, TX_TYPE_LABEL } from '../lib/format';
import { CREDITS } from '../lib/routes';
import type { TokenTransaction, WalletSummary } from '../types';

const PAGE_SIZE = 30;

export const WalletPage: React.FC = () => {
  const { setTokenBalance } = useAuth();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void api.get<WalletSummary>('/wallet').then((data) => {
      setSummary(data);
      // Đẩy luôn sang huy hiệu trên thanh điều hướng, tránh cảnh ví báo còn điểm
      // mà huy hiệu vẫn hiện 0.
      setTokenBalance(data.tokenBalance);
    });
  }, [setTokenBalance]);

  useEffect(() => {
    void api
      .get<{ transactions: TokenTransaction[]; total: number }>(`/wallet/transactions${qs({ page, limit: PAGE_SIZE })}`)
      .then((data) => {
        setTransactions(data.transactions);
        setTotal(data.total);
      });
  }, [page]);

  if (!summary) return <PageLoader />;

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Credits</h1>
          <p className="text-sm text-gray-500 mt-1">Every credit that has entered or left your account.</p>
        </div>
        <Link to={CREDITS}>
          <Button className="!rounded-xl !py-2.5">Buy credits</Button>
        </Link>
      </div>

      {/*
        Thẻ gói tháng chỉ hiện với khách còn gói cũ chưa hết hạn. Gói tháng đã
        ngừng bán nên không còn nút "Gia hạn" — hết hạn thì khách chuyển hẳn sang
        mua điểm như mọi người.
      */}
      {summary.isSubscribed && (
        <Card className="p-5">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Monthly plan (no longer sold)</p>
          <p className="text-gray-100 font-semibold mt-1">{summary.subscriptionName ?? 'Active'}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Valid until {formatDateTime(summary.subscriptionExpiresAt)}. After that the monthly allowance stops; credits
            you bought keep working as usual.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Available" value={formatNumber(summary.tokenBalance)} sub="ready to use" />
        <StatCard
          label={summary.isSubscribed ? 'Of that: monthly allowance' : 'Purchased credits'}
          value={formatNumber(summary.isSubscribed ? summary.monthlyTokens : summary.purchasedTokens)}
          sub={
            summary.isSubscribed
              ? `of ${formatNumber(summary.monthlyAllowance)} · resets ${formatDateTime(summary.monthlyPeriodEnd)}`
              : 'never expire'
          }
        />
        <StatCard label="Spent" value={formatNumber(summary.totalTokensOut)} sub="credits" />
        <StatCard
          label="Images created"
          value={formatNumber(summary.successImages)}
          sub={`out of ${formatNumber(summary.totalImages)} attempts`}
        />
      </div>

      <Alert tone="info">
        {summary.isSubscribed ? (
          <>
            Generating an image <strong>spends your monthly allowance first</strong>, then falls back to purchased
            credits. Unused allowance <strong>does not roll over</strong> to the next cycle; purchased credits never
            expire.
          </>
        ) : (
          <>
            Purchased credits <strong>never expire</strong> — you only pay for what you use. Failed images are refunded
            automatically, and each refund shows up in the ledger below.
          </>
        )}
      </Alert>

      <Card className="p-4">
        <h2 className="font-bold text-gray-100 mb-3">Ledger</h2>
        {transactions.length === 0 ? (
          <EmptyState title="Nothing here yet." />
        ) : (
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Date</th>
                <th className="text-left font-bold py-2">Type</th>
                <th className="text-left font-bold py-2">Source</th>
                <th className="text-left font-bold py-2">Details</th>
                <th className="text-right font-bold py-2">Credits</th>
                <th className="text-right font-bold py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="border-b border-dark-850 last:border-0">
                  <td className="py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
                  <td className="py-2.5 text-gray-300">{TX_TYPE_LABEL[tx.type]}</td>
                  <td className="py-2.5">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
                        tx.bucket === 'monthly'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                          : 'bg-dark-800 text-gray-400 border-dark-700'
                      }`}
                    >
                      {BUCKET_LABEL[tx.bucket]}
                    </span>
                  </td>
                  <td className="py-2.5 text-gray-400 text-xs">{tx.description}</td>
                  <td className={`py-2.5 text-right font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-gray-300'}`}>
                    {tx.amount > 0 ? '+' : ''}
                    {formatNumber(tx.amount)}
                  </td>
                  <td className="py-2.5 text-right text-gray-500">{formatNumber(tx.balanceAfter)}</td>
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
