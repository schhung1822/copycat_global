import React from 'react';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

/**
 * Biểu tượng vẽ bằng SVG inline thay vì cài thư viện icon: dự án chưa có
 * dependency icon nào, thêm hẳn một gói chỉ vì tám cái hình là không đáng.
 */
const Icon: React.FC<{ path: string }> = ({ path }) => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);

const FEATURES = [
  {
    title: 'Faithful to the reference layout',
    body: 'Camera angle, lighting, white space, text placement — everything that makes the original work is kept. Only the product changes.',
    icon: 'M4 6a2 2 0 012-2h5v16H6a2 2 0 01-2-2V6zm9-2h5a2 2 0 012 2v12a2 2 0 01-2 2h-5V4z',
    span: 'lg:col-span-2',
  },
  {
    title: 'Three model families, nine quality tiers',
    body: 'Nano Banana Pro follows the reference most closely, Nano Banana 2 balances speed and quality, GPT Image 2 excels at text and ad layouts.',
    icon: 'M12 3l2.4 5.5L20 10l-4.2 3.8L17 20l-5-2.9L7 20l1.2-6.2L4 10l5.6-1.5L12 3z',
  },
  {
    title: 'Batch generation in one go',
    body: 'Multiple references × up to 4 variants each. It all runs in the background — no waiting on one image at a time.',
    icon: 'M8 4h11a1 1 0 011 1v11M5 8h11a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V9a1 1 0 011-1z',
  },
  {
    title: 'Sharpen & reimagine products',
    body: 'Rescue blurry shots, or ask the system to redraw your product in a completely different format.',
    icon: 'M4 8V5a1 1 0 011-1h3m8 0h3a1 1 0 011 1v3m0 8v3a1 1 0 01-1 1h-3m-8 0H5a1 1 0 01-1-1v-3',
  },
  {
    title: 'Failed images refund themselves',
    body: 'If the provider returns an error, the exact credits are put straight back. No support ticket needed.',
    icon: 'M4 4v6h6M20 20v-6h-6M4.6 15a8 8 0 0014-3M19.4 9A8 8 0 005 12',
  },
  {
    title: 'Full history, re-downloadable any time',
    body: 'Every image you have generated, with the notes and settings used. Download it again, or rerun it with new notes.',
    icon: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'A credit ledger you can audit',
    body: 'Every generation gets its own line: which model, how many credits, what was left afterwards. Refunds are itemised too.',
    icon: 'M3 8a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm13 4h2',
    span: 'lg:col-span-2',
  },
];

/**
 * Lưới tính năng kiểu "bento": vài ô rộng gấp đôi để mắt có điểm dừng thay vì
 * tám ô đều tăm tắp. Ô rộng dành cho hai tính năng bán hàng mạnh nhất.
 */
export const Features: React.FC = () => (
  <section id="features" className="scroll-mt-20 border-y border-dark-800 bg-dark-900/40 py-14 sm:py-20 lg:py-28">
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
      <SectionHeading
        eyebrow="Features"
        title="Everything you need to build selling imagery"
        description="Not a general-purpose chat box. Every feature here exists for one job: producing product images you can actually publish."
      />

      <div className="mt-10 grid sm:mt-14 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, index) => (
          <Reveal
            key={feature.title}
            delay={(index % 3) * 90}
            className={`group relative overflow-hidden rounded-2xl border border-dark-800 bg-dark-900 p-5 transition-all sm:p-6 duration-300 hover:-translate-y-1 hover:border-brand-500/30 hover:shadow-2xl hover:shadow-black/15 ${
              feature.span ?? ''
            }`}
          >
            {/* Ánh sáng mờ hiện ra khi rê chuột, chỉ để trang trí */}
            <span
              className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-500/10 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
              aria-hidden
            />

            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500 transition-transform duration-300 group-hover:scale-110">
              <Icon path={feature.icon} />
            </span>

            <h3 className="relative mt-4 text-base font-bold text-gray-100">{feature.title}</h3>
            <p className="relative mt-2 text-sm leading-relaxed text-gray-400">{feature.body}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);
