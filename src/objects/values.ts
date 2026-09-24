import type { PropertyKind } from './model.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}
export function validDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.endsWith('-00:00')) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  return !!match && validDate(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59 &&
    (match[5] === 'Z' || (Number(match[7]) <= 14 && Number(match[8]) <= 59 && (Number(match[7]) < 14 || Number(match[8]) === 0))) && Number.isFinite(Date.parse(value));
}
function zoned(value: string, timeZone: string): boolean {
  if (timeZone !== 'UTC' && !timeZone.includes('/')) return false;
  try {
    const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(value)).find(p => p.type === 'timeZoneName')?.value;
    return (offset === 'GMT' ? '+00:00' : offset?.slice(3)) === (value.endsWith('Z') ? '+00:00' : value.slice(-6));
  } catch { return false; }
}
/** Returns a diagnostic explanation, not a coerced or repaired value. */
export function valueError(kind: Exclude<PropertyKind, 'select' | 'reference'>, value: unknown): string | undefined {
  switch (kind) {
    case 'text': return typeof value === 'string' ? undefined : 'Expected text.';
    case 'number': return typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? undefined : 'Expected a finite number; integers must be in the safe JavaScript range.';
    case 'boolean': return typeof value === 'boolean' ? undefined : 'Expected true or false, not a string.';
    case 'date': return validDate(value) ? undefined : 'Expected a real calendar date in YYYY-MM-DD format.';
    case 'datetime': return validDateTime(value) ? undefined : 'Expected an ISO date-time with seconds and an explicit Z or ±HH:MM offset.';
    case 'date-range':
      return isObject(value) && Object.keys(value).length === 2 && validDate(value.start) && validDate(value.end) && value.start < value.end ? undefined : 'Expected {start, end} calendar dates, with end strictly after start (exclusive).';
    case 'time-range':
      return isObject(value) && Object.keys(value).length === 3 && validDateTime(value.start) && validDateTime(value.end) &&
        typeof value.timeZone === 'string' && Date.parse(value.start) < Date.parse(value.end) && zoned(value.start, value.timeZone) && zoned(value.end, value.timeZone)
        ? undefined : 'Expected {start, end, timeZone}: ordered date-times whose offsets match the IANA zone at both instants.';
    default: return 'Unsupported property kind.';
  }
}
