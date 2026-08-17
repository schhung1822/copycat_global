import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { captureReferralFromUrl } from './lib/referral';
import {
  ACCOUNT,
  ADMIN,
  AFFILIATE,
  APP_HOME,
  CREDITS,
  FORGOT_PASSWORD,
  HISTORY,
  LEGACY_REDIRECTS,
  LOGIN,
  POLICY,
  RESET_PASSWORD,
  SIGNUP,
  WALLET,
} from './lib/routes';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { AffiliatePage } from './pages/AffiliatePage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { HistoryPage } from './pages/HistoryPage';
import { LandingPage } from './pages/LandingPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordResetPages';
import { PolicyPage } from './pages/PolicyPage';
import { StudioPage } from './pages/StudioPage';
import { TopUpPage } from './pages/TopUpPage';
import { WalletPage } from './pages/WalletPage';

/** Chặn các trang cần đăng nhập; nhớ đường dẫn cũ để quay lại sau khi đăng nhập. */
const RequireAuth: React.FC<{ children: React.ReactNode; adminOnly?: boolean; affiliateOnly?: boolean }> = ({
  children,
  adminOnly,
  affiliateOnly,
}) => {
  const { user, isLoading, isAdmin, isAffiliate } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageLoader label="Checking your session..." />;

  /*
   * Không còn ngoại lệ cho "/" như trước: trang chủ nay chính là trang giới
   * thiệu và ai cũng vào được, nên khách chưa đăng nhập không bao giờ chạm tới
   * đoạn này từ trang chủ nữa.
   */
  if (!user) return <Navigate to={LOGIN} state={{ from: location.pathname }} replace />;

  // Đã đăng nhập nhưng không phải quản trị viên: trả về bàn làm việc, không phải
  // trang bán hàng — họ là khách đang dùng dịch vụ chứ không phải người đi xem.
  if (adminOnly && !isAdmin) return <Navigate to={APP_HOME} replace />;

  // Vai trò affiliate do admin cấp trong bảng điều khiển; ai chưa được cấp thì
  // trang này không tồn tại với họ.
  if (affiliateOnly && !isAffiliate) return <Navigate to={APP_HOME} replace />;

  return <>{children}</>;
};

/**
 * Chuyển hướng giữ nguyên query string.
 *
 * `<Navigate to="/reset-password">` vứt mất phần `?token=…`, mà đó chính là thứ
 * duy nhất làm cho link trong mail đặt lại mật khẩu có ý nghĩa — mọi mail đã gửi
 * trước lần đổi đường dẫn này sẽ dẫn tới một trang báo "link không hợp lệ".
 */
const RedirectKeepingQuery: React.FC<{ to: string }> = ({ to }) => {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
};

const AppRoutes: React.FC = () => (
  <Routes>
    {/*
      Trang chủ là trang giới thiệu, mở công khai cho mọi người.

      Ai gõ tên miền trần cũng đáp xuống trang bán hàng — kể cả khách đã đăng
      nhập, vì đó cũng là link họ gửi cho người khác. Muốn vào làm việc thì bấm
      nút "Vào tạo ảnh" trên thanh điều hướng.
    */}
    <Route path="/" element={<LandingPage />} />

    <Route path={LOGIN} element={<LoginPage />} />
    <Route path={SIGNUP} element={<RegisterPage />} />
    {/* Công khai: người quên mật khẩu thì đương nhiên chưa đăng nhập được */}
    <Route path={FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
    <Route path={RESET_PASSWORD} element={<ResetPasswordPage />} />
    {/* Công khai: khách phải đọc được điều khoản trước khi tạo tài khoản */}
    <Route path={POLICY} element={<PolicyPage />} />

    <Route
      element={
        <RequireAuth>
          <Layout />
        </RequireAuth>
      }
    >
      <Route path={APP_HOME} element={<StudioPage />} />
      <Route path={HISTORY} element={<HistoryPage />} />
      <Route path={WALLET} element={<WalletPage />} />
      <Route path={CREDITS} element={<TopUpPage />} />
      <Route path={ACCOUNT} element={<AccountPage />} />
      <Route
        path={AFFILIATE}
        element={
          <RequireAuth affiliateOnly>
            <AffiliatePage />
          </RequireAuth>
        }
      />
      <Route
        path={ADMIN}
        element={
          <RequireAuth adminOnly>
            <AdminPage />
          </RequireAuth>
        }
      />
    </Route>

    {/* Đường dẫn tiếng Việt đời trước — giữ cho link đã phát ra ngoài còn sống */}
    {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
      <Route key={from} path={from} element={<RedirectKeepingQuery to={to} />} />
    ))}

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

const App: React.FC = () => {
  /*
   * Bắt mã giới thiệu `?ref=` NGAY khi ứng dụng mở, trước cả khi biết khách sẽ
   * đi tới trang nào. Link của cộng tác viên có thể trỏ vào bất kỳ trang nào
   * (trang chủ, bảng giá, trang đăng ký), nên đặt ở đúng một chỗ duy nhất này là
   * bao được hết mà không phải nhớ gắn vào từng trang.
   *
   * Chạy trong hàm khởi tạo của `useState` chứ KHÔNG phải `useEffect`: effect
   * chạy từ dưới lên, tức là sau khi các trang con đã render xong. Khách vào
   * thẳng `/dang-ky?ref=MÃ` thì trang Đăng ký đọc kho lưu trước khi mã kịp được
   * cất vào, và dòng "bạn đang đăng ký qua link giới thiệu" không hiện ra ở lần
   * render đầu. Hàm này gọi lại vô hại nên StrictMode chạy hai lần cũng không sao.
   */
  React.useState(captureReferralFromUrl);

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
