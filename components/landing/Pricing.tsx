import React from 'react';
import { Link } from 'react-router-dom';
import { formatNumber, formatUsd, formatUsdPrecise } from '../../lib/format';
import { modelShortName, pickReferenceModel, roundedImageCount } from '../../lib/imageEstimate';
import { POLICY, SIGNUP } from '../../lib/routes';
import type { ModelOption, TokenPackage } from '../../types';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

/**
 * Bảng giá dự phòng.
 *
 * Trang giới thiệu phải hiện được giá kể cả khi API bảng giá chưa sẵn sàng —
 * một trang bán hàng mà chỗ giá trống thì coi như hỏng. Số ở đây khớp với dữ
 * liệu khởi tạo trong `server/src/seed.ts`; giá thật luôn được API ghi đè.
 */
const FALLBACK_PACKAGES: TokenPackage[] = [
  { id: 1, code: 'CREDITS_10', name: 'Starter', priceUsdCents: 999, baseTokens: 50_000, bonusTokens: 0, totalTokens: 50_000, pricePerTokenCents: 0.02, bonusPercent: 0, description: 'A quick top-up to try things out.', isPopular: false },
  { id: 2, code: 'CREDITS_20', name: 'Basic', priceUsdCents: 1_999, baseTokens: 100_000, bonusTokens: 0, totalTokens: 100_000, pricePerTokenCents: 0.02, bonusPercent: 0, description: 'Enough for a few dozen images a month.', isPopular: false },
  { id: 3, code: 'CREDITS_50', name: 'Pro', priceUsdCents: 4_999, baseTokens: 250_000, bonusTokens: 0, totalTokens: 250_000, pricePerTokenCents: 0.02, bonusPercent: 0, description: 'The most popular choice for online stores.', isPopular: true },
  { id: 4, code: 'CREDITS_100', name: 'Business', priceUsdCents: 9_999, baseTokens: 500_000, bonusTokens: 0, totalTokens: 500_000, pricePerTokenCents: 0.02, bonusPercent: 0, description: 'Covers a full campaign end to end.', isPopular: false },
  { id: 5, code: 'CREDITS_200', name: 'Agency', priceUsdCents: 19_999, baseTokens: 1_000_000, bonusTokens: 0, totalTokens: 1_000_000, pricePerTokenCents: 0.02, bonusPercent: 0, description: 'For teams producing content at volume.', isPopular: false },
];

/** Quyền lợi giống nhau ở mọi gói — khác nhau chỉ ở số điểm nhận được. */
const INCLUDED = [
  'No maintenance fee, no subscription',
  'Credits never expire — spend them at your own pace',
  'Every model on sale, nothing locked behind a higher tier',
  'Output up to 4K, across 11 aspect ratios',
  'Up to 4 variants per reference, per run',
  'Failed images refunded automatically',
];

export const Pricing: React.FC<{ packages?: TokenPackage[]; models?: ModelOption[] }> = ({ packages, models }) => {
  const packageList = packages && packages.length > 0 ? packages : FALLBACK_PACKAGES;

  // Model mốc và cách làm tròn nằm ở lib/imageEstimate để trang này và trang Mua
  // điểm luôn ra cùng một con số cho cùng một gói.
  const referenceModel = pickReferenceModel(models);

  /*
   * Mốc so sánh mức tiết kiệm: gói có đơn giá mỗi điểm ĐẮT nhất, thường là gói
   * nhỏ nhất. Tính theo đơn giá mỗi điểm chứ không theo số ảnh đã làm tròn — số
   * ảnh làm tròn tới bội của 5/10 nên phần trăm suy ra từ nó nhảy lung tung.
   */
  const unitPrice = (pkg: TokenPackage) => (pkg.totalTokens > 0 ? pkg.priceUsdCents / pkg.totalTokens : 0);
  const baseUnitPrice = packageList.reduce((max, pkg) => Math.max(max, unitPrice(pkg)), 0);

  return (
    <section id="pricing" className="scroll-mt-20 py-14 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <SectionHeading
          eyebrow="Pricing"
          title={
            <>
              Buy credits, <span className="lp-gradient-text">start immediately</span>
            </>
          }
          description="No maintenance fee, no minimum term. You pay only for the images you actually create, and the credits you buy never expire."
        />

        {/*
          Flex-wrap chứ không phải grid: bảng giá có 5 gói mà mỗi hàng 4 cột, nên
          gói cuối luôn đứng lẻ một mình. Grid ghim nó vào cột đầu bên trái trông
          như lỗi bố cục; flex + justify-center đưa nó về giữa hàng dưới.

          Bề rộng trừ đi phần khoảng cách: gap-4 = 1rem, 4 cột có 3 khoảng nên mỗi
          thẻ nhường 0,75rem; 2 cột có 1 khoảng nên nhường 0,5rem.
        */}
        <div className="mt-8 flex flex-wrap justify-center gap-4 sm:mt-12">
          {packageList.map((pkg, index) => {
            const images = referenceModel ? roundedImageCount(pkg.totalTokens, referenceModel.tokenCost) : 0;
            // Tiền mỗi ảnh, tính bằng cent — đây là con số khách so giữa các gói
            // nhanh nhất, nhanh hơn cả so số điểm. KHÔNG làm tròn tới cent: ảnh rẻ
            // nhất chỉ khoảng 0,6 cent, làm tròn là mọi gói cùng hiện ra $0.01.
            const centsPerImage = referenceModel ? unitPrice(pkg) * referenceModel.tokenCost : 0;
            const savedPercent =
              baseUnitPrice > 0 ? Math.round((1 - unitPrice(pkg) / baseUnitPrice) * 100) : 0;

            return (
              <Reveal
                key={pkg.code}
                delay={index * 80}
                className={`relative flex w-full flex-col rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-1 sm:w-[calc(50%-0.5rem)] sm:p-5 lg:w-[calc(25%-0.75rem)] ${
                  pkg.isPopular
                    ? 'border-brand-500 bg-dark-900 shadow-2xl shadow-brand-500/10'
                    : 'border-dark-800 bg-dark-900 hover:border-dark-700'
                }`}
              >
                {pkg.isPopular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Most popular
                  </span>
                )}

                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xl font-bold tracking-tight text-gray-300">{formatUsd(pkg.priceUsdCents)}</p>
                  {/* Chỉ gắn nhãn khi mức tiết kiệm đủ lớn để đáng nói. Dưới 5%
                      thì con số vừa nhỏ vừa làm rối bốn thẻ đứng cạnh nhau. */}
                  {savedPercent >= 5 && (
                    <span className="shrink-0 rounded-md bg-green-500/10 px-1.5 py-0.5 text-[10px] font-bold text-green-400">
                      −{savedPercent}%
                    </span>
                  )}
                </div>

                {/*
                  SỐ ĐIỂM là con số lớn nhất trên thẻ, không phải giá tiền: khách
                  đã biết mình định tiêu bao nhiêu, thứ họ cần so giữa các thẻ là
                  đổi được bao nhiêu điểm. Bỏ luôn khung nền xám bọc ngoài — chữ
                  đủ to rồi thì cái khung chỉ tốn chiều cao.

                  Khoá chiều cao tối thiểu vì thẻ có thưởng cao hơn thẻ không có
                  đúng một dòng; không khoá thì mọi thứ bên dưới lệch nhau.

                  Số to LUÔN là tổng nhận được, phần thưởng ghi rõ "đã gồm" —
                  để "+50.000" ngay sau tổng thì đọc ra thành cộng thêm lần nữa.
                */}
                <div className="mt-2 min-h-[3.5rem]">
                  <p className="text-[1.75rem] font-bold leading-none tracking-tight text-brand-500">
                    {formatNumber(pkg.totalTokens)}
                    <span className="ml-1 text-xs font-semibold text-gray-500">credits</span>
                  </p>
                  {pkg.bonusTokens > 0 && (
                    <p className="mt-1 text-[11px] leading-tight text-green-400">
                      Includes {formatNumber(pkg.bonusTokens)} bonus credits
                    </p>
                  )}
                </div>

                {/* Vùng co giãn: mô tả dài ngắn khác nhau nhưng nút vẫn thẳng hàng đáy */}
                <div className="mt-3 flex-1 border-t border-dark-800 pt-3">
                  {images > 0 && (
                    <p className="text-xs text-gray-500">
                      <span className="font-bold text-gray-200">≈ {formatNumber(images)} images</span>
                      {centsPerImage > 0 && (
                        <>
                          <span className="mx-1.5 text-gray-600">·</span>
                          {formatUsdPrecise(centsPerImage)}/image
                        </>
                      )}
                    </p>
                  )}
                  {pkg.description && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">{pkg.description}</p>
                  )}
                </div>

                <Link
                  to={SIGNUP}
                  className={`mt-4 rounded-xl px-4 py-2.5 text-center text-sm font-bold transition-colors ${
                    pkg.isPopular
                      ? 'bg-brand-500 text-white hover:bg-brand-600'
                      : 'border border-dark-700 text-gray-200 hover:border-brand-500/40 hover:bg-dark-850'
                  }`}
                >
                  Buy credits
                </Link>
              </Reveal>
            );
          })}
        </div>

        {referenceModel && (
          <Reveal delay={120}>
            <p className="mt-4 text-center text-[11px] text-gray-600">
              {/* Số điểm đọc từ bảng giá chứ không gõ tay — gõ tay là sớm muộn
                  cũng lệch với con số thật khi admin chỉnh bảng giá. */}
              Image counts assume <strong className="text-gray-500">{modelShortName(referenceModel)}</strong> at{' '}
              {referenceModel.resolution} ({formatNumber(referenceModel.tokenCost)} credits per image). 1K goes further,
              4K goes less far.
            </p>
          </Reveal>
        )}

        <Reveal delay={140} className="mt-6 rounded-2xl border border-dark-800 bg-dark-900 p-5 sm:p-6">
          <h3 className="text-sm font-bold text-gray-100">Included in every pack</h3>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-gray-400">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={160}>
          <p className="mt-8 text-center text-xs text-gray-500">
            Secure card payment via Stripe — credits are added automatically. Full details in the{' '}
            <Link to={POLICY} className="font-semibold text-brand-500 underline-offset-2 hover:underline">
              Terms &amp; Policies
            </Link>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
};
