import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { Alert, Badge, Card, EmptyState, PageLoader, TableWrap } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatNumber, formatUsd, formatUsdPrecise, STATUS_LABEL } from '../lib/format';
import { modelShortName, pickBasisPackage, pickReferenceModel, roundedImageCount } from '../lib/imageEstimate';
import { APP_HOME, POLICY } from '../lib/routes';
import type { Catalog, ModelOption, Order, TokenPackage } from '../types';

/**
 * Nhịp hỏi lại server sau khi khách quay về từ Stripe.
 *
 * Webhook thường về trước cả khi trình duyệt chuyển hướng xong, nhưng không có
 * gì bảo đảm điều đó — endpoint `/orders/:code` cũng tự hỏi thẳng Stripe mỗi lần
 * được gọi, nên vòng lặp này vẫn kết thúc kể cả khi webhook chưa được cấu hình.
 */
const ORDER_POLL_MS = 2500;

/** Bỏ cuộc sau chừng này lượt hỏi — tránh quay vòng vô hạn nếu có gì đó hỏng. */
const MAX_POLLS = 40;

const isAwaitingPayment = (order: Order) => order.status === 'pending' || order.status === 'expired';

export const TopUpPage: React.FC = () => {
  const { refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Mã đơn và kết quả Stripe đính vào thanh địa chỉ khi khách quay lại. */
  const returnedOrder = searchParams.get('order');
  const checkoutResult = searchParams.get('checkout');

  const load = useCallback(async () => {
    const [catalogData, orderData] = await Promise.all([
      api.get<Catalog>('/catalog'),
      api.get<{ orders: Order[] }>('/orders?limit=20'),
    ]);
    setCatalog(catalogData);
    setOrders(orderData.orders);
    return orderData.orders;
  }, []);

  useEffect(() => {
    void load()
      .then((list) => {
        // Khách vừa từ Stripe quay về: mở thẳng đơn đó thay vì bảng giá.
        if (returnedOrder) setActiveOrder(list.find((order) => order.code === returnedOrder) ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this page.'));
  }, [load, returnedOrder]);

  /*
   * Hỏi lại cho tới khi đơn thoát khỏi trạng thái chờ.
   *
   * Chỉ chạy cho đơn khách vừa thanh toán xong (`checkout=success`): với đơn còn
   * dang dở mà khách chưa trả tiền thì không có gì để đợi, hỏi lặp lại chỉ làm
   * phiền server.
   */
  useEffect(() => {
    if (!activeOrder || !isAwaitingPayment(activeOrder)) return;
    if (checkoutResult !== 'success') return;

    let polls = 0;
    const timer = setInterval(() => {
      void (async () => {
        if ((polls += 1) > MAX_POLLS) {
          clearInterval(timer);
          return;
        }
        try {
          const data = await api.get<{ order: Order }>(`/orders/${activeOrder.code}`);
          setActiveOrder(data.order);
          if (!isAwaitingPayment(data.order)) {
            setOrders((current) => current.map((item) => (item.id === data.order.id ? data.order : item)));
            await refreshUser();
          }
        } catch {
          /* thử lại ở lượt sau */
        }
      })();
    }, ORDER_POLL_MS);

    return () => clearInterval(timer);
  }, [activeOrder, checkoutResult, refreshUser]);

  /** Dọn `?order=…&checkout=…` để tải lại trang không rơi lại vào màn kết quả. */
  const clearReturnParams = () => setSearchParams({}, { replace: true });

  /** Tạo đơn rồi chuyển thẳng sang trang thanh toán của Stripe. */
  const buy = async (pkg: TokenPackage) => {
    setError(null);
    setBusyId(`pkg-${pkg.id}`);
    try {
      const data = await api.post<{ order: Order; checkoutUrl: string }>('/orders', { packageId: pkg.id });
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the checkout.');
      setBusyId(null);
    }
  };

  /** Mở lại phiên thanh toán của một đơn còn dang dở. */
  const resume = async (order: Order) => {
    setError(null);
    setBusyId(`order-${order.id}`);
    try {
      const data = await api.post<{ checkoutUrl: string | null }>(`/orders/${order.code}/checkout`);
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      // Không có link nghĩa là đơn đã được thanh toán ở nơi khác — nạp lại cho khớp.
      await load();
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reopen the checkout.');
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (order: Order) => {
    try {
      await api.post(`/orders/${order.id}/cancel`);
      setActiveOrder(null);
      clearReturnParams();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this order.');
    }
  };

  const backToPacks = () => {
    setActiveOrder(null);
    clearReturnParams();
  };

  if (!catalog) return <PageLoader />;

  // Quy số điểm ra số ảnh — con số này dễ hình dung hơn nhiều so với "500,000
  // credits". Model mốc và cách làm tròn nằm ở lib/imageEstimate để trang này và
  // bảng giá ở trang giới thiệu luôn ra cùng một con số cho cùng một gói.
  const referenceModel = pickReferenceModel(catalog.models);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-100">Buy credits</h1>
        <Link to={POLICY} className="text-sm text-gray-500 hover:text-brand-500 transition-colors whitespace-nowrap">
          Terms &amp; policies →
        </Link>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {activeOrder && activeOrder.status === 'paid' ? (
        <PaidPanel order={activeOrder} onContinue={backToPacks} />
      ) : activeOrder && isAwaitingPayment(activeOrder) ? (
        <PendingPanel
          order={activeOrder}
          cancelled={checkoutResult === 'cancelled'}
          busy={busyId === `order-${activeOrder.id}`}
          onRetry={() => resume(activeOrder)}
          onCancel={() => cancel(activeOrder)}
          onBack={backToPacks}
        />
      ) : (
        <>
          <BalanceStatus referenceModel={referenceModel} />

          <section>
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <h2 className="text-lg font-bold text-gray-100">Choose a credit pack</h2>
              <span className="text-xs text-gray-500">No subscription · credits never expire</span>
            </div>

            <PackageGrid packages={catalog.packages} busyId={busyId} referenceModel={referenceModel} onSelect={buy} />
          </section>
        </>
      )}

      <PricingReference catalog={catalog} />
      <OrderHistory orders={orders} busyId={busyId} onResume={resume} />
    </div>
  );
};

// ---------------------------------------------------------------------------

/**
 * Số điểm đang có, quy ra số ảnh tạo được.
 *
 * Khối hạn mức tháng chỉ hiện với khách còn gói cũ chưa hết hạn. Khách mới không
 * bao giờ thấy nó — họ chưa từng nghe tới khái niệm đó, bày ra một dòng "0 / 0"
 * chỉ khiến họ tưởng mình đang thiếu thứ gì.
 */
const BalanceStatus: React.FC<{ referenceModel: ModelOption | null }> = ({ referenceModel }) => {
  const { user } = useAuth();
  if (!user) return null;

  const images =
    referenceModel && referenceModel.tokenCost > 0 ? roundedImageCount(user.tokenBalance, referenceModel.tokenCost) : 0;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Your balance</p>
          <p className="text-brand-500 font-bold text-2xl mt-1">{formatNumber(user.tokenBalance)}</p>
          {images > 0 && (
            <p className="text-[11px] text-gray-500 mt-1">
              About {formatNumber(images)} more {referenceModel?.resolution} images with{' '}
              {modelShortName(referenceModel)}
            </p>
          )}
        </div>

        {user.tokenBalance === 0 && (
          <p className="text-sm text-gray-400 max-w-xs">
            Pick a pack below to top up. Credits land in your account as soon as the payment clears — nothing else to set
            up.
          </p>
        )}
      </div>

      {/* Chỉ khách còn gói tháng cũ mới thấy phần này */}
      {user.isSubscribed && user.monthlyAllowance > 0 && (
        <div className="mt-4 pt-4 border-t border-dark-800">
          <p className="text-[11px] text-gray-500">
            That includes <strong className="text-gray-400">{formatNumber(user.monthlyTokens)}</strong> credits from your
            legacy monthly plan (valid until {formatDateTime(user.subscriptionExpiresAt)}). That part resets on{' '}
            {formatDateTime(user.monthlyPeriodEnd)} and <strong className="text-gray-400">does not roll over</strong>.
            Credits you buy never expire.
          </p>
        </div>
      )}
    </Card>
  );
};

const PackageGrid: React.FC<{
  packages: TokenPackage[];
  busyId: string | null;
  onSelect: (pkg: TokenPackage) => void;
  /** Model dùng làm mốc quy số điểm ra số ảnh */
  referenceModel: ModelOption | null;
}> = ({ packages, busyId, onSelect, referenceModel }) => {
  return (
    <>
      {/*
        Flex-wrap chứ không phải grid: có 5 gói mà mỗi hàng 4 cột nên gói cuối
        luôn đứng lẻ. Grid ghim nó vào cột đầu bên trái trông như lỗi bố cục;
        flex + justify-center đưa nó về giữa hàng dưới.

        Bề rộng trừ đi phần khoảng cách: gap-4 = 1rem, 4 cột có 3 khoảng nên mỗi
        thẻ nhường 0,75rem; 2 cột có 1 khoảng nên nhường 0,5rem.
      */}
      <div className="flex flex-wrap justify-center gap-4">
        {packages.map((pkg) => {
          const images =
            referenceModel && referenceModel.tokenCost > 0
              ? roundedImageCount(pkg.totalTokens, referenceModel.tokenCost)
              : 0;

          return (
            <Card
              key={pkg.id}
              className={`p-4 flex flex-col relative w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)] ${pkg.isPopular ? 'border-brand-500 shadow-lg shadow-brand-500/10' : ''}`}
            >
              {pkg.isPopular && (
                <span className="absolute -top-2.5 left-5 bg-brand-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Most popular
                </span>
              )}

              <p className="text-xl font-bold text-gray-300">{formatUsd(pkg.priceUsdCents)}</p>

              {/*
                SỐ ĐIỂM là con số lớn nhất trên thẻ, không phải giá tiền: khách đã
                biết mình định tiêu bao nhiêu, thứ họ cần so giữa các thẻ là đổi
                được bao nhiêu điểm.

                Số to LUÔN là tổng nhận được, phần thưởng ghi rõ là "includes".
                Trước đây để "550,000 credits +50,000" cạnh nhau, đọc ra thành
                550.000 cộng thêm 50.000 nữa — hứa gấp đôi phần thưởng thật.

                Khoá chiều cao tối thiểu vì thẻ có thưởng cao hơn thẻ không có đúng
                một dòng; không khoá thì nét kẻ ngang bên dưới mỗi thẻ một độ cao.
              */}
              <div className="mt-2 min-h-[3.5rem]">
                <p className="text-[1.75rem] font-bold leading-none tracking-tight text-brand-500">
                  {formatNumber(pkg.totalTokens)}
                  <span className="ml-1 text-xs font-semibold text-gray-500">credits</span>
                </p>
                {pkg.bonusTokens > 0 && (
                  <p className="text-[11px] text-green-400 mt-1 leading-tight">
                    Includes {formatNumber(pkg.bonusTokens)} bonus credits
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-dark-800 flex-1">
                {images > 0 && <p className="text-xs font-bold text-gray-200">≈ {formatNumber(images)} images</p>}
                {pkg.description && <p className="text-[11px] text-gray-500 mt-1.5">{pkg.description}</p>}
              </div>

              <Button
                onClick={() => onSelect(pkg)}
                isLoading={busyId === `pkg-${pkg.id}`}
                variant={pkg.isPopular ? 'primary' : 'secondary'}
                className="w-full mt-3 !rounded-xl !py-2.5 !text-sm"
              >
                Buy now
              </Button>
            </Card>
          );
        })}
      </div>

      {referenceModel && (
        <p className="text-[11px] text-gray-600 mt-3">
          {/* Số điểm lấy từ bảng giá, không gõ tay — gõ tay là sớm muộn cũng
              lệch với con số thật khi bảng giá đổi. */}
          Image counts assume <strong className="text-gray-500">{modelShortName(referenceModel)}</strong> at{' '}
          {referenceModel.resolution} ({formatNumber(referenceModel.tokenCost)} credits per image). 1K images go further,
          4K fewer — see the table below. Purchased credits never expire.
        </p>
      )}
    </>
  );
};

const PaidPanel: React.FC<{ order: Order; onContinue: () => void }> = ({ order, onContinue }) => (
  <Card className="p-6 border-green-900/50 bg-green-500/5">
    <h2 className="text-xl font-bold text-green-400">Payment complete</h2>
    {order.orderType === 'subscription' ? (
      <p className="text-sm text-gray-300 mt-2">
        Order <strong>{order.code}</strong> activated <strong className="text-gray-100">{order.packageName}</strong>. You
        can start generating right away.
      </p>
    ) : (
      <p className="text-sm text-gray-300 mt-2">
        Order <strong>{order.code}</strong> added{' '}
        <strong className="text-gray-100">{formatNumber(order.totalTokens)} credits</strong> to your account.
      </p>
    )}
    <div className="flex gap-3 mt-5">
      <Link to={APP_HOME}>
        <Button className="!rounded-xl">Start generating</Button>
      </Link>
      <Button variant="ghost" onClick={onContinue}>
        Buy more credits
      </Button>
    </div>
  </Card>
);

/**
 * Đơn chưa thanh toán xong.
 *
 * Gộp ba tình huống vào một khối vì với khách chúng là cùng một câu chuyện "đơn
 * này chưa xong": vừa bấm huỷ ở Stripe, vừa trả xong mà tiền chưa kịp về, hoặc
 * mở lại một đơn cũ còn treo.
 */
const PendingPanel: React.FC<{
  order: Order;
  cancelled: boolean;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onBack: () => void;
}> = ({ order, cancelled, busy, onRetry, onCancel, onBack }) => (
  <Card className="p-6">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-gray-100">
          {cancelled ? 'Checkout cancelled' : 'Confirming your payment'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {order.packageName} · {formatUsd(order.amountUsdCents)} · {formatNumber(order.totalTokens)} credits · order{' '}
          <span className="font-mono">{order.code}</span>
        </p>
      </div>
      <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-100 whitespace-nowrap">
        ← Back to packs
      </button>
    </div>

    {cancelled ? (
      <p className="text-sm text-gray-400 mt-4">
        You were not charged. This order is still open — pick up where you left off, or cancel it and choose a different
        pack.
      </p>
    ) : (
      <div className="flex items-center gap-2 mt-5 text-sm text-brand-500">
        <span className="inline-block w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
        Waiting for the payment to clear. This usually takes a few seconds.
      </div>
    )}

    <div className="flex flex-wrap gap-3 mt-5">
      <Button onClick={onRetry} isLoading={busy} className="!rounded-xl">
        {cancelled ? 'Complete payment' : 'Reopen payment page'}
      </Button>
      {order.status === 'pending' && (
        <Button variant="ghost" onClick={onCancel}>
          Cancel order
        </Button>
      )}
    </div>

    {!cancelled && (
      <p className="text-[11px] text-gray-600 mt-4">
        Paid but nothing happened yet? Come back to this page in a minute — payments are confirmed automatically, even if
        you close the browser.
      </p>
    )}
  </Card>
);

/** Bảng điểm tiêu hao mỗi ảnh, để khách ước lượng một gói dùng được bao nhiêu ảnh. */
const PricingReference: React.FC<{ catalog: Catalog }> = ({ catalog }) => {
  // Cột "số ảnh" tính theo gói mốc, và bảng nói rõ tên gói đó. Cách chọn gói mốc
  // nằm ở lib/imageEstimate để bảng model ở trang giới thiệu dùng đúng gói này.
  const basePackage = pickBasisPackage(catalog.packages);
  const baseTokens = basePackage?.totalTokens ?? 0;

  /**
   * Đơn giá mỗi điểm (cent) để quy ảnh ra tiền — lấy đúng ĐƠN GIÁ CỦA GÓI MỐC.
   *
   * Trước đây chỗ này lấy đơn giá rẻ nhất trong tất cả các gói, trong khi cột
   * "số ảnh" bên cạnh lại tính theo gói mốc. Hai cột hai mốc khác nhau nên bảng
   * tự mâu thuẫn: khách nhân "500 ảnh × $0,10" ra $50 mà gói ghi ở đầu cột lại
   * là giá khác.
   *
   * Cùng một gói cho cả hai cột thì phép nhân ngược lại luôn ra xấp xỉ giá gói,
   * chênh chút ít do số ảnh đã làm tròn.
   */
  const centsPerToken =
    basePackage && basePackage.totalTokens > 0 ? basePackage.priceUsdCents / basePackage.totalTokens : 0;

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-100 mb-3">Credit costs</h2>
      <Card className="p-4">
        <TableWrap>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
              <th className="text-left font-bold py-2">Model</th>
              <th className="text-left font-bold py-2">Quality</th>
              <th className="text-right font-bold py-2">Credits / image</th>
              {centsPerToken > 0 && <th className="text-right font-bold py-2">Cost / image</th>}
              {baseTokens > 0 && (
                <th className="text-right font-bold py-2">Images with {basePackage?.name ?? 'the sample pack'}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {catalog.models.map((model) => (
              <tr key={model.code} className="border-b border-dark-850 last:border-0">
                <td className="py-2.5 text-gray-300">{model.label.split('—')[0].trim()}</td>
                <td className="py-2.5 text-gray-400">{model.resolution}</td>
                <td className="py-2.5 text-right text-brand-500 font-semibold">{formatNumber(model.tokenCost)}</td>
                {centsPerToken > 0 && (
                  <td className="py-2.5 text-right text-gray-300">
                    {model.tokenCost > 0 ? formatUsdPrecise(model.tokenCost * centsPerToken) : '—'}
                  </td>
                )}
                {baseTokens > 0 && (
                  <td className="py-2.5 text-right text-gray-500 text-xs">
                    {/* Dùng chung roundedImageCount với thẻ gói phía trên: cùng
                        một trang mà thẻ ghi "≈ 500 images" còn bảng ghi "~512"
                        thì khách không biết tin con số nào. */}
                    {model.tokenCost > 0
                      ? `~${formatNumber(roundedImageCount(baseTokens, model.tokenCost))} images`
                      : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="text-[11px] text-gray-600 mt-3">
          {basePackage && baseTokens > 0 && (
            <>
              The last two columns assume the <strong className="text-gray-500">{basePackage.name}</strong> pack (
              {formatNumber(baseTokens)} credits at {formatUsdPrecise(centsPerToken)} each) and a single image type. Other
              packs shift the per-credit price, and the image counts move with it.
            </>
          )}
        </p>
      </Card>
    </div>
  );
};

const OrderHistory: React.FC<{
  orders: Order[];
  busyId: string | null;
  onResume: (order: Order) => void;
}> = ({ orders, busyId, onResume }) => (
  <div>
    <h2 className="text-lg font-bold text-gray-100 mb-3">Order history</h2>
    <Card className="p-4">
      {orders.length === 0 ? (
        <EmptyState title="No orders yet." />
      ) : (
        <TableWrap>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
              <th className="text-left font-bold py-2">Order</th>
              <th className="text-left font-bold py-2">Item</th>
              <th className="text-right font-bold py-2">Amount</th>
              <th className="text-left font-bold py-2 pl-4">Status</th>
              <th className="text-left font-bold py-2">Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-dark-850 last:border-0">
                <td className="py-2.5 font-mono text-xs text-gray-300">{order.code}</td>
                <td className="py-2.5 text-gray-300 text-xs">
                  {order.packageName}
                  {order.orderType === 'token_package' && (
                    <span className="text-brand-500 ml-2">+{formatNumber(order.totalTokens)}</span>
                  )}
                </td>
                <td className="py-2.5 text-right text-gray-300">{formatUsd(order.amountUsdCents)}</td>
                <td className="py-2.5 pl-4">
                  <Badge status={order.status}>{STATUS_LABEL[order.status]}</Badge>
                </td>
                <td className="py-2.5 text-xs text-gray-500">{formatDateTime(order.createdAt)}</td>
                <td className="py-2.5 text-right">
                  {order.status === 'pending' && (
                    <button
                      onClick={() => onResume(order)}
                      disabled={busyId === `order-${order.id}`}
                      className="text-xs text-brand-500 hover:underline whitespace-nowrap disabled:opacity-50"
                    >
                      Pay now →
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
