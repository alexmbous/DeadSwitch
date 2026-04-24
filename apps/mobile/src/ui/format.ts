export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function relativeFromNow(iso?: string): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const delta = Math.round((then - now) / 1000);
  const abs = Math.abs(delta);
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  let s: string;
  if (abs < 60) s = unit(abs, 'second');
  else if (abs < 3600) s = unit(Math.round(abs / 60), 'minute');
  else if (abs < 86400) s = unit(Math.round(abs / 3600), 'hour');
  else s = unit(Math.round(abs / 86400), 'day');
  return delta >= 0 ? `in ${s}` : `${s} ago`;
}
