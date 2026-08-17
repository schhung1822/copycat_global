import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { Alert, Field, inputClass, PageLoader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { APP_HOME, FORGOT_PASSWORD, LOGIN } from '../lib/routes';
import { AuthShell } from './AuthPages';

/**
 * Bước 1 — xin liên kết đặt lại mật khẩu.
 *
 * Nhận email HOẶC số điện thoại. Sau khi gửi, màn hình LUÔN hiện cùng một câu
 * xác nhận dù tài khoản có tồn tại hay không: server cố ý không cho biết, vì nếu
 * biết thì trang này thành công cụ dò xem email nào đã đăng ký ở đây. Câu thông
 * báo vì thế phải viết theo kiểu "nếu tài khoản tồn tại thì..." chứ không phải
 * "đã gửi mail rồi".
 */
export const ForgotPasswordPage: React.FC = () => {
  const { user } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={APP_HOME} replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await api.post('/auth/forgot-password', { identifier });
      setIsSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter the email or phone number you signed up with."
      footer={
        <>
          Remembered it?{' '}
          <Link to={LOGIN} className="font-semibold text-brand-500 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      {isSent ? (
        <div className="space-y-4">
          <Alert tone="success">
            If that matches an account, we have emailed a reset link to the address on file. The link is valid for 15
            minutes.
          </Alert>

          <p className="text-sm leading-relaxed text-gray-500">
            Nothing in your inbox? Check the Spam and Promotions folders. You can also{' '}
            <button
              type="button"
              onClick={() => setIsSent(false)}
              className="font-semibold text-brand-500 hover:underline"
            >
              try different details
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="Email or phone number" hint="Use the same details you signed up with.">
            <input
              type="text"
              className={inputClass}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="you@example.com or +1 555 000 0000"
              autoComplete="username"
              required
            />
          </Field>

          <Button type="submit" isLoading={isSubmitting} className="w-full !rounded-xl">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
};

/**
 * Bước 2 — đặt mật khẩu mới bằng liên kết trong mail.
 *
 * Kiểm tra token ngay khi mở trang thay vì đợi bấm nút: liên kết hết hạn sau 15
 * phút nên chuyện mở ra một liên kết đã chết là bình thường, bắt người dùng gõ
 * xong hai ô mật khẩu rồi mới báo hỏng là làm mất công họ.
 */
export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [isChecking, setIsChecking] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setIsChecking(false);
      return;
    }

    let cancelled = false;
    void api
      .get<{ valid: boolean }>(`/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((data) => {
        if (!cancelled) setIsValid(data.valid);
      })
      .catch(() => {
        /* lỗi mạng — coi như chưa xác định được, nút gửi vẫn sẽ báo lỗi thật */
        if (!cancelled) setIsValid(true);
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');

    setIsSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setIsDone(true);
      // Chờ một nhịp cho người dùng đọc kịp thông báo rồi mới chuyển trang.
      setTimeout(() => navigate(LOGIN, { replace: true }), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <>
      Need a new link?{' '}
      <Link to={FORGOT_PASSWORD} className="font-semibold text-brand-500 hover:underline">
        Send another
      </Link>
    </>
  );

  if (isChecking) {
    return (
      <AuthShell title="Reset your password" subtitle="Checking your link…" footer={footer}>
        <PageLoader label="Checking your link…" />
      </AuthShell>
    );
  }

  if (!token || !isValid) {
    return (
      <AuthShell title="This link no longer works" subtitle="It has expired or has already been used." footer={footer}>
        <Alert tone="error">
          Password reset links work once and expire after 15 minutes. Request a fresh one to continue.
        </Alert>

        <Link
          to={FORGOT_PASSWORD}
          className="mt-4 block rounded-xl bg-brand-500 px-4 py-2.5 text-center text-sm font-bold text-white transition-colors hover:bg-brand-600"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="Choose a new password for your account." footer={footer}>
      {isDone ? (
        <Alert tone="success">Password changed. Taking you to the sign-in page…</Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="New password" hint="At least 6 characters.">
            <PasswordInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Field label="Confirm new password">
            <PasswordInput
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Button type="submit" isLoading={isSubmitting} className="w-full !rounded-xl">
            Change password
          </Button>
        </form>
      )}
    </AuthShell>
  );
};
