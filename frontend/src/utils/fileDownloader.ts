import FileSaver from 'file-saver';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

interface NativeDownloaderPlugin {
  saveToDownloads(options: {
    fileName: string;
    base64Data: string;
    mimeType?: string;
    openImmediately?: boolean;
    shareImmediately?: boolean;
  }): Promise<{
    success: boolean;
    fileName: string;
    path: string;
    uri: string;
    message: string;
  }>;
}

const NativeDownloader = registerPlugin<NativeDownloaderPlugin>('NativeDownloader');

const saveAs =
  (FileSaver as any)?.saveAs ||
  (FileSaver as any)?.default ||
  (typeof FileSaver === 'function' ? FileSaver : undefined);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to convert Blob to Base64'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(',');
      resolve(commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}


export interface DownloadResult {
  success: boolean;
  method: 'share' | 'download' | 'aborted' | 'error';
  fileName: string;
  error?: any;
}

/**
 * Format current date as DD-MM-YYYY (e.g., 19-10-2026)
 */
export function getFormattedDateDMY(date?: Date): string {
  const d = date || new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Validates whether the given data conforms to an XLSX / OpenXML (PK ZIP) binary container.
 * First 4 bytes must be 0x50 0x4B 0x03 0x04 ('PK\x03\x04').
 */
export function isXlsxBinary(data: unknown): boolean {
  if (!data) return false;
  if (data instanceof Uint8Array) {
    return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength < 4) return false;
    const view = new Uint8Array(data, 0, 4);
    return view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.size >= 4;
  }
  return false;
}

/**
 * Clean and sanitize Excel filenames:
 * - Detects and replaces raw UUIDs/hashes (e.g. "b3606a20-8308-4b56...") with clean names
 * - Strips illegal filesystem characters (\ / : * ? " < > |)
 * - Collapses spaces to underscores
 * - Ensures a clean .xlsx extension
 * - Defaults to Poultry_Flock_Report_DD-MM-YYYY.xlsx
 */
export function sanitizeFileName(name?: string, fallback?: string): string {
  const dateStr = getFormattedDateDMY();
  const defaultFallback = `Poultry_Flock_Report_${dateStr}`;
  const effectiveFallback = (fallback && fallback.trim() && fallback !== 'Poultry_Flock_Report') 
    ? fallback.trim().replace(/\.(xlsx|csv|xls)$/i, '')
    : defaultFallback;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return `${effectiveFallback}.xlsx`;
  }
  let clean = name.trim();

  // Strip leading directory paths if it begins with drive letter or root/relative path
  clean = clean.replace(/^[a-zA-Z]:[\\/][^:*?"<>|]*[\\/]/, '').replace(/^(\/|\\|\.\.?[\\/])[^:*?"<>|]*[\\/]/, '');

  // Strip existing extensions (.csv, .xlsx, .xls) first
  clean = clean.replace(/\.(xlsx|csv|xls)$/i, '');

  // Detect raw UUIDs or technical hash strings like "b3606a20-8308-4b56..." or "shed-3cda2635-13f0-4b57..."
  const isRawUuidOrHash =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/i.test(clean) ||
    /^(shed|farm|flock|user|session|batch|file|doc)[-_][0-9a-zA-Z-_]{4,}/i.test(clean) ||
    /^(no[-_])?[0-9a-zA-Z]{4,}-[0-9a-zA-Z]{4,}(-[0-9a-zA-Z]{4,})?/i.test(clean);

  if (isRawUuidOrHash) {
    clean = effectiveFallback;
  }

  // If filename is generic without date (e.g. 'Poultry_Flock_Report', 'Poultry_Flock', 'Poultry_Farm')
  if (clean === 'Poultry_Flock_Report' || clean === 'Poultry_Flock' || clean === 'Poultry_Farm' || clean === 'report') {
    clean = `Poultry_Flock_Report_${dateStr}`;
  }

  // Remove illegal characters: \ / : * ? " < > | and non-printable characters
  // eslint-disable-next-line no-control-regex
  clean = clean.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/\s+/g, '_');
  clean = clean.replace(/^\.+/, ''); // Remove leading dots

  if (!clean || clean === '_' || clean === '-') {
    clean = effectiveFallback;
  }

  return `${clean}.xlsx`;
}

/**
 * Robust Cross-Platform Excel File Downloader:
 * - Accepts either a backend endpoint URL or direct binary workbook data (ArrayBuffer | Uint8Array | Blob).
 * - Enforces the official openxml MIME type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.
 * - On Laptop / Desktop (Chrome / Edge / Firefox / Safari): Creates an explicit hidden Blob anchor element
 *   with style.display = 'none', sets anchor.download with explicit .xlsx extension, appends to document.body,
 *   clicks the anchor to initiate direct download to local folder, and cleans up after 100ms.
 * - Prevents desktop browsers from saving files as raw blob UUID strings or dropping the .xlsx extension.
 */
export async function downloadExcelFile(
  urlOrData: string | ArrayBuffer | Uint8Array | Blob,
  defaultName = 'Poultry_Flock_Report'
): Promise<DownloadResult> {
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const dateStr = getFormattedDateDMY();
  const defaultFallbackName = `${defaultName || 'Poultry_Flock_Report'}_${dateStr}.xlsx`;
  let cleanFileName = sanitizeFileName(defaultName || defaultFallbackName);

  // 1. Guard against null / undefined
  if (!urlOrData) {
    const err = new Error('No workbook data or URL provided for download.');
    console.error('Download aborted:', err.message);
    return { success: false, method: 'error', fileName: cleanFileName, error: err };
  }

  let excelBlob: Blob;

  // 2. Client-side fetch when URL string is supplied
  if (typeof urlOrData === 'string') {
    const isUrl = (
      urlOrData.startsWith('http://') ||
      urlOrData.startsWith('https://') ||
      urlOrData.startsWith('/') ||
      urlOrData.startsWith('./') ||
      urlOrData.startsWith('../') ||
      urlOrData.startsWith('api/')
    );

    if (!isUrl) {
      // Reject raw UUID string or technical hash payload
      const err = new Error('Received string payload instead of binary XLSX workbook.');
      console.error('Download rejected string payload:', urlOrData);
      return { success: false, method: 'error', fileName: cleanFileName, error: err };
    }

    try {
      const response = await fetch(urlOrData, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${typeof localStorage !== 'undefined' ? (localStorage.getItem('poultry_auth_token') || localStorage.getItem('token') || '') : ''}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to download Excel file');
      }

      const disposition = response.headers.get('Content-Disposition');
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename=["']?([^"';]+)["']?/);
        if (match && match[1]) {
          cleanFileName = sanitizeFileName(match[1]);
        }
      }

      const blob = await response.blob();
      excelBlob = new Blob([blob], { type: mimeType });
    } catch (err: any) {
      console.error('Failed to download Excel file:', err);
      return { success: false, method: 'error', fileName: cleanFileName, error: err };
    }
  } else {
    // 3. Handle Binary Workbook Data (ArrayBuffer, Uint8Array, Blob)
    if (!isXlsxBinary(urlOrData)) {
      const err = new Error('Invalid XLSX workbook binary: Missing PK ZIP magic bytes.');
      console.error('Download rejected non-XLSX payload');
      return { success: false, method: 'error', fileName: cleanFileName, error: err };
    }

    excelBlob =
      urlOrData instanceof Blob
        ? (urlOrData.type === mimeType ? urlOrData : new Blob([urlOrData], { type: mimeType }))
        : new Blob([urlOrData as any], { type: mimeType });
  }

  // 4. Native Android / iOS APK File Saving via NativeDownloader / MediaStore
  if (Capacitor.isNativePlatform()) {
    try {
      const base64Data = await blobToBase64(excelBlob);
      
      // A. Primary Native Method: Save directly into Android's public Downloads directory via NativeDownloader
      try {
        const nativeResult = await NativeDownloader.saveToDownloads({
          fileName: cleanFileName,
          base64Data,
          mimeType,
          openImmediately: false,
          shareImmediately: true, // Also presents immediate share/open options while file is physically saved in Downloads
        });
        if (nativeResult?.success) {
          console.log('✅ [Native Downloader] Successfully saved directly to device Downloads:', nativeResult);
          return { success: true, method: 'download', fileName: cleanFileName };
        }
      } catch (downloaderErr) {
        console.warn('NativeDownloader plugin encountered error, falling back to Filesystem:', downloaderErr);
      }

      // B. Secondary Fallback: Capacitor Filesystem Documents directory
      try {
        const writeResult = await Filesystem.writeFile({
          path: cleanFileName,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true,
        });

        console.log('✅ [Capacitor Native] File saved via Filesystem:', writeResult.uri);

        try {
          await Share.share({
            title: cleanFileName,
            text: `Poultry Flock Pro Report: ${cleanFileName}`,
            url: writeResult.uri,
            dialogTitle: 'Save or Share Excel Report',
          });
          return { success: true, method: 'share', fileName: cleanFileName };
        } catch (shareErr: any) {
          return { success: true, method: 'download', fileName: cleanFileName };
        }
      } catch (nativeErr: any) {
        console.error('❌ [Capacitor Native] Documents directory write error, attempting Cache directory:', nativeErr);
        try {
          const cacheResult = await Filesystem.writeFile({
            path: cleanFileName,
            data: base64Data,
            directory: Directory.Cache,
            recursive: true,
          });
          await Share.share({
            title: cleanFileName,
            text: `Poultry Flock Pro Report: ${cleanFileName}`,
            url: cacheResult.uri,
            dialogTitle: 'Save or Share Excel Report',
          });
          return { success: true, method: 'share', fileName: cleanFileName };
        } catch (cacheErr) {
          console.error('❌ [Capacitor Native] Cache write fallback also failed:', cacheErr);
        }
      }
    } catch (outerErr) {
      console.error('❌ [Capacitor Native] All native save attempts failed:', outerErr);
    }
  }

  // 5. Mobile Web Share API: Only on genuine mobile handhelds when canShare is supported
  const isMobileDevice =
    typeof navigator !== 'undefined' &&
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobileDevice && typeof navigator !== 'undefined' && typeof (navigator as any).canShare === 'function') {
    try {
      const file = new File([excelBlob], cleanFileName, { type: mimeType });
      if ((navigator as any).canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: cleanFileName,
          text: 'Poultry Bodyweight Recording Excel Sheet',
        });
        return { success: true, method: 'share', fileName: cleanFileName };
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { success: false, method: 'aborted', fileName: cleanFileName };
      }
      console.warn('Mobile Share API failed or dismissed, falling back to direct download:', error);
    }
  }

  // 5. Desktop / Laptop Direct Download: Explicit Blob anchor element
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blobUrl = window.URL.createObjectURL(excelBlob);
      const anchor = document.createElement('a');
      anchor.style.display = 'none';
      anchor.href = blobUrl;
      anchor.download = cleanFileName;
      anchor.setAttribute('download', cleanFileName);

      document.body.appendChild(anchor);
      anchor.click();

      setTimeout(() => {
        if (anchor.parentNode) {
          document.body.removeChild(anchor);
        }
        window.URL.revokeObjectURL(blobUrl);
      }, 100);

      return { success: true, method: 'download', fileName: cleanFileName };
    }

    // Fallback if document is undefined
    if (typeof saveAs === 'function') {
      saveAs(excelBlob, cleanFileName);
      return { success: true, method: 'download', fileName: cleanFileName };
    }

    return { success: false, method: 'error', fileName: cleanFileName, error: 'DOM environment not available' };
  } catch (error: any) {
    console.error('Direct download execution failed:', error);
    return { success: false, method: 'error', fileName: cleanFileName, error };
  }
}
