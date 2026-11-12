import type { SportType } from '../types/fitness';

export function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '0m';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatDurationHMS(seconds: number | undefined | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSleep(seconds: number | undefined | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatDistanceKm(meters: number | undefined | null): string {
  if (meters == null || !Number.isFinite(meters)) return '0.00 km';
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatSpeedKmh(mps: number | undefined | null): string {
  if (!mps || !Number.isFinite(mps)) return '0.0 km/h';
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function formatPaceMinKm(mps: number | undefined | null): string {
  if (!mps || !Number.isFinite(mps) || mps <= 0.1) return '—';
  const secPerKm = 1000 / mps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  if (sec === 60) return `${min + 1}:00 /km`;
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

export function formatSwimPace(mps: number | undefined | null): string {
  if (!mps || !Number.isFinite(mps) || mps <= 0.1) return '—';
  const secPer100 = 100 / mps;
  const min = Math.floor(secPer100 / 60);
  const sec = Math.round(secPer100 % 60);
  if (sec === 60) return `${min + 1}:00 /100m`;
  return `${min}:${String(sec).padStart(2, '0')} /100m`;
}

export function isRunningLike(sport: SportType): boolean {
  return sport === 'running' || sport === 'trail_running' || sport === 'walking';
}

export function formatPrimarySpeedOrPace(mps: number | undefined | null, sport: SportType): string {
  if (sport === 'swimming') return formatSwimPace(mps);
  return isRunningLike(sport) ? formatPaceMinKm(mps) : formatSpeedKmh(mps);
}

export function formatDateShort(isoOrDate: string): string {
  const normalized = isoOrDate.includes(' ') ? isoOrDate.replace(' ', 'T') : isoOrDate;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  return d.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateTime(isoOrDate: string): string {
  const normalized = isoOrDate.includes(' ') ? isoOrDate.replace(' ', 'T') : isoOrDate;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return isoOrDate;
  return d.toLocaleString('it-IT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sportLabel(sport: SportType): string {
  switch (sport) {
    case 'cycling':
      return 'Ciclismo';
    case 'running':
      return 'Corsa';
    case 'trail_running':
      return 'Trail Running';
    case 'walking':
      return 'Camminata';
    case 'strength':
      return 'Forza';
    case 'swimming':
      return 'Nuoto';
    default:
      return 'Attività';
  }
}

export function sportAccent(sport: SportType): {
  bg: string;
  text: string;
  border: string;
  hex: string;
} {
  switch (sport) {
    case 'cycling':
      return {
        bg: 'bg-sky-500/15',
        text: 'text-sky-400',
        border: 'border-sky-500/30',
        hex: '#38bdf8',
      };
    case 'running':
    case 'trail_running':
      return {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
        hex: '#10b981',
      };
    case 'strength':
      return {
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        border: 'border-amber-500/30',
        hex: '#f59e0b',
      };
    case 'swimming':
      return {
        bg: 'bg-cyan-500/15',
        text: 'text-cyan-400',
        border: 'border-cyan-500/30',
        hex: '#06b6d4',
      };
    default:
      return {
        bg: 'bg-indigo-500/15',
        text: 'text-indigo-400',
        border: 'border-indigo-500/30',
        hex: '#818cf8',
      };
  }
}
