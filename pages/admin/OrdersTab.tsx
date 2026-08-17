import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Alert, Badge, Card, EmptyState, TableWrap, inputClass } from '../../components/ui';
import { api, ApiError, qs } from '../../lib/api';
import { formatDateTimeVi, formatNumberVi, formatUsd, STATUS_LABEL_VI } from '../../lib/format';
import type { AdminOrder } from '../../types';

const FILTERS = [
  { value: 'pending', label: 'Chờ thanh toán' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: '', label: 'Tất cả' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'cancelled', label: 'Đã huỷ' },
];

export const OrdersTab: React.FC = () => {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<{ orders: AdminOrder[] }>(`/admin/orders${qs({ status, search, limit: 50 })}`);
    setOrders(data.orders);
  }, [status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (order: AdminOrder) => {
    if (!confirm(`Xác nhận đã nhận ${formatUsd(order.amountUsdCents)} cho đơn ${order.code} và cộng ${formatNumberVi(order.totalTokens)} điểm?`)) {
      return;
    }
    setMessage(null);
    setBusyCode(order.code);
    try {
      await api.post(`/admin/orders/${order.code}/approve`, { note: 'Duyệt tay từ bảng điều khiển' });
      setMessage({ tone: 'success', text: `Đã cộng ${formatNumberVi(order.totalTokens)} điểm cho ${order.user.email}.` });
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Duyệt đơn thất bại.' });
    } finally {
      setBusyCode(null);
    }
  };

  const cancel = async (order: AdminOrder) => {
    if (!confirm(`Huỷ đơn ${order.code}?`)) return;
    setBusyCode(order.code);
    try {
      await api.post(`/admin/orders/${order.code}/cancel`);
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Huỷ đơn thất bại.' });
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatus(filter.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                status === filter.value ? 'bg-brand-500 text-white' : 'bg-dark-850 text-gray-400 hover:bg-dark-800'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <input
          className={`${inputClass} max-w-xs ml-auto !py-2`}
          placeholder="Tìm theo mã đơn hoặc email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="p-4">
        {orders.length === 0 ? (
          <EmptyState title="Không có đơn nào." />
        ) : (
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Mã đơn</th>
                <th className="text-left font-bold py-2">Khách hàng</th>
                <th className="text-left font-bold py-2">Gói</th>
                <th className="text-right font-bold py-2">Số tiền</th>
                <th className="text-right font-bold py-2">Điểm</th>
                <th className="text-left font-bold py-2 pl-4">Trạng thái</th>
                <th className="text-left font-bold py-2">Tạo lúc</th>
                <th className="text-right font-bold py-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-dark-850 last:border-0">
                  <td className="py-2.5 font-mono text-xs text-gray-300">{order.code}</td>
                  <td className="py-2.5">
                    <p className="text-gray-300 text-xs truncate max-w-[180px]">{order.user.email}</p>
                    {order.user.fullName && <p className="text-[10px] text-gray-600">{order.user.fullName}</p>}
                  </td>
                  <td className="py-2.5 text-gray-400 text-xs">{order.packageName}</td>
                  <td className="py-2.5 text-right text-gray-300">{formatUsd(order.amountUsdCents)}</td>
                  <td className="py-2.5 text-right text-brand-500">{formatNumberVi(order.totalTokens)}</td>
                  <td className="py-2.5 pl-4">
                    <Badge status={order.status}>{STATUS_LABEL_VI[order.status]}</Badge>
                    {order.paidSource && <p className="text-[10px] text-gray-600 mt-1">qua {order.paidSource}</p>}
                  </td>
                  <td className="py-2.5 text-[11px] text-gray-500 whitespace-nowrap">{formatDateTimeVi(order.createdAt)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {order.status === 'pending' || order.status === 'expired' ? (
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          onClick={() => approve(order)}
                          isLoading={busyCode === order.code}
                          className="!px-3 !py-1.5 !text-xs !rounded-lg"
                        >
                          Duyệt
                        </Button>
                        {order.status === 'pending' && (
                          <button
                            onClick={() => cancel(order)}
                            className="px-2 py-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors"
                          >
                            Huỷ
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] text-gray-600">{formatDateTimeVi(order.paidAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="text-[11px] text-gray-600">
        Duyệt tay dùng khi khách trả tiền ngoài Stripe (thu tiền mặt, hợp đồng riêng) hoặc khi cần cứu một giao dịch
        thất lạc. Đơn đã thanh toán không thể duyệt lại nên không có rủi ro
        cộng điểm hai lần.
      </p>
    </div>
  );
};
