/**
 * pg returns DATE columns as JS Dates at local midnight; `String(date)` yields
 * locale weekday text ("Sat Aug 08") and `toISOString()` shifts the calendar
 * day across timezones. DATE has no time component, so project using the
 * LOCAL calendar fields. (For instants, use toISOString at the call site.)
 */
export function toDateOnly(value: Date | string): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return value.slice(0, 10);
}
