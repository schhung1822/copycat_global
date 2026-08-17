import React from 'react';
import { formatNumber } from '../../lib/format';
import { pickBasisPackage, roundedImageCount } from '../../lib/imageEstimate';
import type { ModelOption, TokenPackage } from '../../types';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

/**
 * Mô tả bán hàng cho từng dòng model.
 *
 * Chỉ giữ phần chữ ở đây; số điểm luôn lấy từ bảng giá thật (`models`) để trang
 * giới thiệu không bao giờ báo giá lệch với trang tạo ảnh sau khi admin chỉnh giá.
 *
 * Thứ tự trong mảng là thứ tự hiện trên trang: đặt bản mạnh nhất trước.
 */
const FAMILY_COPY: { family: string; name: string; tagline: string; best: string; highlight?: boolean }[] = [
  {
    family: 'gpt-image-2',
    name: 'GPT Image 2',
    tagline: 'Great with text and ad layouts, and the easiest on your credit balance.',
    best: 'Copy-heavy banners, and testing layouts before a final run',
  },
  {
    family: 'nano-banana-2',
    name: 'Nano Banana 2',
    tagline: 'Balances quality and speed — the safe pick for everyday work.',
    best: 'Daily social posts',
    highlight: true,
  },
  {
    family: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    tagline: 'Follows the reference most closely and preserves product detail and colour.',
    best: 'Official launches and marketplace listings',
  },
];

/**
 * Bảng giá dự phòng, dùng khi không gọi được API — trang vẫn phải đọc được.
 *
 * Số ở đây là giá trị khởi tạo trong `server/src/seed.ts`, KHÔNG phải giá đang
 * bán thật: admin chỉnh giá trong trang Quản trị thì chỉ database đổi, danh sách
 * này đứng yên. Chấp nhận được vì nó chỉ hiện khi API chết — lúc đó có số cũ vẫn
 * hơn là khu bảng giá trống trơn.
 */
const FALLBACK: ModelOption[] = [
  { code: 'nano-banana-pro-1k', label: '', family: 'nano-banana-pro', resolution: '1K', tokenCost: 900, isEstimateReference: false, notes: null },
  { code: 'nano-banana-pro-2k', label: '', family: 'nano-banana-pro', resolution: '2K', tokenCost: 900, isEstimateReference: false, notes: null },
  { code: 'nano-banana-pro-4k', label: '', family: 'nano-banana-pro', resolution: '4K', tokenCost: 1200, isEstimateReference: false, notes: null },
  { code: 'nano-banana-2-1k', label: '', family: 'nano-banana-2', resolution: '1K', tokenCost: 400, isEstimateReference: false, notes: null },
  { code: 'nano-banana-2-2k', label: '', family: 'nano-banana-2', resolution: '2K', tokenCost: 600, isEstimateReference: false, notes: null },
  { code: 'nano-banana-2-4k', label: '', family: 'nano-banana-2', resolution: '4K', tokenCost: 900, isEstimateReference: false, notes: null },
  { code: 'gpt-image-2-1k', label: '', family: 'gpt-image-2', resolution: '1K', tokenCost: 300, isEstimateReference: false, notes: null },
  { code: 'gpt-image-2-2k', label: '', family: 'gpt-image-2', resolution: '2K', tokenCost: 500, isEstimateReference: true, notes: null },
  { code: 'gpt-image-2-4k', label: '', family: 'gpt-image-2', resolution: '4K', tokenCost: 800, isEstimateReference: false, notes: null },
];

const RESOLUTION_ORDER = ['1K', '2K', '4K'];

export const Models: React.FC<{ models?: ModelOption[]; packages?: TokenPackage[] }> = ({ models, packages }) => {
  const source = models && models.length > 0 ? models : FALLBACK;

  /*
   * Mốc quy "điểm/ảnh" ra "số ảnh" là một GÓI ĐIỂM đang bán, không phải hằng số.
   *
   * Trước đây chỗ này chia cho 500.000 — hạn mức tháng của gói thuê bao đã ngừng
   * bán. Con số ra không còn ứng với thứ gì khách mua được, và cũng không đổi
   * theo khi admin chỉnh bảng giá.
   */
  const basis = pickBasisPackage(packages);

  const cards = FAMILY_COPY.map((copy) => {
    const tiers = source
      .filter((model) => model.family === copy.family)
      .sort((a, b) => RESOLUTION_ORDER.indexOf(a.resolution) - RESOLUTION_ORDER.indexOf(b.resolution));
    return { ...copy, tiers };
  }).filter((card) => card.tiers.length > 0);

  return (
    <section id="models" className="scroll-mt-20 py-14 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <SectionHeading
          eyebrow="AI models"
          title="Pick a model for the job, not for the marketing"
          description={
            basis
              ? `Credits are charged per model and resolution, and shown before you press generate. The image counts on the right assume the full ${formatNumber(basis.totalTokens)} credits from the ${basis.name} pack.`
              : 'Credits are charged per model and resolution, and shown before you press generate.'
          }
        />

        <div className="mt-10 grid sm:mt-14 gap-5 lg:grid-cols-3">
          {cards.map((card, index) => (
            <Reveal
              key={card.family}
              delay={index * 110}
              className={`group relative flex flex-col rounded-2xl border p-5 transition-all sm:p-6 duration-300 hover:-translate-y-1 ${
                card.highlight
                  ? 'border-brand-500/40 bg-dark-900 shadow-xl shadow-brand-500/5'
                  : 'border-dark-800 bg-dark-900 hover:border-dark-700'
              }`}
            >
              {card.highlight && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-brand-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Most popular
                </span>
              )}

              <h3 className="text-lg font-bold text-gray-100">{card.name}</h3>
              <p className="mt-2 min-h-[3rem] text-sm leading-relaxed text-gray-400">{card.tagline}</p>

              <div className="mt-5 space-y-1.5">
                {card.tiers.map((tier) => (
                  <div
                    key={tier.code}
                    className="flex items-center justify-between rounded-lg bg-dark-850 px-3 py-2 text-sm transition-colors group-hover:bg-dark-800"
                  >
                    <span className="font-semibold text-gray-200">{tier.resolution}</span>
                    <span className="text-xs text-gray-500">
                      <span className="font-semibold text-gray-300">{formatNumber(tier.tokenCost)}</span> credits
                      {basis && (
                        <>
                          <span className="mx-1.5 text-gray-600">·</span>~
                          {formatNumber(roundedImageCount(basis.totalTokens, tier.tokenCost))} images
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-5 border-t border-dark-800 pt-4 text-xs leading-relaxed text-gray-500">
                <span className="font-bold text-gray-400">Best for: </span>
                {card.best}
              </p>
            </Reveal>
          ))}
        </div>

        {/* <Reveal delay={140}>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-gray-500">
            The credit rule is simple: <span className="font-semibold text-gray-400">10,000 credits = $1 of provider
            cost</span>. You always see the true cost of each image.
          </p>
        </Reveal> */}
      </div>
    </section>
  );
};
