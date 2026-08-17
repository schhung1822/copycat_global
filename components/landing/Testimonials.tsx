import React from 'react';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

/**
 * ⚠️ NỘI DUNG MẪU — PHẢI THAY TRƯỚC KHI ĐƯA TRANG LÊN CHẠY THẬT.
 *
 * Ba lời chứng thực dưới đây do người viết trang dựng ra để canh bố cục, KHÔNG
 * phải đánh giá của khách hàng thật. Đăng nguyên như vậy là quảng cáo sai sự
 * thật với người mua — ở Mỹ và EU còn là vi phạm luật quảng cáo, không chỉ là
 * chuyện đạo đức.
 *
 * Tên người đã đổi thành "Sample Name" cho lộ hẳn ra rằng đây là chỗ giữ chỗ.
 * Cách thay: lấy đánh giá thật và xin phép người viết trước khi trích tên. Nếu
 * chưa có đánh giá nào, xoá hẳn phần này khỏi `LandingPage.tsx` — bỏ trống còn
 * hơn là bịa.
 */
const TESTIMONIALS = [
  {
    quote:
      'Every new drop used to mean booking a studio and waiting three days for photos. Now I shoot on my phone, drop it in here, and the listing is live by the afternoon.',
    name: 'Sample Name',
    role: 'Fashion store owner',
  },
  {
    quote:
      'What I like most is getting four variants in one run. Paid ads need a lot of creative to test against, and doing that by hand never kept up.',
    name: 'Sample Name',
    role: 'Performance marketer',
  },
  {
    quote:
      'Clients send a reference link and ask for the same thing with their product. We build the demo during the call and agree the direction before doing the real work.',
    name: 'Sample Name',
    role: 'Creative agency',
  },
];

export const Testimonials: React.FC = () => (
  <section className="border-y border-dark-800 bg-dark-900/40 py-14 sm:py-20 lg:py-28">
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
      <SectionHeading eyebrow="Testimonials" title="What people say" />

      <div className="mt-10 grid sm:mt-14 gap-4 lg:grid-cols-3">
        {TESTIMONIALS.map((item, index) => (
          <Reveal
            key={item.quote}
            delay={index * 110}
            className="flex flex-col rounded-2xl border border-dark-800 bg-dark-900 p-5 transition-all sm:p-6 duration-300 hover:-translate-y-1 hover:border-brand-500/30"
          >
            <svg className="h-7 w-7 text-brand-500/30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M9.5 5C6.5 6.7 4.8 9.5 4.8 13v6h6.4v-6.4H8.4c0-2 .9-3.6 2.7-4.7L9.5 5zm8.6 0c-3 1.7-4.7 4.5-4.7 8v6h6.4v-6.4H17c0-2 .9-3.6 2.7-4.7L18.1 5z" />
            </svg>

            <p className="mt-4 flex-1 text-sm leading-relaxed text-gray-300">{item.quote}</p>

            <div className="mt-5 flex items-center gap-3 border-t border-dark-800 pt-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/10 text-sm font-bold text-brand-500">
                {item.role.charAt(0)}
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-200">{item.name}</p>
                <p className="text-xs text-gray-500">{item.role}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);
