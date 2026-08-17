import React, { useEffect, useState } from 'react';
import { Faq } from '../components/landing/Faq';
import { Features } from '../components/landing/Features';
import { FinalCta } from '../components/landing/FinalCta';
import { Hero } from '../components/landing/Hero';
import { HowItWorks } from '../components/landing/HowItWorks';
import { LandingFooter } from '../components/landing/LandingFooter';
import { LandingNav } from '../components/landing/LandingNav';
import { Models } from '../components/landing/Models';
import { Pricing } from '../components/landing/Pricing';
import { StatsStrip } from '../components/landing/StatsStrip';
import { Testimonials } from '../components/landing/Testimonials';
import { UseCases } from '../components/landing/UseCases';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { Catalog } from '../types';

/**
 * Trang giới thiệu công khai.
 *
 * Mỗi phần của trang là một component riêng trong `components/landing/` — trang
 * này chỉ xếp thứ tự và rót dữ liệu xuống, nên đổi thứ tự hay bỏ bớt một phần
 * chỉ là sửa một dòng ở đây.
 *
 * Giá và danh sách model lấy từ API bảng giá công khai (`/catalog`, không cần
 * đăng nhập) để trang bán hàng không bao giờ nói sai giá đang bán. API hỏng thì
 * các component tự rơi về bảng giá dự phòng viết sẵn — cố tình KHÔNG hiện màn
 * hình chờ, vì một trang giới thiệu mở ra thấy vòng xoay là mất khách ngay.
 */
export const LandingPage: React.FC = () => {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<Catalog>('/catalog')
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch(() => {
        /* dùng bảng giá dự phòng trong từng component */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-dark-950">
      <LandingNav isLoggedIn={Boolean(user)} />

      <main>
        <Hero isLoggedIn={Boolean(user)} />
        <StatsStrip />
        <HowItWorks />
        <Features />
        <Models models={catalog?.models} packages={catalog?.packages} />
        <UseCases />
        <Pricing packages={catalog?.packages} models={catalog?.models} />
        <Faq />
        <FinalCta isLoggedIn={Boolean(user)} />
      </main>

      <LandingFooter />
    </div>
  );
};
