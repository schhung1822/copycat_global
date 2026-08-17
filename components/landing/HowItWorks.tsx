import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reveal } from './Reveal';
import { SectionHeading } from './SectionHeading';

/**
 * Bốn bước của quy trình.
 *
 * `image` để trống là có chủ ý: ảnh chụp màn hình thật sẽ bổ sung sau. Chừng nào
 * còn trống thì khung bên phải hiện ô giữ chỗ, không làm vỡ bố cục. Khi có ảnh,
 * chỉ cần điền đường dẫn (vd `/anh/buoc-1.png` nếu để trong thư mục `public/`)
 * và sửa `imageAlt` cho đúng nội dung ảnh — không phải sửa gì thêm ở dưới.
 */
const STEPS = [
  {
    tag: 'Step 1',
    title: 'Upload the design you want to copy',
    body: 'A screenshot of an ad you like, a catalogue page, or any layout at all. Upload several references at once to compare styles.',
    image: '/img/b1.webp',
    imageAlt: 'Uploading a reference design to the studio',
  },
  {
    tag: 'Step 2',
    title: 'Upload your product photo',
    body: 'A phone snapshot is fine. The system keeps your product\u2019s shape, colour and details intact while rebuilding the reference layout around it.',
    image: '/img/b2.webp',
    imageAlt: 'Uploading a product photo to the studio',
  },
  {
    tag: 'Step 3',
    title: 'Pick a model, resolution and aspect ratio',
    body: 'Each model has its own strengths and credit cost. Use 1K for quick tests, 4K when you need a print file. Add a note if you want a different background or less text.',
    image: '/img/b3.webp',
    imageAlt: 'Model, resolution and aspect ratio picker',
  },
  {
    tag: 'Step 4',
    title: 'Get your images, download or rerun',
    body: 'Up to 4 variants per reference in a single run. Finished images go to your History and can be downloaded any time. Not quite right? Tweak the note and run it again.',
    image: '/img/b4.webp',
    imageAlt: 'Grid of generated results with download and regenerate buttons',
  },
];

/** Ô giữ chỗ khi bước đó chưa có ảnh chụp màn hình. */
const ImagePlaceholder: React.FC<{ index: number }> = ({ index }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-dark-700 bg-dark-850 p-6 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-dark-800 text-gray-600">
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 10l4.5-4.5 3.5 3.5 3-3L20 16M9 9.5a1 1 0 11-2 0 1 1 0 012 0z"
        />
      </svg>
    </span>
    <p className="text-sm font-semibold text-gray-400">Screenshot for step {index + 1}</p>
    <p className="max-w-[18rem] text-xs leading-relaxed text-gray-600">
      Set the image path in <span className="font-mono text-gray-500">STEPS[{index}].image</span> inside{' '}
      <span className="font-mono text-gray-500">HowItWorks.tsx</span>.
    </p>
  </div>
);

/**
 * Cửa sổ phóng to ảnh của một bước.
 *
 * Dựng bằng portal ra thẳng `document.body`: khung ảnh ở cột phải nằm trong một
 * thẻ `overflow-hidden` và một khối `position: sticky`, đặt lớp phủ ngay tại đó
 * thì nó bị cắt và bị nhốt trong ngữ cảnh xếp lớp của cột.
 *
 * Ảnh dùng `object-contain` chứ không phải `object-cover` như ở khung nhỏ — mục
 * đích của cửa sổ này là nhìn rõ toàn bộ ảnh, cắt mất mép là mất luôn lý do mở.
 */
const ImageLightbox: React.FC<{
  step: (typeof STEPS)[number];
  hasSiblings: boolean;
  onClose: () => void;
  onNavigate: (delta: number) => void;
}> = ({ step, hasSiblings, onClose, onNavigate }) => {
  /*
   * Khoá cuộn nền khi cửa sổ mở, nếu không thì lăn chuột trên lớp phủ sẽ cuộn
   * trang phía sau và lúc đóng lại người xem thấy mình ở một chỗ khác.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') onNavigate(1);
      else if (event.key === 'ArrowLeft') onNavigate(-1);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNavigate]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot for ${step.tag.toLowerCase()} — ${step.title}`}
      /* Bấm ra ngoài để đóng. Ảnh và các nút gọi stopPropagation nên bấm trúng
         chúng không bị tính là bấm nền. */
      onClick={onClose}
      className="lp-lightbox fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close enlarged image"
        className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-5 sm:top-5"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {hasSiblings && (
        <>
          {[-1, 1].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onNavigate(delta);
              }}
              aria-label={delta < 0 ? 'Previous step' : 'Next step'}
              className={`absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:h-12 sm:w-12 ${
                delta < 0 ? 'left-2 sm:left-5' : 'right-2 sm:right-5'
              }`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d={delta < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
              </svg>
            </button>
          ))}
        </>
      )}

      <figure
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full max-w-5xl flex-col items-center gap-3"
      >
        <img
          src={step.image}
          alt={step.imageAlt}
          className="max-h-[76vh] w-auto max-w-full rounded-xl object-contain shadow-2xl shadow-black/50"
        />
        <figcaption className="text-center">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-500">{step.tag}</span>
          <p className="mt-1 text-sm font-semibold text-white sm:text-base">{step.title}</p>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
};

/**
 * Quy trình 4 bước, kèm khung ảnh minh hoạ ở cột phải.
 *
 * Bấm vào một bước thì khung bên phải mờ chuyển sang ảnh của bước đó. Các ảnh
 * đều nằm sẵn trong DOM và chỉ đổi opacity — cách này cho hai ảnh chồng lên nhau
 * trong lúc chuyển nên không có nháy trắng ở giữa, và cũng không phải đo đạc
 * kích thước bằng JS.
 *
 * Dùng bộ vai trò tab/tabpanel thay vì danh sách thường: về mặt tương tác đây
 * đúng là các thẻ tab, nên trình đọc màn hình cần biết bấm vào một mục sẽ đổi
 * nội dung ở nơi khác. Mũi tên lên/xuống chuyển bước như thói quen của tab dọc.
 *
 * Trên điện thoại cột phải xuống dưới cột trái; nét kẻ nối các bước bị ẩn cho gọn.
 */
export const HowItWorks: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);

  /*
   * Cửa sổ phóng to đọc thẳng `activeIndex` chứ không giữ chỉ số riêng: chuyển
   * bước trong cửa sổ vì thế kéo theo cả bước đang chọn ở dưới, đóng cửa sổ ra
   * là thấy đúng bước vừa xem chứ không nhảy về chỗ cũ.
   */
  const navigateZoom = useCallback((delta: number) => {
    setActiveIndex((current) => (current + delta + STEPS.length) % STEPS.length);
  }, []);

  const closeZoom = useCallback(() => setIsZoomed(false), []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;

    event.preventDefault();
    const next = (activeIndex + step + STEPS.length) % STEPS.length;
    setActiveIndex(next);
    document.getElementById(`how-it-works-tab-${next}`)?.focus();
  };

  return (
    <section id="how-it-works" className="scroll-mt-20 py-14 sm:py-20 lg:py-28">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              Four steps, from reference to <br></br>
              <span className="lp-gradient-text">a post-ready image</span>
            </>
          }
          description="No confusing dashboard, no technical jargon. Anyone selling online gets it right on the first try."
        />

        <div className="mt-10 grid sm:mt-14 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-12">
          {/* Cột trái: danh sách bước bấm được */}
          <div className="relative">
            {/* Nét kẻ nối các bước, tự vẽ từ trên xuống khi cuộn tới */}
            <Reveal
              anim="fade"
              className="pointer-events-none absolute left-[1.4rem] top-6 hidden h-[calc(100%-3rem)] w-px sm:block"
            >
              <span
                className="lp-line block h-full w-px bg-gradient-to-b from-brand-500 via-brand-500/40 to-transparent"
                aria-hidden
              />
            </Reveal>

            <div
              role="tablist"
              aria-orientation="vertical"
              aria-label="Steps in the workflow"
              onKeyDown={onKeyDown}
              className="space-y-3"
            >
              {STEPS.map((step, index) => {
                const isActive = index === activeIndex;

                return (
                  <Reveal key={step.tag} delay={index * 100} className="relative flex gap-5">
                    <span
                      className={`relative z-10 hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-all duration-300 sm:flex ${
                        isActive
                          ? 'border-brand-500 bg-brand-500 text-white shadow-lg shadow-brand-500/30'
                          : 'border-brand-500/30 bg-dark-900 text-brand-500'
                      }`}
                      aria-hidden
                    >
                      {index + 1}
                    </span>

                    <button
                      id={`how-it-works-tab-${index}`}
                      role="tab"
                      type="button"
                      aria-selected={isActive}
                      aria-controls={`how-it-works-panel-${index}`}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => setActiveIndex(index)}
                      className={`flex-1 rounded-2xl border p-4 text-left transition-all duration-300 sm:p-5 ${
                        isActive
                          ? 'border-brand-500/40 bg-dark-900 shadow-xl shadow-black/10'
                          : 'border-dark-800 bg-dark-900/60 hover:border-dark-700 hover:bg-dark-900'
                      }`}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-500">{step.tag}</span>
                      <h3 className="mt-1.5 text-lg font-bold text-gray-100">{step.title}</h3>

                      {/*
                        Phần mô tả chỉ mở ở bước đang chọn: bốn đoạn chữ mở sẵn
                        cùng lúc thì cột trái dài gấp đôi khung ảnh bên phải và
                        người đọc không biết nên nhìn đâu.
                      */}
                      <div
                        className={`grid transition-all duration-300 ease-out ${
                          isActive ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <p className="pt-2 text-sm leading-relaxed text-gray-400">{step.body}</p>
                        </div>
                      </div>
                    </button>
                  </Reveal>
                );
              })}
            </div>
          </div>

          {/* Cột phải: khung ảnh minh hoạ, dính lại khi cuộn trên màn hình rộng */}
          <Reveal anim="zoom" delay={120} className="lg:sticky lg:top-24">
            <div className="rounded-3xl border border-dark-800 bg-dark-900 p-3 shadow-2xl shadow-black/10">
              {/* Thanh giả lập cửa sổ trình duyệt cho khung ảnh trông có bối cảnh */}
              <div className="flex items-center gap-1.5 px-2 pb-3 pt-1">
                <span className="h-2.5 w-2.5 rounded-full bg-dark-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-dark-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-dark-700" />
                <span className="ml-3 truncate text-[11px] text-gray-600">
                  designcopycat.ai — {STEPS[activeIndex].tag.toLowerCase()}
                </span>
              </div>

              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-dark-850">
                {STEPS.map((step, index) => {
                  const isActive = index === activeIndex;

                  return (
                    <div
                      key={step.tag}
                      id={`how-it-works-panel-${index}`}
                      role="tabpanel"
                      aria-labelledby={`how-it-works-tab-${index}`}
                      /* Ẩn khỏi cây trợ năng khi không hiện, nếu không trình đọc
                         màn hình sẽ đọc cả bốn ảnh chồng lên nhau. */
                      aria-hidden={!isActive}
                      className={`absolute inset-0 transition-all duration-500 ease-out ${
                        isActive
                          ? 'z-10 scale-100 opacity-100'
                          : 'pointer-events-none z-0 scale-[1.04] opacity-0'
                      }`}
                    >
                      {step.image ? (
                        /*
                          Cả khung ảnh là một nút bấm để phóng to. Dùng <button>
                          chứ không phải onClick trên <img>: bàn phím tab tới
                          được, Enter/Space chạy đúng, và trình đọc màn hình đọc
                          ra đây là thao tác mở ảnh chứ không phải ảnh trang trí.
                        */
                        <button
                          type="button"
                          onClick={() => setIsZoomed(true)}
                          aria-label={`Enlarge the ${step.tag.toLowerCase()} screenshot: ${step.imageAlt}`}
                          className="group/zoom relative block h-full w-full cursor-zoom-in overflow-hidden outline-none"
                        >
                          <img
                            src={step.image}
                            alt={step.imageAlt}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-500 group-hover/zoom:scale-[1.03]"
                          />

                          {/* Gợi ý bấm được: hiện khi rê chuột, và luôn hiện khi
                              focus bằng bàn phím. */}
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover/zoom:opacity-100 group-focus-visible/zoom:opacity-100">
                            <span className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-dark-900 shadow-lg">
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.2}
                                aria-hidden
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M21 21l-4.35-4.35M11 8v6m-3-3h6m5 0a8 8 0 11-16 0 8 8 0 0116 0z"
                                />
                              </svg>
                              Bấm để xem ảnh lớn
                            </span>
                          </span>
                        </button>
                      ) : (
                        <ImagePlaceholder index={index} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Thanh chuyển bước dưới ảnh: vạch dài là bước đang xem */}
              <div className="flex items-center justify-between gap-4 px-2 pb-1 pt-3">
                <p className="truncate text-xs text-gray-500">{STEPS[activeIndex].title}</p>

                <div className="flex shrink-0 items-center gap-1.5">
                  {STEPS.map((step, index) => (
                    <button
                      key={step.tag}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-label={`View ${step.tag.toLowerCase()}`}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        index === activeIndex ? 'w-6 bg-brand-500' : 'w-1.5 bg-dark-700 hover:bg-dark-600'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      {isZoomed && (
        <ImageLightbox
          step={STEPS[activeIndex]}
          hasSiblings={STEPS.length > 1}
          onClose={closeZoom}
          onNavigate={navigateZoom}
        />
      )}
    </section>
  );
};
