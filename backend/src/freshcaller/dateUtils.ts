/** Asia/Kolkata calendar helpers for Freshcaller daily sync windows. */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as YYYY-MM-DD in Asia/Kolkata. */
export function toIstCallDate(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/** Previous calendar day in IST as YYYY-MM-DD. */
export function previousIstCallDate(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/**
 * Inclusive IST day window as ISO strings for Freshcaller export API.
 * start = callDate 00:00:00 IST, end = callDate 23:59:59 IST
 */
export function istDayRangeIso(callDate: string): { startDate: string; endDate: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
    throw new Error(`Invalid callDate: ${callDate}`);
  }
  const startDate = `${callDate}T00:00:00+05:30`;
  const endDate = `${callDate}T23:59:59+05:30`;
  return { startDate, endDate };
}

/** Next daily cron fire time (default 01:00 Asia/Kolkata) as an ISO string. */
export function nextDailyRunIso(
  hour = 1,
  minute = 0,
  now = new Date(),
): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const todayRunUtc = Date.UTC(y, m, d, hour, minute, 0) - IST_OFFSET_MS;
  const target =
    now.getTime() < todayRunUtc ? todayRunUtc : Date.UTC(y, m, d + 1, hour, minute, 0) - IST_OFFSET_MS;
  return new Date(target).toISOString();
}

export function callDateFromCreatedTime(createdTime?: string | null): string | null {
  if (!createdTime) return null;
  const d = new Date(createdTime);
  if (Number.isNaN(d.getTime())) return null;
  return toIstCallDate(d);
}
