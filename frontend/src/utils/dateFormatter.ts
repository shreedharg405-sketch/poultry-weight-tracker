/**
 * Reusable Date and Time formatting utility for Indian Standard Time (Asia/Kolkata)
 *
 * Requirements:
 * - Display date as '14 Oct 2026'
 * - Display time as '10:07 PM' (when converted to Asia/Kolkata)
 * - Combined format: '14 Oct 2026, 10:07 PM'
 * - Use 'Asia/Kolkata' timezone for all user-facing submission timestamps
 * - Safely handle null, undefined, invalid timestamps
 * - Preserves original stored timestamps and UTC database values
 */

const TIMEZONE = 'Asia/Kolkata';

export function parseDateSafe(input: string | number | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }

  const str = String(input).trim();
  if (!str) return null;

  // Handle custom legacy formatted strings like 'Date(12-10-2026) - Time(11:30 AM)'
  if (str.startsWith('Date(')) {
    const dMatch = str.match(/Date\((\d{1,2})-(\d{1,2})-(\d{4})\)/i);
    const tMatch = str.match(/Time\((\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\)/i);
    if (dMatch) {
      const day = parseInt(dMatch[1], 10);
      const month = parseInt(dMatch[2], 10) - 1;
      const year = parseInt(dMatch[3], 10);
      let hours = 0;
      let minutes = 0;
      if (tMatch) {
        hours = parseInt(tMatch[1], 10);
        minutes = parseInt(tMatch[2], 10);
        const ampm = tMatch[3]?.toUpperCase();
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
      }
      const parsed = new Date(year, month, day, hours, minutes);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format date as '14 Oct 2026' in Indian Standard Time (Asia/Kolkata)
 */
export function formatDateIST(input: string | number | Date | null | undefined): string {
  const d = parseDateSafe(input);
  if (!d) return '--';

  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TIMEZONE,
  });
}

/**
 * Format time as '10:07 PM' in Indian Standard Time (Asia/Kolkata)
 */
export function formatTimeIST(input: string | number | Date | null | undefined): string {
  const d = parseDateSafe(input);
  if (!d) return '--';

  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIMEZONE,
  });
  return timeStr.toUpperCase();
}

/**
 * Format combined timestamp as '14 Oct 2026, 10:07 PM' in Indian Standard Time (Asia/Kolkata)
 */
export function formatDateTimeIST(input: string | number | Date | null | undefined): string {
  const d = parseDateSafe(input);
  if (!d) return 'Not yet submitted';

  const datePart = formatDateIST(d);
  const timePart = formatTimeIST(d);
  return `${datePart}, ${timePart}`;
}

export default {
  parseDateSafe,
  formatDateIST,
  formatTimeIST,
  formatDateTimeIST,
};
