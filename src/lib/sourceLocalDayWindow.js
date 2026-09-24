import { exactRevenueWindow, unknownRevenueWindow } from './revenueMeasurementWindow.js';

// Source APIs report inclusive calendar dates in their own account/property
// timezone. A date label is not a UTC instant until that timezone is proven.
function localMidnight(dateString, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString ?? '') || !timeZone) return null;
  const day = new Date(`${dateString}T00:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== dateString) return null;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { return null; }
  let instant = day.getTime();
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = shown - day.getTime();
    if (delta === 0) return new Date(instant);
    instant -= delta;
  }
  return null;
}

export function sourceLocalDayWindow(startDate, endDate, timeZone) {
  const start = localMidnight(startDate, timeZone);
  const lastDay = new Date(`${endDate}T00:00:00.000Z`);
  if (!start || !Number.isFinite(lastDay.getTime()) || lastDay.toISOString().slice(0, 10) !== endDate) {
    return unknownRevenueWindow();
  }
  const nextDay = new Date(lastDay.getTime() + 86_400_000).toISOString().slice(0, 10);
  const nextMidnight = localMidnight(nextDay, timeZone);
  return nextMidnight && nextMidnight > start
    ? exactRevenueWindow(start, new Date(nextMidnight.getTime() - 1))
    : unknownRevenueWindow();
}
