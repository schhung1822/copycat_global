import React from 'react';

/** Ô nội dung nền tối, dùng lại ở hầu hết các trang. */
export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-dark-900 border border-dark-800 rounded-2xl ${className}`}>{children}</div>
);

export const Spinner: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <span className={`inline-block border-2 border-current border-t-transparent rounded-full animate-spin ${className}`} />
);

export const PageLoader: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex flex-col items-center justify-center py-24 text-gray-500 gap-3">
    <Spinner className="h-8 w-8 text-brand-500" />
    <span className="text-sm">{label}</span>
  </div>
);

export const Alert: React.FC<{ tone?: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => {
  const tones = {
    error: 'bg-red-500/10 border-red-500/30 text-red-300',
    success: 'bg-green-500/10 border-green-500/30 text-green-300',
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  };
  return <div className={`border rounded-xl px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
};

export const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-gray-500">{hint}</span>}
  </label>
);

export const inputClass =
  'w-full bg-dark-850 border border-dark-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 ' +
  'placeholder-gray-600 focus:border-brand-500 outline-none transition-colors disabled:opacity-50';

export const selectClass =
  'w-full bg-dark-850 border border-dark-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 ' +
  'focus:border-brand-500 outline-none transition-colors appearance-none cursor-pointer';

/** Ô chỉ số cho bảng điều khiển admin. */
export const StatCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}> = ({ label, value, sub, tone = 'default' }) => {
  const tones = {
    default: 'text-gray-100',
    positive: 'text-green-400',
    negative: 'text-red-400',
    warning: 'text-amber-400',
  };
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">{label}</p>
      <p className={`text-2xl font-bold mt-1.5 ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-1">{sub}</p>}
    </Card>
  );
};

export const Badge: React.FC<{ status: string; children: React.ReactNode }> = ({ status, children }) => {
  const map: Record<string, string> = {
    success: 'bg-green-900/30 text-green-400 border-green-900/60',
    paid: 'bg-green-900/30 text-green-400 border-green-900/60',
    active: 'bg-green-900/30 text-green-400 border-green-900/60',
    matched: 'bg-green-900/30 text-green-400 border-green-900/60',
    queued: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/60',
    processing: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/60',
    pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/60',
    unmatched: 'bg-yellow-900/30 text-yellow-400 border-yellow-900/60',
    failed: 'bg-red-900/30 text-red-400 border-red-900/60',
    refunded: 'bg-orange-900/30 text-orange-400 border-orange-900/60',
    banned: 'bg-red-900/30 text-red-400 border-red-900/60',
    error: 'bg-red-900/30 text-red-400 border-red-900/60',
  };
  return (
    <span
      className={`text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
        map[status] ?? 'bg-dark-800 text-gray-400 border-dark-700'
      }`}
    >
      {children}
    </span>
  );
};

/** Bảng có thể cuộn ngang trên màn hình hẹp. */
export const TableWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto custom-scrollbar">
    <table className="w-full text-sm min-w-[640px]">{children}</table>
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="text-center py-16 text-gray-600">
    <p className="text-base font-medium">{title}</p>
    {hint && <p className="text-sm mt-1 text-gray-700">{hint}</p>}
  </div>
);
