import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_HOME, LOGIN, SIGNUP } from '../../lib/routes';
import { ThemeToggle } from '../ThemeToggle';
import { LandingLogo } from './LandingLogo';

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#models', label: 'AI models' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * Thanh điều hướng của trang giới thiệu.
 *
 * Trong suốt khi ở đỉnh trang để ảnh minh hoạ đầu trang liền mạch, đổ nền mờ
 * ngay khi cuộn xuống — nếu không chữ trong thanh sẽ chìm vào nội dung bên dưới.
 *
 * Cố tình KHÔNG dùng <Layout> của ứng dụng: khách chưa đăng nhập không có số dư
 * điểm hay menu tài khoản để hiện, và trang này cần thanh trên rộng hơn.
 */
export const LandingNav: React.FC<{ isLoggedIn: boolean }> = ({ isLoggedIn }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Khoá cuộn nền khi menu trên điện thoại đang mở, nếu không trang chạy phía
  // sau lớp phủ và người dùng mất dấu vị trí đang đọc.
  useEffect(() => {
    if (!isMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMenuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        isScrolled ? 'border-b border-dark-800 bg-dark-950/85 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      {/*
        Trên máy hẹp (iPhone SE ~375px) thanh này từng bị tràn: logo + tên đầy đủ
        + nút đổi chế độ + nút kêu gọi + nút menu cộng lại vượt quá bề ngang màn
        hình. Cách chữa là bớt thứ ở bản mobile chứ không thu nhỏ tất cả: nút đổi
        sáng/tối chuyển xuống trong menu, nút kêu gọi rút gọn chữ, tên thương
        hiệu ẩn dưới 380px — chỉ nút kêu gọi và nút menu là luôn có mặt.
      */}
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <LandingLogo />

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-dark-850 hover:text-gray-100"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Nút đổi sáng/tối nhường chỗ trên mobile, đã có bản khác trong menu */}
          <span className="hidden lg:block">
            <ThemeToggle />
          </span>

          {isLoggedIn ? (
            <Link
              to={APP_HOME}
              className="whitespace-nowrap rounded-full bg-brand-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-600 sm:px-4 sm:text-sm"
            >
              Open the studio
            </Link>
          ) : (
            <>
              <Link
                to={LOGIN}
                className="hidden rounded-full px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:text-gray-100 sm:block"
              >
                Sign in
              </Link>
              <Link
                to={SIGNUP}
                className="whitespace-nowrap rounded-full bg-brand-500 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-brand-500/25 transition-all hover:bg-brand-600 hover:shadow-brand-500/40 sm:px-4 sm:text-sm"
              >
                {/* Chữ ngắn trên mobile để thanh trên không bị đẩy tràn */}
                <span className="sm:hidden">Try it</span>
                <span className="hidden sm:inline">Try it free</span>
              </Link>
            </>
          )}

          <button
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-dark-700 text-gray-300 transition-colors hover:bg-dark-850 lg:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {isMenuOpen ? (
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="border-t border-dark-800 bg-dark-950/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-4 py-3 sm:px-6">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-dark-850 hover:text-gray-100"
              >
                {link.label}
              </a>
            ))}
            {!isLoggedIn && (
              <Link
                to={LOGIN}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-gray-300 hover:bg-dark-850 hover:text-gray-100 sm:hidden"
              >
                Sign in
              </Link>
            )}

            {/* Nút đổi sáng/tối bị ẩn ở thanh trên bản mobile nên đặt lại ở đây */}
            <div className="mt-2 flex items-center justify-between border-t border-dark-800 px-3 pt-4">
              <span className="text-sm text-gray-500">Light / dark mode</span>
              <ThemeToggle />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};
