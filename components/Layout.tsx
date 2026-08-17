import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatNumber } from '../lib/format';
import { ACCOUNT, ADMIN, AFFILIATE, APP_HOME, CREDITS, HISTORY, LOGIN, WALLET } from '../lib/routes';
import { ThemeToggle } from './ThemeToggle';

const navItems = [
  { to: APP_HOME, label: 'Studio' },
  { to: HISTORY, label: 'History' },
  { to: WALLET, label: 'Credits' },
  { to: CREDITS, label: 'Buy credits' },
];

// Bấm logo trong ứng dụng về bàn làm việc, không về trang bán hàng: khách đã
// đăng nhập rồi thì "nhà" của họ là chỗ tạo ảnh.
const Logo: React.FC = () => (
  <Link to={APP_HOME} className="flex items-center gap-2.5 shrink-0">
    <img
      src="/img/logo_copycat.webp"
      alt=""
      className="w-8 h-8 rounded-full object-cover shadow-lg shadow-brand-500/20"
    />
    <span className="font-bold text-gray-100 tracking-tight hidden sm:block">Design Copycat AI</span>
  </Link>
);

export const Layout: React.FC = () => {
  const { user, isAdmin, isAffiliate, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(LOGIN);
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm transition-colors ${
      isActive ? 'bg-dark-800 text-gray-100 font-semibold' : 'text-gray-400 hover:text-gray-100 hover:bg-dark-850'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-dark-950">
      <header className="h-14 border-b border-dark-800 bg-dark-900/95 backdrop-blur sticky top-0 z-40 flex items-center px-4 gap-2">
        <Logo />

        <nav className="flex items-center gap-1 ml-4 overflow-x-auto custom-scrollbar">
          {/* Không cần `end`: từ khi bàn làm việc rời khỏi "/", không đường dẫn
              nào trong thanh này còn là tiền tố của đường dẫn khác. */}
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
          {/* Chỉ hiện với người đã được cấp vai trò cộng tác viên — xem AffiliatePage. */}
          {isAffiliate && (
            <NavLink to={AFFILIATE} className={linkClass}>
              Affiliate
            </NavLink>
          )}
          {/* Nhãn tiếng Việt là có chủ đích: khu vực quản trị chỉ dành cho nội bộ. */}
          {isAdmin && (
            <NavLink to={ADMIN} className={linkClass}>
              <span className="text-brand-500">●</span> Quản trị
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/*
            Còn điểm thì hiện số dư; hết sạch thì đổi thành nút mua nổi bật —
            một con số "0" mờ nhạt không nói cho khách biết phải làm gì tiếp.
          */}
          {user && user.tokenBalance > 0 ? (
            <Link
              to={CREDITS}
              className="flex items-center gap-2 bg-dark-850 hover:bg-dark-800 border border-dark-700 rounded-full pl-3 pr-2 py-1.5 transition-colors group"
              title={
                // Chỉ tách nguồn khi khách còn hạn mức của gói tháng cũ. Khách
                // mua điểm thuần không biết "hạn mức tháng" là gì.
                user.monthlyTokens > 0
                  ? `Monthly allowance: ${formatNumber(user.monthlyTokens)} credits\n` +
                    `Purchased: ${formatNumber(user.purchasedTokens)} credits`
                  : `${formatNumber(user.tokenBalance)} credits — click to buy more`
              }
            >
              <span className="text-sm font-bold text-brand-500">{formatNumber(user.tokenBalance)}</span>
              <span className="text-[10px] uppercase text-gray-500 tracking-wider hidden sm:inline">credits</span>
              <span className="w-5 h-5 rounded-full bg-brand-500/15 text-brand-500 flex items-center justify-center text-sm leading-none group-hover:bg-brand-500 group-hover:text-white transition-colors">
                +
              </span>
            </Link>
          ) : (
            <Link
              to={CREDITS}
              className="bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold rounded-full px-4 py-2 transition-colors"
            >
              Buy credits
            </Link>
          )}

          <ThemeToggle />

          <div className="relative group">
            <button className="w-8 h-8 rounded-full bg-dark-800 border border-dark-700 text-gray-300 text-xs font-bold hover:border-gray-500 transition-colors">
              {(user?.fullName ?? user?.email ?? '?').charAt(0).toUpperCase()}
            </button>
            <div className="absolute right-0 top-full pt-2 hidden group-hover:block z-50">
              <div className="bg-dark-850 border border-dark-700 rounded-xl shadow-2xl w-56 py-2">
                <div className="px-4 py-2 border-b border-dark-800">
                  <p className="text-sm text-gray-100 truncate">{user?.fullName || 'No name set'}</p>
                  <p className="text-[11px] text-gray-500 truncate">{user?.email}</p>
                </div>
                <Link to={ACCOUNT} className="block px-4 py-2 text-sm text-gray-300 hover:bg-dark-800">
                  Account settings
                </Link>
                <Link to={WALLET} className="block px-4 py-2 text-sm text-gray-300 hover:bg-dark-800">
                  Credit history
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-dark-800"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
};
