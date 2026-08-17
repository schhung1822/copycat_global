import React from 'react';
import { Link } from 'react-router-dom';
import { APP_HOME, SIGNUP } from '../../lib/routes';
import { HeroShowcase } from './HeroShowcase';
import { Reveal } from './Reveal';

const BENEFITS = [
  '90% faster: 100 product images in about 3 minutes',
  'Explore any style or selling concept you like',
];

const PROMISES = ['Keeps the reference layout', 'Card payment, credits land instantly', 'Failed images refunded'];

const CheckIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

export const Hero: React.FC<{ isLoggedIn: boolean }> = ({ isLoggedIn }) => (
  <section className="relative overflow-hidden pb-14 pt-24 sm:pb-24 sm:pt-28 lg:pt-32">
    <div className="lp-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />

    {/*
      Cột phải rộng hơn cột chữ (1.25fr): khối minh hoạ là thứ khách nhìn đầu
      tiên, chia đôi đều thì ảnh kết quả bé hơn mức đọc được bố cục.
    */}
    <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 sm:gap-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-10">
      <div className="text-center lg:text-left">
        <Reveal>
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-dark-700 bg-dark-900/80 px-3 py-1.5 text-[11px] font-medium text-gray-400 shadow-sm shadow-black/5 backdrop-blur sm:text-xs">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="lp-ping-ring absolute inset-0 rounded-full bg-brand-500" />
              <span className="relative h-2 w-2 rounded-full bg-brand-500" />
            </span>
            <span className="truncate">Nano Banana Pro · Nano Banana 2 · GPT Image 2</span>
          </span>
        </Reveal>

        <Reveal delay={90}>
          <h1 className="mx-auto mt-5 max-w-2xl text-balance text-[2.15rem] font-bold leading-[1.05] tracking-tight text-gray-100 sm:mt-6 sm:text-5xl lg:mx-0 lg:text-[3.25rem]">
            AI product photos — no model,
            <span className="block">
              no studio, <span className="lp-gradient-text">100% REALISTIC</span>
            </span>
          </h1>
        </Reveal>

        <Reveal delay={130}>
          <div className="mx-auto mt-4 h-px w-24 bg-gradient-to-r from-transparent via-brand-500/50 to-transparent lg:mx-0 lg:bg-gradient-to-r" />
        </Reveal>

        <Reveal delay={170}>
          <ul className="mx-auto mt-6 grid max-w-xl gap-2.5 lg:mx-0">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit}
                className="flex items-start gap-3 rounded-2xl border border-dark-800 bg-dark-900/70 px-4 py-3 text-left text-sm font-bold text-gray-200 shadow-lg shadow-black/5 backdrop-blur sm:text-base"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-md shadow-brand-500/25">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={230}>
          <div className="mt-7 flex flex-col items-stretch justify-center gap-2.5 sm:mt-8 sm:flex-row sm:items-center sm:gap-3 lg:justify-start">
            <Link
              to={isLoggedIn ? APP_HOME : SIGNUP}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-brand-500 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-brand-500/30 transition-all hover:-translate-y-0.5 hover:bg-brand-600 hover:shadow-brand-500/45"
            >
              {isLoggedIn ? 'Open the studio' : 'Create your first image'}
              <svg
                className="h-4 w-4 transition-transform group-hover:translate-x-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-6l6 6-6 6" />
              </svg>
            </Link>

            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-dark-700 bg-dark-900/60 px-7 py-3.5 text-sm font-bold text-gray-200 shadow-sm shadow-black/5 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-dark-600 hover:bg-dark-850"
            >
              <svg className="h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 5v14l11-7-11-7z" />
              </svg>
              See how it works
            </a>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <ul className="mx-auto mt-6 flex max-w-xl flex-wrap justify-center gap-2 lg:mx-0 lg:justify-start">
            {PROMISES.map((promise) => (
              <li
                key={promise}
                className="inline-flex items-center gap-1.5 rounded-full border border-dark-800 bg-dark-900/60 px-3 py-1.5 text-xs font-medium text-gray-500"
              >
                <CheckIcon className="h-3.5 w-3.5 shrink-0 text-green-400" />
                {promise}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>

      <Reveal delay={200} anim="zoom" className="xl:pl-4">
        <HeroShowcase />
      </Reveal>
    </div>
  </section>
);
