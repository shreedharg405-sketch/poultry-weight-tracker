export interface DownloadResult {
  success: boolean;
  method: 'share' | 'download' | 'aborted' | 'error';
  error?: any;
}

/**
 * Mobile-compatible file saver utility:
 * 1. Checks for native Web Share API (Save to Files, WhatsApp, Drive, Gmail on Android/iOS)
 * 2. Fallbacks to direct HTML5 Blob download targeting native Downloads folder
 */
export async function downloadExcelFile(
  workbookData: ArrayBuffer | Blob,
  fileName: string
): Promise<DownloadResult> {
  const mimeType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob =
    workbookData instanceof Blob
      ? workbookData
      : new Blob([workbookData], { type: mimeType });

  const file = new File([blob], fileName, { type: mimeType });

  // 1. Try Mobile Web Share API first (Ideal for mobile Safari & Android Chrome)
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: fileName,
        text: 'Poultry Bodyweight Recording Excel Sheet',
      });
      return { success: true, method: 'share' };
    } catch (error: any) {
      // If user dismissed share dialog, don't force a fallback download
      if (error.name === 'AbortError') {
        return { success: false, method: 'aborted' };
      }
      console.warn('Share API failed, falling back to direct download:', error);
    }
  }

  // 2. Direct Blob URL Download (Forces file into Android / iOS Downloads directory)
  try {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    anchor.href = url;
    anchor.download = fileName;

    document.body.appendChild(anchor);
    anchor.click();

    // Clean up
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      if (document.body.contains(anchor)) {
        document.body.removeChild(anchor);
      }
    }, 2500);

    return { success: true, method: 'download' };
  } catch (error) {
    console.error('Download execution failed:', error);
    return { success: false, method: 'error', error };
  }
}
