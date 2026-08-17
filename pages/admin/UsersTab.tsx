import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { PasswordInput } from '../../components/PasswordInput';
import { Alert, Badge, Card, EmptyState, Field, TableWrap, inputClass, selectClass } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError, qs } from '../../lib/api';
import { formatDateTimeVi, formatNumberVi, formatUsd, STATUS_LABEL_VI } from '../../lib/format';
import type { AdminPlan, AdminUser } from '../../types';

/**
 * ISO của server → chuỗi cho <input type="datetime-local">.
 *
 * Input này chỉ nhận đúng dạng `YYYY-MM-DDTHH:mm` **theo giờ máy của admin**, nên
 * phải tự bù chênh lệch múi giờ; dùng thẳng `toISOString()` sẽ hiện sai giờ đúng
 * bằng offset của máy.
 */
function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Chuỗi của datetime-local (giờ máy admin) → ISO để gửi lên server, '' → null. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const UsersTab: React.FC = () => {
  const { user: me, refreshUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<AdminUser | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [planTarget, setPlanTarget] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<{ users: AdminUser[] }>(`/admin/users${qs({ search, limit: 50 })}`);
    setUsers(data.users);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Cấp / thu hồi vai trò cộng tác viên tiếp thị liên kết.
   *
   * Khác quyền admin (gắn cứng với ADMIN_EMAILS trong .env), vai trò này là một
   * cờ trong cơ sở dữ liệu nên bật tắt được ngay tại đây. Thu hồi chỉ dừng phát
   * sinh hoa hồng mới — khoản đã ghi vẫn phải trả, và mã link được giữ lại để
   * cấp lại thì link cũ sống nguyên.
   */
  const toggleAffiliate = async (user: AdminUser) => {
    const enabled = !user.isAffiliate;
    if (
      !confirm(
        enabled
          ? `Cấp vai trò cộng tác viên tiếp thị liên kết cho ${user.email}?\n\nHọ sẽ thấy tab "Affiliate" kèm link giới thiệu riêng.`
          : `Thu hồi vai trò cộng tác viên của ${user.email}?\n\nĐơn mới sẽ không sinh hoa hồng nữa. Các khoản đã ghi nhận vẫn giữ nguyên và vẫn phải chi trả.`,
      )
    ) {
      return;
    }

    try {
      const data = await api.post<{ affiliateCode: string | null }>(`/admin/users/${user.id}/affiliate`, { enabled });
      await afterChange(
        enabled
          ? `${user.email} đã trở thành cộng tác viên, mã giới thiệu: ${data.affiliateCode}.`
          : `Đã thu hồi vai trò cộng tác viên của ${user.email}.`,
      );
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Thao tác thất bại.' });
    }
  };

  const toggleBan = async (user: AdminUser) => {
    const nextStatus = user.status === 'active' ? 'banned' : 'active';
    if (!confirm(`${nextStatus === 'banned' ? 'Khoá' : 'Mở khoá'} tài khoản ${user.email}?`)) return;

    try {
      await api.patch(`/admin/users/${user.id}`, { status: nextStatus });
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Thao tác thất bại.' });
    }
  };

  /** Dùng chung cho các hộp thoại: đóng, báo thành công, tải lại dữ liệu. */
  const afterChange = async (text: string) => {
    setEditTarget(null);
    setAdjustTarget(null);
    setPlanTarget(null);
    setMessage({ tone: 'success', text });
    // Admin hay thao tác lên chính tài khoản mình để kiểm thử; đọc lại phiên hiện
    // tại để huy hiệu điểm trên thanh điều hướng khớp ngay, không phải tải lại trang.
    await Promise.all([load(), refreshUser()]);
  };

  return (
    <div className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="flex items-center gap-3">
        <input
          className={`${inputClass} max-w-sm !py-2`}
          placeholder="Tìm theo email, tên hoặc số điện thoại..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-gray-600">{users.length} tài khoản</span>
      </div>

      <Card className="p-4">
        {users.length === 0 ? (
          <EmptyState title="Không tìm thấy tài khoản nào." />
        ) : (
          <TableWrap>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-dark-800">
                <th className="text-left font-bold py-2">Khách hàng</th>
                <th className="text-left font-bold py-2">Gói dịch vụ</th>
                <th className="text-right font-bold py-2">Hạn mức tháng</th>
                <th className="text-right font-bold py-2">Mua thêm</th>
                <th className="text-right font-bold py-2">Đã nạp</th>
                <th className="text-left font-bold py-2 pl-4">Trạng thái</th>
                <th className="text-right font-bold py-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const expired = user.subscriptionExpiresAt
                  ? new Date(user.subscriptionExpiresAt).getTime() <= Date.now()
                  : true;

                return (
                  <tr key={user.id} className="border-b border-dark-850 last:border-0 align-top">
                    <td className="py-2.5">
                      <p className="text-gray-300 text-xs">
                        {user.email}
                        {user.role === 'admin' && (
                          <span className="ml-1.5 text-[9px] font-bold text-brand-500 uppercase">Admin</span>
                        )}
                        {user.isAffiliate && (
                          <span
                            className="ml-1.5 text-[9px] font-bold text-blue-400 uppercase"
                            title={`Cộng tác viên · mã ${user.affiliateCode ?? '—'}`}
                          >
                            Affiliate
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-600">
                        {user.fullName || 'Chưa đặt tên'}
                        {user.phone ? ` · ${user.phone}` : ''}
                      </p>
                      {/* Ai đã đưa khách này về — để biết đơn của họ đang chia hoa hồng cho ai. */}
                      {user.referrerEmail && (
                        <p className="text-[10px] text-gray-600">↳ giới thiệu bởi {user.referrerEmail}</p>
                      )}
                    </td>

                    <td className="py-2.5">
                      {user.planName ? (
                        <>
                          <p className={`text-xs ${expired ? 'text-gray-600' : 'text-gray-300'}`}>{user.planName}</p>
                          <p className={`text-[10px] ${expired ? 'text-red-400' : 'text-gray-600'}`}>
                            {expired ? 'Hết hạn ' : 'Đến '}
                            {formatDateTimeVi(user.subscriptionExpiresAt)}
                          </p>
                        </>
                      ) : (
                        <span className="text-[10px] text-gray-600">Chưa mua gói</span>
                      )}
                    </td>

                    <td className="py-2.5 text-right whitespace-nowrap">
                      <span className="text-brand-500 font-semibold">{formatNumberVi(user.monthlyTokens)}</span>
                      <span className="text-gray-600"> / {formatNumberVi(user.monthlyAllowance)}</span>
                      {user.monthlyPeriodEnd && (
                        <p className="text-[10px] text-gray-600">
                          Cấp lại {formatDateTimeVi(user.monthlyPeriodEnd)}
                        </p>
                      )}
                    </td>

                    <td className="py-2.5 text-right text-gray-300">{formatNumberVi(user.purchasedTokens)}</td>
                    <td className="py-2.5 text-right text-gray-300">{formatUsd(user.totalTopupUsdCents)}</td>

                    <td className="py-2.5 pl-4">
                      <Badge status={user.status}>{STATUS_LABEL_VI[user.status]}</Badge>
                      <p className="text-[10px] text-gray-600 mt-1 whitespace-nowrap">
                        {formatDateTimeVi(user.lastLoginAt)}
                      </p>
                    </td>

                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditTarget(user)}
                        className="text-xs text-gray-400 hover:text-gray-100 px-2 transition-colors"
                      >
                        Sửa
                      </button>
                      <button
                        onClick={() => setPlanTarget(user)}
                        className="text-xs text-gray-400 hover:text-gray-100 px-2 transition-colors"
                      >
                        Gói
                      </button>
                      <button
                        onClick={() => setAdjustTarget(user)}
                        className="text-xs text-gray-400 hover:text-gray-100 px-2 transition-colors"
                      >
                        Điểm
                      </button>
                      <button
                        onClick={() => toggleAffiliate(user)}
                        className={`text-xs px-2 transition-colors ${
                          user.isAffiliate ? 'text-blue-400 hover:text-blue-300' : 'text-gray-400 hover:text-gray-100'
                        }`}
                        title={
                          user.isAffiliate
                            ? `Đang là cộng tác viên (mã ${user.affiliateCode ?? '—'}) — bấm để thu hồi`
                            : 'Cấp vai trò cộng tác viên tiếp thị liên kết'
                        }
                      >
                        Affiliate
                      </button>
                      <button
                        onClick={() => toggleBan(user)}
                        // Tự khoá mình là mất quyền vào bảng điều khiển, server cũng
                        // chặn — ẩn nút luôn để khỏi bấm rồi nhận lỗi.
                        disabled={user.id === me?.id && user.status === 'active'}
                        className={`text-xs px-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                          user.status === 'active'
                            ? 'text-gray-500 hover:text-red-400'
                            : 'text-green-500 hover:text-green-400'
                        }`}
                        title={user.id === me?.id && user.status === 'active' ? 'Không thể tự khoá tài khoản của bạn' : ''}
                      >
                        {user.status === 'active' ? 'Khoá' : 'Mở'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="text-[11px] text-gray-600">
        Quyền admin được điều khiển bằng biến <code>ADMIN_EMAILS</code> trong file <code>.env</code>, không sửa được từ
        giao diện. Thêm email vào đó rồi khởi động lại server.
      </p>

      {editTarget && <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} onDone={afterChange} />}
      {planTarget && <GrantPlanModal user={planTarget} onClose={() => setPlanTarget(null)} onDone={afterChange} />}
      {adjustTarget && (
        <AdjustTokenModal user={adjustTarget} onClose={() => setAdjustTarget(null)} onDone={afterChange} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

/** Sửa hồ sơ, trạng thái, thời hạn gói và hạn mức của một khách hàng. */
const EditUserModal: React.FC<{
  user: AdminUser;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}> = ({ user, onClose, onDone }) => {
  const [form, setForm] = useState({
    fullName: user.fullName ?? '',
    phone: user.phone ?? '',
    email: user.email,
    status: user.status,
    subscriptionExpiresAt: toLocalInput(user.subscriptionExpiresAt),
    monthlyAllowance: String(user.monthlyAllowance),
    monthlyPeriodEnd: toLocalInput(user.monthlyPeriodEnd),
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: e.target.value })),
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    const allowance = Number(form.monthlyAllowance);
    if (!Number.isInteger(allowance) || allowance < 0) return setError('Hạn mức tháng phải là số nguyên không âm.');
    if (password && password.length < 8) return setError('Mật khẩu mới phải có ít nhất 8 ký tự.');

    setError(null);
    setIsSaving(true);
    try {
      await api.patch(`/admin/users/${user.id}`, {
        fullName: form.fullName.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim(),
        status: form.status,
        subscriptionExpiresAt: fromLocalInput(form.subscriptionExpiresAt),
        monthlyAllowance: allowance,
        monthlyPeriodEnd: fromLocalInput(form.monthlyPeriodEnd),
      });

      // Đổi mật khẩu là lời gọi riêng, chạy sau khi hồ sơ đã lưu xong: nếu gộp
      // chung mà nửa chừng lỗi thì admin không biết phần nào đã vào.
      if (password) await api.post(`/admin/users/${user.id}/password`, { password });

      await onDone(
        `Đã cập nhật ${form.email.trim()}${password ? ' và đặt lại mật khẩu' : ''}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lưu thất bại.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <h3 className="text-lg font-bold text-gray-100">Sửa thông tin khách hàng</h3>
        <p className="text-sm text-gray-500 mt-1 mb-5">
          #{user.id} · tham gia {formatDateTimeVi(user.createdAt)}
        </p>

        <form onSubmit={submit} className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Họ tên">
              <input className={inputClass} placeholder="Chưa đặt tên" {...field('fullName')} />
            </Field>
            <Field label="Số điện thoại">
              <input className={inputClass} placeholder="09xx xxx xxx" {...field('phone')} />
            </Field>
            <Field
              label="Email"
              hint={
                user.role === 'admin'
                  ? 'Tài khoản admin — quyền gắn với email trong ADMIN_EMAILS nên phải sửa ở .env rồi khởi động lại.'
                  : 'Cũng là tên đăng nhập của khách.'
              }
            >
              <input
                className={inputClass}
                type="email"
                // Server chặn hẳn việc đổi email của tài khoản admin; khoá luôn ở đây
                // để khỏi gõ xong mới nhận lỗi.
                readOnly={user.role === 'admin'}
                {...field('email')}
              />
            </Field>
            <Field label="Trạng thái" hint="Tài khoản bị khoá không đăng nhập được.">
              <select className={selectClass} {...field('status')}>
                <option value="active">Đang hoạt động</option>
                <option value="banned">Đã khoá</option>
              </select>
            </Field>
          </div>

          <div className="border-t border-dark-800 pt-5">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Gói dịch vụ &amp; hạn mức</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Gói hết hạn lúc" hint="Để trống nghĩa là chưa có gói. Đẩy về tương lai để gia hạn tay.">
                <input className={inputClass} type="datetime-local" {...field('subscriptionExpiresAt')} />
              </Field>
              <Field label="Hạn mức mỗi tháng" hint="Số điểm được cấp lại đầu mỗi chu kỳ tháng.">
                <input className={inputClass} inputMode="numeric" {...field('monthlyAllowance')} />
              </Field>
              <Field label="Cấp lại hạn mức lúc" hint="Qua mốc này hạn mức tự đầy lại. Để trống sẽ cấp lại ở lần thao tác điểm kế tiếp.">
                <input className={inputClass} type="datetime-local" {...field('monthlyPeriodEnd')} />
              </Field>
              <div className="text-[11px] text-gray-600 self-end pb-2">
                Hạn mức còn lại hiện tại: <strong className="text-gray-400">{formatNumberVi(user.monthlyTokens)}</strong>{' '}
                điểm. Cộng/trừ số này ở nút <strong className="text-gray-400">Điểm</strong> để có dòng ghi trong sổ cái.
                Hạ hạn mức tháng xuống thấp hơn số còn lại sẽ kéo số còn lại xuống theo.
              </div>
            </div>
          </div>

          <div className="border-t border-dark-800 pt-5">
            <Field
              label="Đặt lại mật khẩu"
              hint="Bỏ trống nếu không đổi. Đặt xong nhớ báo mật khẩu mới cho khách — hệ thống không gửi email."
            >
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ít nhất 8 ký tự"
                autoComplete="new-password"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" isLoading={isSaving} className="!rounded-xl">
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

/**
 * Cấp gói tháng thẳng cho một khách, không qua đơn thanh toán nào.
 *
 * Gói tháng ĐÃ NGỪNG BÁN — hệ thống nay chỉ bán điểm. Đường này giữ lại cho
 * trường hợp tặng hạn mức tháng cho khách VIP hoặc khách trả tiền ngoài luồng.
 * Muốn cộng điểm thường thì dùng nút "Điểm" (nguồn `purchased`) chứ không phải
 * ở đây: hạn mức tháng sẽ bị thu hồi khi hết hạn gói, còn điểm mua thì không.
 *
 * Danh sách gói lấy nguyên bảng `/admin/plans` chứ không lọc theo trạng thái
 * bán — từ khi ngừng bán thì mọi gói đều `is_active = 0`.
 */
const GrantPlanModal: React.FC<{
  user: AdminUser;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}> = ({ user, onClose, onDone }) => {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [months, setMonths] = useState('');
  const [mode, setMode] = useState<'extend' | 'restart'>('extend');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const stillValid = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt).getTime() > Date.now()
    : false;

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ plans: AdminPlan[] }>('/admin/plans');
        setPlans(data.plans);
        /*
         * Chọn sẵn gói CÓ HẠN MỨC chứ không phải dòng đầu bảng: gói miễn phí
         * (0 điểm/tháng) xếp trước các gói còn lại, để nó làm mặc định thì admin
         * bấm lưu là cấp một gói chẳng cho khách thêm điểm nào.
         *
         * Không lọc theo `isActive` được nữa — từ khi ngừng bán, mọi gói đều tắt.
         */
        const preselected = data.plans.find((plan) => plan.monthlyTokenAllowance > 0) ?? data.plans[0];
        if (preselected) {
          setPlanId(preselected.id);
          setMonths(String(preselected.months));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Không tải được danh sách gói dịch vụ.');
      }
    })();
  }, []);

  const selected = plans?.find((plan) => plan.id === planId) ?? null;

  // Đổi gói thì số tháng nhảy theo chu kỳ của gói mới — admin muốn khác thì sửa lại.
  const pickPlan = (id: number) => {
    setPlanId(id);
    const plan = plans?.find((item) => item.id === id);
    if (plan) setMonths(String(plan.months));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return setError('Chọn một gói dịch vụ.');

    const value = Number(months);
    if (!Number.isInteger(value) || value < 1 || value > 120) {
      return setError('Số tháng phải là số nguyên từ 1 đến 120.');
    }

    setError(null);
    setIsSaving(true);
    try {
      const data = await api.post<{ expiresAt: string; isRenewal: boolean }>(
        `/admin/users/${user.id}/subscription`,
        { planId: selected.id, months: value, mode },
      );
      await onDone(
        `Đã cấp ${selected.name} (${value} tháng) cho ${user.email} — hiệu lực đến ${formatDateTimeVi(data.expiresAt)}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cấp gói thất bại.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <h3 className="text-lg font-bold text-gray-100">Cấp gói dịch vụ</h3>
        <p className="text-sm text-gray-500 mt-1 mb-5">{user.email}</p>

        <div className="rounded-xl border border-dark-800 bg-dark-900/50 px-4 py-3 mb-5 text-[11px] text-gray-500">
          Đang dùng:{' '}
          <strong className="text-gray-300">{user.planName || 'chưa có gói'}</strong>
          {user.subscriptionExpiresAt && (
            <>
              {' · '}
              {stillValid ? 'còn hạn đến ' : 'đã hết hạn '}
              <strong className={stillValid ? 'text-gray-300' : 'text-red-400'}>
                {formatDateTimeVi(user.subscriptionExpiresAt)}
              </strong>
            </>
          )}
          {' · hạn mức '}
          <strong className="text-gray-300">{formatNumberVi(user.monthlyAllowance)}</strong> điểm/tháng
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Gói dịch vụ" hint="Gói ghi (ngừng bán) không hiện trên trang bảng giá nhưng vẫn cấp tay được.">
            <select
              className={selectClass}
              value={planId ?? ''}
              onChange={(e) => pickPlan(Number(e.target.value))}
              disabled={!plans}
            >
              {!plans && <option value="">Đang tải...</option>}
              {plans?.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {plan.priceUsdCents > 0 ? formatUsd(plan.priceUsdCents) : 'miễn phí'} ·{' '}
                  {plan.monthlyTokenAllowance > 0
                    ? `${formatNumberVi(plan.monthlyTokenAllowance)} điểm/tháng`
                    : 'không tặng điểm'}
                  {plan.isActive ? '' : ' (ngừng bán)'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Số tháng" hint="Mặc định theo chu kỳ của gói. Sửa lại nếu muốn tặng thử ngắn hơn hoặc bù thêm.">
            <input className={inputClass} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>

          <Field
            label="Cách tính thời hạn"
            hint={
              stillValid
                ? mode === 'extend'
                  ? 'Cộng nối tiếp vào ngày hết hạn hiện tại, hạn mức của chu kỳ đang dùng dở giữ nguyên.'
                  : 'Bỏ ngày hết hạn cũ, tính lại từ bây giờ và cấp hạn mức mới ngay. Hạn mức còn thừa của gói cũ bị thu hồi.'
                : 'Khách đang không có gói nên gói mới luôn tính từ bây giờ, hạn mức được cấp ngay.'
            }
          >
            <select
              className={selectClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as 'extend' | 'restart')}
              disabled={!stillValid}
            >
              <option value="extend">Gia hạn — nối tiếp ngày hết hạn hiện tại</option>
              <option value="restart">Đổi gói — tính lại từ hôm nay</option>
            </select>
          </Field>

          {selected && selected.monthlyTokenAllowance === 0 && (
            <Alert tone="info">
              <strong>{selected.name}</strong> không tặng điểm hàng tháng. Khách được phép đăng nhập và mua điểm lẻ, và
              chỉ tạo được ảnh bằng số điểm đã mua.
            </Alert>
          )}

          <p className="text-[11px] text-gray-600">
            Thao tác này không tạo đơn nạp và không tính vào doanh thu. Khách đã trả tiền thật thì duyệt đơn ở tab{' '}
            <strong className="text-gray-400">Đơn nạp</strong> thay vì cấp tay ở đây.
          </p>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" isLoading={isSaving} disabled={!selected} className="!rounded-xl">
              Cấp gói
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------

const AdjustTokenModal: React.FC<{
  user: AdminUser;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}> = ({ user, onClose, onDone }) => {
  const [bucket, setBucket] = useState<'purchased' | 'monthly'>('purchased');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isMonthly = bucket === 'monthly';
  const currentBalance = isMonthly ? user.monthlyTokens : user.purchasedTokens;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) return setError('Nhập số nguyên khác 0 (số âm để trừ điểm).');
    if (!reason.trim()) return setError('Vui lòng nhập lý do — lý do sẽ hiện trong sao kê của khách.');

    setError(null);
    setIsSaving(true);
    try {
      const data = await api.post<{ balanceAfter: number }>(`/admin/users/${user.id}/tokens`, {
        amount: value,
        reason: reason.trim(),
        bucket,
      });
      await onDone(
        `Đã ${value > 0 ? 'cộng' : 'trừ'} ${formatNumberVi(Math.abs(value))} điểm ` +
          `(${isMonthly ? 'hạn mức tháng' : 'điểm mua thêm'}) cho ${user.email}. ` +
          `Còn lại: ${formatNumberVi(data.balanceAfter)}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thao tác thất bại.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-6">
        <h3 className="text-lg font-bold text-gray-100">Điều chỉnh điểm</h3>
        <p className="text-sm text-gray-500 mt-1 mb-5">{user.email}</p>

        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field
            label="Nguồn điểm"
            hint={
              isMonthly
                ? `Hạn mức tháng bị xoá khi sang chu kỳ mới. Không cộng vượt quá ${formatNumberVi(user.monthlyAllowance)} điểm của gói.`
                : 'Điểm mua thêm không hết hạn. Dùng cho đền bù, khuyến mãi.'
            }
          >
            <select
              className={selectClass}
              value={bucket}
              onChange={(e) => setBucket(e.target.value as 'purchased' | 'monthly')}
            >
              <option value="purchased">Điểm mua thêm — không hết hạn</option>
              <option value="monthly">Hạn mức tháng — reset mỗi chu kỳ</option>
            </select>
          </Field>

          <Field label="Số điểm" hint={`Đang có ${formatNumberVi(currentBalance)}. Số dương để cộng, số âm để trừ.`}>
            <input
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500"
              inputMode="numeric"
              autoFocus
            />
          </Field>

          <Field label="Lý do" hint="Sẽ hiển thị trong sao kê điểm của khách.">
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Đền bù ảnh lỗi / khuyến mãi..."
            />
          </Field>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" isLoading={isSaving} className="!rounded-xl">
              Xác nhận
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
