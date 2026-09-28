/**
 * Compresses an image file by resizing and reducing quality.
 * Includes a timeout safeguard for iOS WKWebView where the Image
 * element can silently hang without firing onload/onerror.
 */

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 1280;
const QUALITY = 0.75;
const COMPRESSION_TIMEOUT_MS = 8000; // 8 seconds max for compression

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

function passthrough(file: File): CompressionResult {
  return {
    file,
    originalSize: file.size,
    compressedSize: file.size,
    compressionRatio: 1,
  };
}

export async function compressImage(file: File): Promise<CompressionResult> {
  // Skip compression for non-image files
  if (!file.type.startsWith('image/')) {
    return passthrough(file);
  }

  // Skip compression for GIFs to preserve animation
  if (file.type === 'image/gif') {
    return passthrough(file);
  }

  // Skip compression for HEIC/HEIF — canvas can't render these in WKWebView
  const lowerType = file.type.toLowerCase();
  if (lowerType.includes('heic') || lowerType.includes('heif')) {
    return passthrough(file);
  }

  // Race the compression against a timeout so we never hang indefinitely
  const compressionPromise = compressImageCore(file);
  const timeoutPromise = new Promise<CompressionResult>((resolve) => {
    setTimeout(() => {
      console.warn('[compressImage] Timed out after', COMPRESSION_TIMEOUT_MS, 'ms — using original');
      resolve(passthrough(file));
    }, COMPRESSION_TIMEOUT_MS);
  });

  return Promise.race([compressionPromise, timeoutPromise]);
}

function compressImageCore(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      // Revoke AFTER we've finished using the image data (not before drawImage)
      let { width, height } = img;

      // Calculate new dimensions while maintaining aspect ratio
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(passthrough(file));
        return;
      }

      // Draw image with white background for transparency
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      try {
        ctx.drawImage(img, 0, 0, width, height);
      } catch (drawError) {
        console.warn('[compressImage] drawImage failed:', drawError);
        URL.revokeObjectURL(objectUrl);
        resolve(passthrough(file));
        return;
      }

      // Now safe to revoke — drawImage has consumed the pixel data
      URL.revokeObjectURL(objectUrl);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= originalSize) {
            resolve(passthrough(file));
            return;
          }

          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve({
            file: compressedFile,
            originalSize,
            compressedSize: blob.size,
            compressionRatio: originalSize / blob.size,
          });
        },
        'image/jpeg',
        QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(passthrough(file));
    };

    img.src = objectUrl;
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
