import React, { useState } from 'react';
import { inputClass } from './ui';

/**
 * Ô nhập mật khẩu kèm nút hiện/ẩn.
 *
 * Nhận mọi thuộc tính của <input> trừ `type` (do component tự điều khiển), nên
 * dùng thay thế trực tiếp cho <input type="password"> ở bất kỳ form nào.
 */
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordInput: React.FC<PasswordInputProps> = ({ className = '', ...props }) => {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Hide password' : 'Show password';

  return (
    <div className="relative">
      {/* pr-11 chừa chỗ cho nút, tránh chữ chạy xuống dưới biểu tượng con mắt */}
      <input {...props} type={visible ? 'text' : 'password'} className={`${inputClass} pr-11 ${className}`} />

      <button
        // type="button" là bắt buộc: nút mặc định trong form sẽ gửi form khi bấm.
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-0 top-0 h-full px-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
        title={label}
        aria-label={label}
        aria-pressed={visible}
      >
        {visible ? (
          // Mắt gạch chéo — đang hiện, bấm để ẩn đi
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18"
            />
          </svg>
        ) : (
          // Mắt thường — đang ẩn, bấm để hiện
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
        )}
      </button>
    </div>
  );
};
