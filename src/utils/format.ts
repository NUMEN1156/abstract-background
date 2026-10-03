export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)} %`
}

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
}

export function formatClock(iso: string | number | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('de-DE', { hour12: false })
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}

export const STATE_LABEL: Record<string, string> = {
  idle: 'bereit',
  queued: 'in Warteschlange',
  connecting: 'verbindet',
  streaming: 'streamt',
  complete: 'abgeschlossen',
  error: 'gestört',
}

export function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value
}