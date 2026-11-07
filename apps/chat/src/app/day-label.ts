const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Local time, deliberately -- never the UTC the timestamp is stored in. */
export function localTime(ts: number): string {
  const d = new Date(ts);
  const hour = d.getHours() % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hour}:${minutes} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** The local calendar day a timestamp falls on, as a comparable key. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ts: number, now = Date.now()): string {
  const key = dayKey(ts);
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(now - 86_400_000)) return 'Yesterday';
  const d = new Date(ts);
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear()
    ? base
    : `${base} ${d.getFullYear()}`;
}

/** The clock today, the day otherwise, as Slack's list reads. */
export function whenLabel(ts: number, now = Date.now()): string {
  return dayKey(ts) === dayKey(now) ? localTime(ts) : dayLabel(ts, now);
}
