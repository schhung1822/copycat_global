import React from 'react';
import { Link } from 'react-router-dom';
import { CREDITS, LOGIN, POLICY, SIGNUP, WALLET } from '../../lib/routes';
import { LandingLogo } from './LandingLogo';

/** Nhóm liên kết ở chân trang. Mục dùng thẻ <a> là neo trong trang. */
const COLUMNS: { title: string; links: { label: string; to?: string; href?: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Features', href: '#features' },
      { label: 'AI models', href: '#models' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign up', to: SIGNUP },
      { label: 'Sign in', to: LOGIN },
      { label: 'Buy credits', to: CREDITS },
      { label: 'Credit history', to: WALLET },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'FAQ', href: '#faq' },
      { label: 'Terms & Policies', to: POLICY },
      { label: 'Refunds', to: `${POLICY}#refunds` },
      { label: 'Contact', to: `${POLICY}#contact` },
    ],
  },
];

const linkClass = 'text-sm text-gray-500 transition-colors hover:text-gray-200';

export const LandingFooter: React.FC = () => (
  <footer className="border-t border-dark-800 bg-dark-900/60">
    <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 sm:py-14">
      <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
        <div>
          <LandingLogo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-gray-500">
            AI product imagery for people who sell online: borrow the layout of a design you love, and put your own
            product in it.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to} className={linkClass}>
                        {link.label}
                      </Link>
                    ) : (
                      <a href={link.href} className={linkClass}>
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-12 flex flex-col gap-3 border-t border-dark-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-600">© {new Date().getFullYear()} Nextgency. All rights reserved.</p>
        <p className="text-xs text-gray-600">
          Images are AI-generated — you are responsible for what you upload and publish.
        </p>
      </div>
    </div>
  </footer>
);
