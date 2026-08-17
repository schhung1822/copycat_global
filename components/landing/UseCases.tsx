import React from 'react';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

const CASES = [
  {
    who: 'Online store owners',
    pain: 'Every new shipment means booking a photographer and waiting two or three days for usable shots.',
    gain: 'Shoot the product on your phone, borrow a layout from a brand you admire, and publish the same morning.',
  },
  {
    who: 'Performance marketers',
    pain: 'You need a dozen creative variants to test, but your designer can only turn around two or three.',
    gain: 'One reference produces four variants per run — a week of A/B material in a single sitting.',
  },
  {
    who: 'Agencies & freelancers',
    pain: 'The client sends a reference link and says "make it like this, but with my product".',
    gain: 'Build the demo live in the meeting and lock the direction before you invest in the real thing.',
  },
  {
    who: 'Small brands',
    pain: 'Every channel looks different — nothing reads as one coherent identity.',
    gain: 'Use one reference across the whole product line, so everything matches from your site to the marketplace.',
  },
];

/**
 * Phần "dành cho ai".
 *
 * Viết theo cặp vấn đề → kết quả thay vì liệt kê ngành nghề: khách nhận ra mình
 * qua tình huống đang gặp nhanh hơn nhiều so với qua cái nhãn nghề nghiệp.
 */
export const UseCases: React.FC = () => (
  <section className="border-y border-dark-800 bg-dark-900/40 py-14 sm:py-20 lg:py-28">
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
      <SectionHeading
        eyebrow="Who it is for"
        title="If you have ever wished for great imagery without waiting on a designer"
        description="Built for people who sell online: fast, far cheaper than a photo shoot, and it asks for zero design skill."
      />

      <div className="mt-10 grid sm:mt-14 gap-4 sm:grid-cols-2">
        {CASES.map((item, index) => (
          <Reveal
            key={item.who}
            delay={(index % 2) * 100}
            className="group rounded-2xl border border-dark-800 bg-dark-900 p-5 transition-all sm:p-6 duration-300 hover:-translate-y-1 hover:border-brand-500/30 hover:shadow-xl hover:shadow-black/10"
          >
            <h3 className="text-base font-bold text-gray-100">{item.who}</h3>

            <p className="mt-4 flex gap-3 text-sm leading-relaxed text-gray-500">
              <span className="mt-1 h-4 w-4 shrink-0 rounded-full bg-dark-800 text-center text-[10px] font-bold leading-4 text-gray-500">
                !
              </span>
              {item.pain}
            </p>

            <p className="mt-3 flex gap-3 text-sm leading-relaxed text-gray-300">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {item.gain}
            </p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);
