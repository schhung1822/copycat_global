import React, { useEffect, useState } from 'react';
import { Alert, Badge, Card, EmptyState, PageLoader, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDateTime, STATUS_LABEL } from '../lib/format';
import type { Generation } from '../types';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'success', label: 'Done' },
  { value: 'processing', label: 'Generating' },
  { value: 'refunded', label: 'Failed' },
];

const PAGE_SIZE = 24;

export const HistoryPage: React.FC = () => {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void api
      .get<{ generations: Generation[]; total: number }>(`/generations${qs({ status, page, limit: PAGE_SIZE })}`)
      .then((data) => {
        if (cancelled) return;
        setGenerations(data.generations);
        setTotal(data.total);
      })
      .finally(() => !cancelled && setIsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [status, page]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  /**
   * Xoá một ảnh khỏi lịch sử.
   *
   * Bỏ ảnh khỏi lưới ngay thay vì tải lại cả trang: xoá là thao tác lẻ, nháy một
   * cái loading cho mỗi lần bấm thì rất khó chịu. Trang có thể còn 23 ảnh cho tới
   * lần chuyển trang sau — chấp nhận được, đổi lại thao tác mượt.
   *
   * Xoá hết ảnh của trang đang xem thì lùi về trang trước, nếu không khách nhìn
   * thấy một trang trống trong khi vẫn còn ảnh ở các trang trước đó.
   */
  const handleDelete = async (item: Generation) => {
    if (!confirm('Remove this image from your history? The credits it cost will not be refunded.')) return;

    setDeletingId(item.id);
    setError(null);
    try {
      await api.del(`/generations/${item.id}`);
      const remaining = generations.filter((row) => row.id !== item.id);
      setGenerations(remaining);
      setTotal((current) => Math.max(current - 1, 0));
      if (remaining.length === 0 && page > 1) setPage(page - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this image.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Your designs</h1>
          <p className="text-sm text-gray-500 mt-1">{total} images generated</p>
        </div>

        <div className="flex gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => {
                setStatus(filter.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                status === filter.value ? 'bg-brand-500 text-white' : 'bg-dark-850 text-gray-400 hover:bg-dark-800'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {isLoading ? (
        <PageLoader />
      ) : generations.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No images yet." hint="Head to the Studio to create your first design." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {generations.map((item) => (
            <Card key={item.id} className="group overflow-hidden flex flex-col">
              <div className="aspect-[3/4] bg-dark-850 relative">
                {item.imageUrl && item.status === 'success' ? (
                  <img
                    src={item.imageUrl}
                    alt="Generated design"
                    className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => setPreviewUrl(item.imageUrl)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-3 text-center">
                    <span className="text-[11px] text-gray-600 line-clamp-4">
                      {item.errorMessage ?? STATUS_LABEL[item.status]}
                    </span>
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <Badge status={item.status}>{STATUS_LABEL[item.status]}</Badge>
                </div>

                {/*
                  Ảnh đang vẽ thì máy chủ từ chối xoá (kết quả vẫn sắp ghi vào
                  dòng đó), nên ẩn luôn nút cho khỏi bấm rồi ăn báo lỗi.

                  Nút luôn hiện trên màn cảm ứng — `opacity-100 md:opacity-0`:
                  điện thoại không có trạng thái hover nên nút ẩn theo hover là
                  nút không bao giờ bấm được.
                */}
                {item.status !== 'queued' && item.status !== 'processing' && (
                  <button
                    onClick={() => void handleDelete(item)}
                    disabled={deletingId === item.id}
                    title="Remove from history"
                    aria-label="Remove from history"
                    className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 text-gray-300 backdrop-blur-sm
                               opacity-100 md:opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                               hover:bg-red-600 hover:text-white disabled:opacity-40 transition-all"
                  >
                    {deletingId === item.id ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>
              <div className="p-2.5 border-t border-dark-800">
                <p className="text-[11px] text-gray-400 truncate" title={item.modelLabel}>
                  {item.modelLabel}
                </p>
                <p className="text-[10px] text-gray-600 mt-0.5">
                  {formatDateTime(item.createdAt)} · {item.tokenCost} credits
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-dark-850 text-gray-300 text-sm disabled:opacity-30 hover:bg-dark-800 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-dark-850 text-gray-300 text-sm disabled:opacity-30 hover:bg-dark-800 transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img src={previewUrl} alt="Full size preview" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
};
