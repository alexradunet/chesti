import { PERSON_LAST_CONNECTED_PROPERTY_ID, PERSON_RECONNECT_EVERY_PROPERTY_ID, type PropertyValue } from './model.js';
import { validDate } from './values.js';

export function reconnectDate(properties: Record<string, PropertyValue>): string | undefined {
  const last = properties[PERSON_LAST_CONNECTED_PROPERTY_ID];
  const months = properties[PERSON_RECONNECT_EVERY_PROPERTY_ID];
  if (!validDate(last) || typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 120) return undefined;
  const [year, month, day] = last.split('-').map(Number) as [number, number, number];
  const index = year * 12 + month - 1 + months;
  const targetYear = Math.floor(index / 12);
  if (targetYear > 9999) return undefined;
  const targetMonth = index % 12 + 1;
  const end = new Date(0);
  end.setUTCFullYear(targetYear, targetMonth, 0);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, end.getUTCDate())).padStart(2, '0')}`;
}
