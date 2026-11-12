import { useMemo, useState } from 'react';
import {
  Activity,
  Bike,
  Footprints,
  MapPin,
  Search,
  Upload,
  Waves,
} from 'lucide-react';
import type { ActivitySummary, SportType } from '../types/fitness';
import {
  formatDateTime,
  formatDistanceKm,
  formatDuration,
  formatPrimarySpeedOrPace,
  sportLabel,
} from '../utils/formatters';
import { useIsLightTheme } from '../utils/theme';

interface ActivitiesListViewProps {
  activities: ActivitySummary[];
  onSelectActivity: (activity: ActivitySummary) => void;
  onOpenImport: () => void;
}

function getPreviewMetrics(act: ActivitySummary): { label: string; value: string }[] {
  const dur = formatDuration(act.movingDurationSeconds || act.durationSeconds);
  const isIndoorNoDist =
    act.sport === 'strength' || (act.sport === 'other' && act.distanceMeters < 100);

  if (isIndoorNoDist) {
    return [
      { label: 'Tempo', value: dur },
      {
        label: act.avgHr ? 'FC Media' : 'FC Max',
        value: act.avgHr ? `${act.avgHr} bpm` : act.maxHr ? `${act.maxHr} bpm` : '—',
      },
      {
        label: act.calories ? 'Calorie' : 'Carico',
        value: act.calories
          ? `${act.calories} kcal`
          : act.trainingLoad
            ? `${Math.round(act.trainingLoad)}`
            : '—',
      },
    ];
  }

  if (act.sport === 'swimming') {
    return [
      {
        label: 'Distanza',
        value:
          act.distanceMeters < 10000
            ? `${Math.round(act.distanceMeters)} m`
            : formatDistanceKm(act.distanceMeters),
      },
      {
        label: 'Passo',
        value:
          act.avgSpeedMps > 0.1
            ? formatPrimarySpeedOrPace(act.avgSpeedMps, 'swimming')
            : act.avgHr
              ? `${act.avgHr} bpm`
              : '—',
      },
      { label: 'Tempo', value: dur },
    ];
  }

  if (act.sport === 'running' || act.sport === 'trail_running' || act.sport === 'walking') {
    return [
      { label: 'Distanza', value: formatDistanceKm(act.distanceMeters) },
      {
        label: act.sport === 'trail_running' && act.elevationGainMeters >= 150 ? 'Dislivello' : 'Passo',
        value:
          act.sport === 'trail_running' && act.elevationGainMeters >= 150
            ? `${Math.round(act.elevationGainMeters)} m`
            : formatPrimarySpeedOrPace(act.avgSpeedMps, act.sport),
      },
      { label: 'Tempo', value: dur },
    ];
  }

  // Cycling & remaining outdoor sports
  return [
    { label: 'Distanza', value: formatDistanceKm(act.distanceMeters) },
    {
      label:
        act.elevationGainMeters > 0
          ? 'Dislivello'
          : act.avgPower
            ? 'Potenza'
            : 'Vel. Media',
      value:
        act.elevationGainMeters > 0
          ? `${Math.round(act.elevationGainMeters)} m`
          : act.avgPower
            ? `${act.avgPower} W`
            : formatPrimarySpeedOrPace(act.avgSpeedMps, act.sport),
    },
    { label: 'Tempo', value: dur },
  ];
}

function SportGlyph({ sport }: { sport: SportType }) {
  if (sport === 'cycling') return <Bike className="h-3.5 w-3.5 text-[#007CC3]" />;
  if (sport === 'running' || sport === 'trail_running' || sport === 'walking') {
    return <Footprints className="h-3.5 w-3.5 text-[#007CC3]" />;
  }
  if (sport === 'swimming') return <Waves className="h-3.5 w-3.5 text-[#007CC3]" />;
  return <Activity className="h-3.5 w-3.5 text-[#007CC3]" />;
}

export function ActivitiesListView({
  activities,
  onSelectActivity,
  onOpenImport,
}: ActivitiesListViewProps) {
  const [query, setQuery] = useState('');
  const [sportFilter, setSportFilter] = useState<'all' | SportType>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activities.filter((a) => {
      if (sportFilter !== 'all' && a.sport !== sportFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.locationName ?? '').toLowerCase().includes(q) ||
        sportLabel(a.sport).toLowerCase().includes(q)
      );
    });
  }, [activities, query, sportFilter]);

  const availableSports = useMemo(() => {
    const set = new Set<SportType>();
    activities.forEach((a) => set.add(a.sport));
    return Array.from(set);
  }, [activities]);

  return (
    <div className="space-y-3 pb-10">
      {/* Search, Sport Chips & Import */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A5AA]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca attività o località..."
              className="w-full rounded-xl border border-white/[0.08] bg-[#1E1E1E] py-2 pl-9 pr-3 text-sm text-white placeholder:text-[#7A7E85] focus:border-[#007CC3] focus:outline-none"
            />
          </div>

          <button
            onClick={onOpenImport}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-[#1E1E1E] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#2A2A2A]"
          >
            <Upload className="h-3.5 w-3.5 text-[#007CC3]" />
            Importa
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button
            onClick={() => setSportFilter('all')}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              sportFilter === 'all'
                ? 'bg-[#007CC3] text-white'
                : 'bg-[#262626] text-[#D4D6D9] hover:bg-[#323232]'
            }`}
          >
            Tutti ({activities.length})
          </button>
          {availableSports.map((sp) => (
            <button
              key={sp}
              onClick={() => setSportFilter(sp)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                sportFilter === sp
                  ? 'bg-[#007CC3] text-white'
                  : 'bg-[#262626] text-[#D4D6D9] hover:bg-[#323232]'
              }`}
            >
              {sportLabel(sp)}
            </button>
          ))}
        </div>
      </div>

      {/* Strava Feed Stream Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#1E1E1E] p-8 text-center text-sm text-[#A0A5AA]">
          Nessuna attività trovata.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((act) => (
            <button
              key={act.id}
              onClick={() => onSelectActivity(act)}
              className="group -mx-3 flex flex-col border-y border-white/[0.07] bg-[#1E1E1E] p-4 text-left transition hover:bg-[#232323] sm:mx-0 sm:rounded-xl sm:border"
            >
              {/* Activity Title + Date, Time & Location */}
              <div className="min-w-0">
                <div className="truncate text-[17px] font-bold leading-snug text-white group-hover:text-[#007CC3]">
                  {act.name}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#A0A5AA]">
                  <span className="inline-flex items-center gap-1">
                    <SportGlyph sport={act.sport} />
                    <span>{formatDateTime(act.startTime)}</span>
                  </span>
                  {act.locationName && (
                    <span className="inline-flex items-center gap-1 text-[#D4D6D9]">
                      <MapPin className="h-3 w-3 text-[#007CC3]" />
                      <span className="truncate">{act.locationName}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Sport-Specific 3-Column Primary Metrics Row */}
              <div className="mt-3 grid grid-cols-3 gap-3">
                {getPreviewMetrics(act).map((m) => (
                  <div key={m.label}>
                    <div className="text-[11px] font-medium text-[#A0A5AA]">{m.label}</div>
                    <div className="mt-0.5 text-base font-bold tabular-nums text-white sm:text-lg">
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Wide Strava Dark Route Map Preview */}
              {act.previewCoords && act.previewCoords.length >= 2 && (
                <div className="mt-3 overflow-hidden rounded-lg border border-white/[0.06]">
                  <StravaFeedRoutePreview coords={act.previewCoords} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function projectMercatorX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 256 * Math.pow(2, z);
}

function projectMercatorY(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, s));
  return (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
}

function StravaFeedRoutePreview({ coords }: { coords: [number, number][] }) {
  const isLight = useIsLightTheme();
  const lats = coords.map((c) => c[0]);
  const lons = coords.map((c) => c[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const canvasW = 640;
  const canvasH = 160;

  let z = 14;
  for (let cand = 15; cand >= 7; cand--) {
    const dx = projectMercatorX(maxLon, cand) - projectMercatorX(minLon, cand);
    const dy = projectMercatorY(minLat, cand) - projectMercatorY(maxLat, cand);
    if (dx <= 290 && dy <= 116) {
      z = cand;
      break;
    }
    z = cand;
  }

  const centerX = (projectMercatorX(minLon, z) + projectMercatorX(maxLon, z)) / 2;
  const centerY = (projectMercatorY(minLat, z) + projectMercatorY(maxLat, z)) / 2;
  const originX = centerX - canvasW / 2;
  const originY = centerY - canvasH / 2;

  const numTiles = Math.pow(2, z);
  const minTileX = Math.floor(originX / 256);
  const maxTileX = Math.floor((originX + canvasW) / 256);
  const minTileY = Math.max(0, Math.floor(originY / 256));
  const maxTileY = Math.min(numTiles - 1, Math.floor((originY + canvasH) / 256));

  const tiles: { key: string; url: string; left: number; top: number }[] = [];
  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const wrappedX = ((tx % numTiles) + numTiles) % numTiles;
      tiles.push({
        key: `${z}-${tx}-${ty}`,
        url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${ty}/${wrappedX}`,
        left: tx * 256 - originX,
        top: ty * 256 - originY,
      });
    }
  }

  const projected = coords.map(([lat, lon]) => [
    projectMercatorX(lon, z) - originX,
    projectMercatorY(lat, z) - originY,
  ]);
  const pointsStr = projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const start = projected[0];
  const end = projected[projected.length - 1];

  return (
    <div className="relative h-40 w-full overflow-hidden bg-[#181A1D]">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: `${canvasW}px`, height: `${canvasH}px` }}
      >
        {/* Muted Map Tiles (adapts to dark/light theme via .map-tiles-themed) */}
        <div className="map-tiles-themed absolute inset-0">
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                left: `${tile.left}px`,
                top: `${tile.top}px`,
                width: '256px',
                height: '256px',
              }}
            />
          ))}
        </div>

        {/* Exact Mercator-aligned GPS Route Overlay */}
        <svg
          width={canvasW}
          height={canvasH}
          viewBox={`0 0 ${canvasW} ${canvasH}`}
          className="relative z-10 block"
        >
          <polyline
            fill="none"
            stroke={isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(18, 18, 18, 0.7)'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pointsStr}
          />
          <polyline
            fill="none"
            stroke="#007CC3"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pointsStr}
          />
          <circle
            cx={start[0]}
            cy={start[1]}
            r="4.5"
            fill="#10b981"
            stroke="#ffffff"
            strokeWidth="1.5"
          />
          <circle
            cx={end[0]}
            cy={end[1]}
            r="4.5"
            fill="#007CC3"
            stroke="#ffffff"
            strokeWidth="1.5"
          />
        </svg>
      </div>
    </div>
  );
}
