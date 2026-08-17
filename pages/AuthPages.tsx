import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { ThemeToggle } from '../components/ThemeToggle';
import { Alert, Field, inputClass } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { getStoredReferral } from '../lib/referral';
import { APP_HOME, CREDITS, FORGOT_PASSWORD, LOGIN, SIGNUP } from '../lib/routes';

/** Khung chung của các màn hình ngoài ứng dụng; dùng lại ở trang quên mật khẩu. */
export const AuthShell: React.FC<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}> = ({
  title,
  subtitle,
  children,
  footer,
}) => (
  <div className="min-h-screen flex items-center justify-center bg-dark-950 p-4 relative">
    {/* Cho phép đổi chế độ sáng/tối ngay từ màn hình đăng nhập */}
    <div className="absolute top-5 right-5">
      <ThemeToggle />
    </div>

    <div className="w-full max-w-md">
      <div className="flex items-center gap-3 justify-center mb-8">
        <img
          src="/img/logo_copycat.webp"
          alt=""
          className="w-10 h-10 rounded-full object-cover shadow-lg shadow-brand-500/25"
        />
        <h1 className="text-xl font-bold text-gray-100 tracking-tight">Design Copycat AI</h1>
      </div>

      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-2xl">
        <h2 className="text-2xl font-bold text-gray-100">{title}</h2>
        <p className="text-sm text-gray-500 mt-1 mb-6">{subtitle}</p>
        {children}
      </div>

      <p className="text-center text-sm text-gray-500 mt-6">{footer}</p>
    </div>
  </div>
);

export const LoginPage: React.FC = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) return <Navigate to={(location.state as { from?: string })?.from ?? APP_HOME} replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate((location.state as { from?: string })?.from ?? APP_HOME, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Sign in to keep creating."
      footer={
        <>
          No account yet?{' '}
          <Link to={SIGNUP} className="text-brand-500 hover:underline font-semibold">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Email">
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@gmail.com"
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Password">
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Field>

        <div className="flex justify-end">
          <Link to={FORGOT_PASSWORD} className="text-xs text-gray-500 hover:text-brand-500">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" isLoading={isSubmitting} className="w-full !rounded-xl">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
};

export const RegisterPage: React.FC = () => {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /*
   * Mã giới thiệu đã cất từ lúc khách bấm link của cộng tác viên. Chỉ để BÁO CHO
   * KHÁCH BIẾT là link có tác dụng — mã thật sự được `register` trong AuthContext
   * đọc lại và gửi lên, nên đọc một lần lúc dựng form là đủ.
   */
  const [referral] = useState(() => getStoredReferral());

  if (user) return <Navigate to={APP_HOME} replace />;

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (form.password.length < 6) return setError('Password must be at least 6 characters.');
    if (form.password !== form.confirm) return setError('The two passwords do not match.');

    setIsSubmitting(true);
    try {
      await register({
        email: form.email,
        password: form.password,
        fullName: form.fullName || undefined,
        phone: form.phone || undefined,
      });
      navigate(CREDITS, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-up failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to join — buy credits whenever you need them."
      footer={
        <>
          Already have an account?{' '}
          <Link to={LOGIN} className="text-brand-500 hover:underline font-semibold">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {referral && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-2.5 text-xs text-brand-500">
            You are signing up through referral link <strong className="font-mono">{referral}</strong>.
          </div>
        )}

        <Field label="Full name">
          <input type="text" className={inputClass} value={form.fullName} onChange={update('fullName')} placeholder="Jane Doe" />
        </Field>

        <Field label="Email">
          <input
            type="email"
            className={inputClass}
            value={form.email}
            onChange={update('email')}
            placeholder="example@gmail.com"
            autoComplete="email"
            required
          />
        </Field>

        <Field label="Phone number">
          <input type="tel" className={inputClass} value={form.phone} onChange={update('phone')} placeholder="+1 555 000 0000" />
        </Field>

        <Field label="Password" hint="At least 6 characters.">
          <PasswordInput value={form.password} onChange={update('password')} autoComplete="new-password" required />
        </Field>

        <Field label="Confirm password">
          <PasswordInput value={form.confirm} onChange={update('confirm')} autoComplete="new-password" required />
        </Field>

        <Button type="submit" isLoading={isSubmitting} className="w-full !rounded-xl">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
};
