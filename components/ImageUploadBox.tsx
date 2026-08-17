import React, { useRef, useState } from 'react';
import { ImageState } from '../types';
import { filesToImageStates, fileToImageState } from '../utils';

interface ImageUploadBoxProps {
  label: string;
  images: ImageState[];
  onImagesChange: (images: ImageState[]) => void;
  subText?: string;
  allowMultiple?: boolean;
  /** Số ảnh tối đa được dùng — chỉ để hiển thị "n/max", không chặn người dùng chọn thêm */
  max?: number;
}

export const ImageUploadBox: React.FC<ImageUploadBoxProps> = ({
  label,
  images,
  onImagesChange,
  subText,
  allowMultiple = true,
  max,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const processFiles = async (files: FileList | File[]) => {
    if (files.length > 0) {
      try {
        const newImages = await filesToImageStates(files);
        if (allowMultiple) {
          onImagesChange([...images, ...newImages]);
        } else {
          onImagesChange([newImages[0]]);
        }
      } catch (err) {
        console.error("Error reading file", err);
      }
      // Reset input so same file can be selected again if needed
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files);
    }
  };

  const handlePasteButtonClick = async () => {
    // Attempt to focus the container first
    containerRef.current?.focus();

    try {
      const clipboardItems = await navigator.clipboard.read();
      const newImages: ImageState[] = [];
      
      for (const item of clipboardItems) {
        // Find image types in clipboard
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], "pasted-image.png", { type: imageType });
          const imgState = await fileToImageState(file);
          newImages.push(imgState);
        }
      }

      if (newImages.length > 0) {
        if (allowMultiple) {
          onImagesChange([...images, ...newImages]);
        } else {
          onImagesChange([newImages[0]]);
        }
      } else {
        alert("No image found on your clipboard. Try pressing Ctrl+V instead.");
      }
    } catch (err) {
      console.warn("Clipboard API blocked", err);
      alert("Your browser blocked clipboard access. Click the upload area and press Ctrl+V.");
    }
  };

  const handlePasteEvent = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      await processFiles(e.clipboardData.files);
    }
  };

  const removeImage = (index: number) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    onImagesChange(newImages);
  };

  const triggerUpload = () => {
    inputRef.current?.click();
  };

  // Kéo thả và focus bàn phím dùng chung một kiểu nổi bật, cho trạng thái nhất quán.
  const isHighlighted = isDragging || isFocused;
  const overLimit = max !== undefined && images.length > max;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      await processFiles(e.dataTransfer.files);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`flex flex-col gap-2 w-full outline-none transition-all duration-200 rounded-xl ${isFocused ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-900' : ''}`}
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPaste={handlePasteEvent}
    >
      <div className="flex justify-between items-center gap-2">
        <label
          className="flex items-center gap-2 text-sm font-semibold text-gray-200 cursor-pointer select-none min-w-0"
          onClick={() => containerRef.current?.focus()}
        >
          <span className="truncate">{label}</span>
          {/* Chỉ hiện số khi đã có ảnh — "(0)" đỏ chót lúc trống vừa thừa vừa chói */}
          {images.length > 0 && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                overLimit ? 'bg-amber-500/15 text-amber-400' : 'bg-brand-500/10 text-brand-500'
              }`}
            >
              {images.length}
              {max ? `/${max}` : ''}
            </span>
          )}
        </label>

        <button
          onClick={handlePasteButtonClick}
          className="text-[11px] text-gray-500 hover:text-brand-500 px-2 py-1 rounded-lg hover:bg-dark-850 flex items-center gap-1 transition-colors shrink-0"
          title="Paste from clipboard (or press Ctrl+V)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Paste
        </button>
      </div>

      {/* Vùng tải ảnh */}
      {images.length === 0 ? (
        <div
          className={`relative border-2 border-dashed rounded-2xl h-36 flex flex-col items-center justify-center
            transition-colors cursor-pointer overflow-hidden group
            ${
              isHighlighted
                ? 'border-brand-500 bg-brand-500/5'
                : 'border-dark-700 hover:border-dark-600 hover:bg-dark-850'
            }`}
          onClick={triggerUpload}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="text-center px-5 pointer-events-none">
            <div
              className={`w-11 h-11 rounded-xl mx-auto mb-2.5 flex items-center justify-center transition-colors ${
                isHighlighted ? 'bg-brand-500/15 text-brand-500' : 'bg-dark-850 text-gray-500 group-hover:text-brand-500'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>

            {isDragging ? (
              <p className="text-brand-500 font-semibold text-sm">Drop the image here</p>
            ) : (
              <p className="text-gray-300 text-sm">
                Click, drag &amp; drop, or{' '}
                <kbd className="px-1.5 py-0.5 rounded bg-dark-800 border border-dark-700 text-[10px] font-bold text-gray-300 align-middle">
                  Ctrl+V
                </kbd>
              </p>
            )}
            {subText && !isDragging && <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{subText}</p>}
          </div>
        </div>
      ) : (
        <div
          className={`rounded-2xl border p-2.5 transition-colors ${
            isHighlighted ? 'border-brand-500 bg-brand-500/5' : 'border-dark-800 bg-dark-850'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-0.5 custom-scrollbar">
            {images.map((img, idx) => (
              <div
                key={idx}
                className="relative aspect-square group rounded-xl overflow-hidden border border-dark-700 bg-dark-800"
              >
                <img src={img.previewUrl || ''} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />

                {/* Số thứ tự: ảnh mẫu đầu tiên là ảnh AI học bố cục, biết thứ tự là có ích */}
                <span className="absolute bottom-1 left-1 text-[9px] font-bold text-white bg-black/60 rounded px-1.5 py-0.5">
                  {idx + 1}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(idx);
                  }}
                  className="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove this image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}

            <button
              onClick={triggerUpload}
              className="aspect-square border border-dashed border-dark-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-dark-800 hover:border-brand-500 hover:text-brand-500 text-gray-500 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-[10px] mt-1">Add</span>
            </button>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={inputRef}
        onChange={handleFileChange} 
        accept="image/*" 
        multiple={allowMultiple}
        className="hidden" 
      />
    </div>
  );
};
