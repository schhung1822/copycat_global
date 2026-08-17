import React, { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../../lib/format';

/**
 * Số đếm tăng dần khi cuộn tới.
 *
 * Dùng requestAnimationFrame chứ không setInterval: rAF khớp với nhịp vẽ của
 * màn hình nên số chạy mượt, và trình duyệt tự dừng khi người dùng chuyển tab.
 *
 * Hàm giảm tốc (ease-out) làm số lao nhanh lúc đầu rồi chậm dần ở đích — đây là
 * thứ khiến hiệu ứng trông "có trọng lượng" thay vì chạy đều đều như đồng hồ.
 */
const useCountUp = (target: number, durationMs = 1400) => {
  const ref = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Người dùng đã tắt hiệu ứng chuyển động thì hiện thẳng số cuối.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }

    let frame = 0;
    let start = 0;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const step = (now: number) => {
          if (!start) start = now;
          const progress = Math.min((now - start) / durationMs, 1);
          setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs]);

  return { ref, value };
};

const Stat: React.FC<{ value: number; suffix?: string; prefix?: string; label: string }> = ({
  value,
  suffix = '',
  prefix = '',
  label,
}) => {
  const { ref, value: current } = useCountUp(value);

  return (
    <div className="text-center">
      <p ref={ref as React.Ref<HTMLParagraphElement>} className="text-2xl font-bold tracking-tight text-gray-100 sm:text-3xl">
        {prefix}
        {formatNumber(current)}
        {suffix}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500 max-w-[200px] mx-auto">{label}</p>
    </div>
  );
};

/** Từ khoá chạy ngang: cho khách thấy ngay hệ thống hợp với việc gì. */
const KEYWORDS = [
  'E-commerce product shots',
  'Promo banners',
  'Facebook cover images',
  'TikTok Shop thumbnails',
  'Event posters',
  'Restaurant menu photos',
  'Fashion catalogues',
  'Cosmetics imagery',
  'Packaging mockups',
];

export const StatsStrip: React.FC = () => (
  <section className="border-y border-dark-800 bg-dark-900">
    {/* Dải từ khoá chạy vô tận. Nội dung được lặp hai lần để vòng lặp liền mạch;
        aria-hidden ở bản sao để trình đọc màn hình không đọc hai lượt. */}
    <div className="lp-marquee-track relative overflow-hidden border-b border-dark-800 py-3">
      <div className="lp-marquee flex w-max gap-3">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex gap-3" aria-hidden={copy === 1}>
            {KEYWORDS.map((keyword) => (
              <span
                key={keyword}
                className="whitespace-nowrap rounded-full border border-dark-800 bg-dark-850 px-4 py-1.5 text-xs text-gray-400"
              >
                {keyword}
              </span>
            ))}
          </div>
        ))}
      </div>
      {/* Làm mờ hai mép để dải chữ trôi vào/ra thay vì bị cắt cụt */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-dark-900 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-dark-900 to-transparent" />
    </div>

    <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-7 px-4 py-8 sm:gap-6 sm:py-10 sm:px-6 lg:grid-cols-4">
      <Stat value={250000} label="Credits in the most popular pack, and they never expire" />
      <Stat value={400} prefix="~" suffix=" images" label="Images that pack buys on Nano Banana 2 at 2K" />
      <Stat value={3} suffix=" models" label="The most trusted image models from OpenAI and Google" />
      <Stat value={11} suffix=" ratios" label="Sized for every social channel and marketplace" />
    </div>
  </section>
);
