import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';
import { Alert, Card, PageLoader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatNumber, formatUsd } from '../lib/format';
import { CREDITS, LOGIN } from '../lib/routes';
import type { Catalog } from '../types';

/**
 * Trang Chính sách & Điều khoản.
 *
 * Mọi con số nghiệp vụ (giá gói điểm, số điểm mỗi ảnh, thời hạn đơn) đều đọc từ
 * API bảng giá chứ không viết cứng, để chính sách không bao giờ mâu thuẫn với giá
 * đang bán thật khi admin chỉnh bảng giá.
 *
 * Trang này KHÔNG yêu cầu đăng nhập — khách cần đọc được điều khoản trước khi
 * quyết định tạo tài khoản.
 */

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  // scroll-mt để tiêu đề không bị thanh trên đang dính che mất khi bấm vào mục lục
  <section id={id} className="scroll-mt-24">
    <h2 className="text-lg font-bold text-gray-100 mb-2">{title}</h2>
    <div className="space-y-2 text-sm text-gray-400 leading-relaxed">{children}</div>
  </section>
);

const SECTIONS = [
  { id: 'service', label: 'The service' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'credits', label: 'Credits' },
  { id: 'buying', label: 'Buying credits' },
  { id: 'payments', label: 'Payments' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'content', label: 'Content & ownership' },
  { id: 'prohibited', label: 'Prohibited use' },
  { id: 'data', label: 'Data & privacy' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'changes', label: 'Changes to these terms' },
  { id: 'contact', label: 'Contact' },
];

export const PolicyPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    void api
      .get<Catalog>('/catalog')
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  /**
   * Làm nổi bật mục đang đọc ở cột trái.
   *
   * `rootMargin` phía trên trừ đi chiều cao thanh trên đang dính, nếu không mục sẽ
   * được coi là "đang xem" khi vẫn còn nằm khuất sau thanh đó.
   * Chỉ chạy sau khi có dữ liệu, vì trước đó các thẻ <section> chưa được vẽ ra.
   */
  useEffect(() => {
    if (!catalog) return;

    const elements = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (element): element is HTMLElement => element !== null,
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [catalog]);

  if (!catalog) return <PageLoader label="Loading policies…" />;

  const { site, packages, models } = catalog;
  const cheapest = models.reduce<(typeof models)[number] | null>(
    (best, model) => (model.tokenCost > 0 && (!best || model.tokenCost < best.tokenCost) ? model : best),
    null,
  );
  const missingContact = !site.companyName && !site.supportEmail && !site.supportPhone;

  return (
    <div className="min-h-screen bg-dark-950">
      {/* Thanh trên gọn nhẹ: trang này dùng được cả khi chưa đăng nhập */}
      <header className="h-14 border-b border-dark-800 bg-dark-900/95 backdrop-blur sticky top-0 z-40 flex items-center px-4 gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-400 hover:text-gray-100 transition-colors whitespace-nowrap"
        >
          ← Back
        </button>
        <span className="font-bold text-gray-100 truncate">Terms &amp; Policies</span>

        <div className="ml-auto flex items-center gap-3">
          <Link to={user ? CREDITS : LOGIN} className="text-sm text-brand-500 hover:underline whitespace-nowrap">
            {user ? 'Buy credits' : 'Sign in'}
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-100">Terms of Service &amp; Policies</h1>
          <p className="text-sm text-gray-500 mt-1">
            {site.policyUpdatedAt ? `Last updated: ${site.policyUpdatedAt}.` : ''} By creating an account and paying, you
            confirm that you have read and agree to the terms below.
          </p>
        </div>

        {/* Màn hình hẹp: mục lục nằm trên nội dung, không dính theo cuộn */}
        <Card className="p-4 mb-6 lg:hidden">
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2">Contents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {SECTIONS.map((section, index) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="text-sm text-gray-400 hover:text-brand-500 transition-colors"
              >
                {index + 1}. {section.label}
              </a>
            ))}
          </div>
        </Card>

        <div className="flex gap-8 items-start">
          {/* Màn hình rộng: mục lục là cột trái dính theo cuộn.
              top-20 = chiều cao thanh trên (3.5rem) cộng một khoảng thở. */}
          <aside className="hidden lg:block w-56 shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto custom-scrollbar">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2 px-3">Contents</p>
            <nav className="space-y-0.5">
              {SECTIONS.map((section, index) => {
                const isActive = activeId === section.id;
                return (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={`block text-sm px-3 py-1.5 rounded-lg border-l-2 transition-colors ${
                      isActive
                        ? 'border-brand-500 bg-brand-500/10 text-gray-100 font-semibold'
                        : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-dark-850'
                    }`}
                  >
                    <span className={isActive ? 'text-brand-500' : 'text-gray-600'}>{index + 1}.</span> {section.label}
                  </a>
                );
              })}
            </nav>
          </aside>

          <div className="flex-1 min-w-0 space-y-8">
            {missingContact && (
              <Alert tone="warning">
                Contact details have not been filled in yet. Add them before selling to real customers.
              </Alert>
            )}

            <Card className="p-6 space-y-7">
              <Section id="service" title="1. The service">
                <p>
                  Design Copycat AI generates marketing imagery with artificial intelligence. You upload a reference
                  design and your own product photo; we send them to a third-party AI model provider, which produces a
                  new image following the reference layout.
                </p>
                <p>
                  Output quality depends on that third-party model. We do not guarantee that every generated image will
                  match your expectations.
                </p>
              </Section>

              <Section id="accounts" title="2. Accounts">
                <p>One account per email address. You are responsible for keeping your password secure.</p>
                <p>
                  We may suspend an account if we detect a breach of section 8, or signs of payment fraud or chargeback
                  abuse.
                </p>
              </Section>

              <Section id="credits" title="3. Credits">
                <p>
                  The service is <strong className="text-gray-300">prepaid with credits</strong>: you buy credits and
                  spend them as you go. There is no subscription, no maintenance fee, no minimum term and no automatic
                  renewal.
                </p>
                <p>
                  The number of credits an image costs depends on the model and resolution you pick
                  {cheapest && ` (as low as ${formatNumber(cheapest.tokenCost)} credits per image with ${cheapest.label})`}.
                  The exact cost is always shown before you start a generation.
                </p>
                <p className="text-gray-300">
                  <strong>Purchased credits never expire.</strong> Your balance stays in your account until you spend it,
                  even if you stop using the service for a long time.
                </p>
                <p>Credits have no cash value, cannot be converted back to money, and cannot be transferred between accounts.</p>
                <p className="text-gray-500">
                  Monthly subscription plans are no longer sold. Accounts that bought one previously keep their monthly
                  allowance until the paid term ends, after which they move fully to credits like every other account.
                  Separately purchased credits are unaffected.
                </p>
              </Section>

              <Section id="buying" title="4. Buying credits">
                <p>
                  Credits are sold in fixed packs.
                  {packages.length > 0 && (
                    <>
                      {' '}
                      There are currently {packages.length} packs, from{' '}
                      {formatUsd(Math.min(...packages.map((pkg) => pkg.priceUsdCents)))} to{' '}
                      {formatUsd(Math.max(...packages.map((pkg) => pkg.priceUsdCents)))}.
                    </>
                  )}
                </p>
                <p>
                  Credits are added to your account as soon as the payment is confirmed. There is nothing else to sign up
                  for and no prerequisite.
                </p>
                <p>You can buy more credits at any time, including while you still have a balance.</p>
              </Section>

              <Section id="payments" title="5. Payments">
                <p>
                  Payments are processed by <strong className="text-gray-300">Stripe</strong>. You are redirected to
                  Stripe&rsquo;s secure checkout page to enter your card details. We never receive or store your full card
                  number.
                </p>
                <p>
                  All prices are in <strong className="text-gray-300">US dollars (USD)</strong> and are the final amount
                  charged. Your bank or card issuer may add a foreign transaction or currency conversion fee, which is
                  outside our control.
                </p>
                <p>
                  An order is held for {site.orderExpireMinutes} minutes. If the payment completes later than that, the
                  order is still fulfilled once Stripe confirms it.
                </p>
                <p>
                  If your card is charged but the credits do not appear within a few minutes, reopen the order page — the
                  system re-checks with Stripe automatically. If it still does not resolve, contact us using section 12.
                </p>
              </Section>

              <Section id="refunds" title="6. Refunds">
                <p>
                  <strong className="text-gray-300">Failed generations are refunded automatically</strong>, back to the
                  same credit source they were taken from. You never lose credits to a system error or a provider outage.
                </p>
                <p>
                  Images that generate successfully but do not match your taste are not refundable — the AI provider cost
                  has already been incurred.
                </p>
                <p>
                  Purchased credits are non-refundable once added to your account and cannot be converted to cash. If you
                  were charged without receiving credits, contact us using section 12 and we will reconcile it.
                </p>
              </Section>

              <Section id="content" title="7. Content & ownership">
                <p>
                  You must hold the rights to every image you upload. You are responsible if an uploaded image infringes
                  someone else&rsquo;s rights.
                </p>
                <p>
                  Images the system generates are yours, and you may use them commercially, within the limits set by the
                  AI provider&rsquo;s own terms.
                </p>
                <p>
                  We store your input and output images on our servers so the History page and re-downloads work. We do
                  not sell or share your images with third parties beyond the AI provider that performs the generation.
                </p>
              </Section>

              <Section id="prohibited" title="8. Prohibited use">
                <p>Do not use the service to create or distribute:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Content that is unlawful in your jurisdiction or ours;</li>
                  <li>Content that infringes copyright, trademarks, or a person&rsquo;s likeness;</li>
                  <li>Sexual, violent, hateful, or seriously misleading content;</li>
                  <li>Content impersonating a real organisation or individual;</li>
                  <li>Content intended to defraud, or forged documents, receipts or records.</li>
                </ul>
                <p>You must also comply with the terms of the AI model provider the system uses.</p>
                <p>Accounts in breach are suspended, with no refund of credits or money already paid.</p>
              </Section>

              <Section id="data" title="9. Data & privacy">
                <p>
                  We store your account details (email, name, phone number), order history, the credit ledger, and your
                  input and output images.
                </p>
                <p>Passwords are stored hashed — we cannot read your password.</p>
                <p>
                  Your images are sent to the AI model provider for processing. How that provider stores and uses data is
                  governed by their own policy.
                </p>
                <p>
                  Payment data is handled by Stripe under their privacy policy; we only receive the payment status and a
                  transaction reference.
                </p>
                <p>You can request deletion of your account and associated data by contacting us using section 12.</p>
              </Section>

              <Section id="liability" title="10. Limitation of liability">
                <p>
                  The service depends on third-party infrastructure and AI models, so it may be interrupted by
                  maintenance, technical failures, or changes on the provider&rsquo;s side.
                </p>
                <p>
                  We are not liable for indirect damages arising from your use of generated images. Our maximum liability
                  in any case does not exceed the amount you have paid us in the preceding twelve months.
                </p>
              </Section>

              <Section id="changes" title="11. Changes to these terms">
                <p>
                  We may adjust pack prices, credit costs per image, the model line-up, and these terms as our provider
                  costs change.
                </p>
                <p>
                  Changes are <strong className="text-gray-300">not applied retroactively</strong> to credits you already
                  own: your existing balance keeps its value, and only generations started after a change use the new
                  credit costs.
                </p>
              </Section>

              <Section id="contact" title="12. Contact">
                {site.companyName && (
                  <p>
                    Service operated by: <strong className="text-gray-300">{site.companyName}</strong>
                  </p>
                )}
                {site.companyAddress && <p>Address: {site.companyAddress}</p>}
                {site.supportEmail && (
                  <p>
                    Support email:{' '}
                    <a href={`mailto:${site.supportEmail}`} className="text-brand-500 hover:underline">
                      {site.supportEmail}
                    </a>
                  </p>
                )}
                {site.supportPhone && (
                  <p>
                    Phone:{' '}
                    <a href={`tel:${site.supportPhone.replace(/\s/g, '')}`} className="text-brand-500 hover:underline">
                      {site.supportPhone}
                    </a>
                  </p>
                )}
                {missingContact && <p className="text-gray-500">Contact details are being updated.</p>}
              </Section>
            </Card>

            <p className="text-[11px] text-gray-600 text-center pb-4">
              Prices and credit figures on this page are read directly from the live price list.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
