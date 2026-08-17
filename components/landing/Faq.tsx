import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { POLICY } from '../../lib/routes';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

const QUESTIONS = [
  {
    q: 'Will the result look exactly like the reference image?',
    a: 'The system studies the reference layout, lighting and style, then rebuilds it around your product — so it matches the presentation, it does not copy the image. The product shown is always the one you uploaded.',
  },
  {
    q: 'Do I need to know design software?',
    a: 'No. Upload two images and press generate. The extra notes field is optional — write it in plain English, the way you would brief a person.',
  },
  {
    q: 'What are credits and how are they counted?',
    a: 'Credits are the usage unit: 10,000 credits equal $1 of provider cost. Each image costs a fixed number of credits depending on the model and resolution, and the exact cost is shown before you press generate.',
  },
  {
    q: 'Is there a monthly fee?',
    a: 'No. You buy credits and use them right away — no maintenance fee, no minimum term, no auto-renewal. When you run out, buy more; if you do not, nothing is lost.',
  },
  {
    q: 'Do purchased credits expire?',
    a: 'No. They stay in your account until you spend them, even if you take a few months off.',
  },
  {
    q: 'Do I lose credits when an image fails?',
    a: 'No. When the provider returns an error, the exact credits are refunded automatically and the refund is itemised in your ledger. You do not have to ask for it.',
  },
  {
    q: 'How do I pay?',
    a: 'By card through Stripe. You are redirected to a secure Stripe checkout page, and credits land in your account the moment the payment clears. We never see your card number.',
  },
  {
    q: 'Can I use the generated images commercially?',
    a: 'Yes. You are responsible for the reference and product images you upload, and you may not use the system to counterfeit another brand or product. Details are in the Content & ownership section of the Terms.',
  },
];

/**
 * Hỏi đáp dạng gập mở.
 *
 * Chỉ mở một câu tại một thời điểm: đóng câu trước lại khi mở câu mới, để danh
 * sách không phình ra thành một bức tường chữ.
 *
 * Dùng <button> thật thay vì <details> vì cần điều khiển được hiệu ứng trượt —
 * <details> đóng/mở tức thì, không cho phép chuyển tiếp chiều cao.
 */
export const Faq: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-20 py-14 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <SectionHeading
          eyebrow="FAQ"
          title="The questions we hear most"
          description="Not seeing yours? The Terms & Policies page spells out every business rule and number in detail."
        />

        <div className="mt-9 space-y-2.5 sm:mt-12">
          {QUESTIONS.map((item, index) => {
            const isOpen = openIndex === index;

            return (
              <Reveal
                key={item.q}
                delay={index * 50}
                className={`overflow-hidden rounded-2xl border transition-colors duration-300 ${
                  isOpen ? 'border-brand-500/30 bg-dark-900' : 'border-dark-800 bg-dark-900/60 hover:border-dark-700'
                }`}
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:gap-4 sm:px-5 sm:py-4"
                >
                  <span className="flex-1 text-sm font-semibold text-gray-100 sm:text-base">{item.q}</span>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                      isOpen ? 'rotate-45 border-brand-500 bg-brand-500 text-white' : 'border-dark-700 text-gray-400'
                    }`}
                    aria-hidden
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </button>

                {/*
                  Trượt bằng grid-template-rows 0fr → 1fr: cách duy nhất chuyển
                  tiếp mượt tới chiều cao "tự động" mà không phải đo bằng JS.
                */}
                <div
                  className={`grid transition-all duration-300 ease-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-4 pb-4 text-sm leading-relaxed text-gray-400 sm:px-5 sm:pb-5">{item.a}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={100}>
          <p className="mt-8 text-center text-sm text-gray-500">
            <Link to={POLICY} className="font-semibold text-brand-500 underline-offset-2 hover:underline">
              Read the full Terms &amp; Policies
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
};
