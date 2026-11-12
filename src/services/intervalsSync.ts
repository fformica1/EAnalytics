import type {
  ActivityDetail,
  ActivitySummary,
  DailyHealth,
  SportType,
  StreamPoint,
  UserSettings,
} from '../types/fitness';
import {
  compactStreams,
  computeCleanNormalizedPower,
  computeZones,
  downsampleForPreview,
  sanitizePowerStreams,
} from './fitParser';

const PARSER_VERSION = 5;

interface IntervalsRawActivity {
  id: string;
  name?: string;
  type?: string;
  start_date_local?: string;
  start_date?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  icu_average_watts?: number;
  icu_weighted_avg_watts?: number;
  max_watts?: number;
  icu_training_load?: number;
  icu_intensity?: number;
  calories?: number;
}

interface IntervalsWellnessDay {
  id: string; // YYYY-MM-DD
  weight?: number;
  restingHR?: number;
  hrv?: number;
  hrvSDNN?: number;
  sleepSecs?: number;
  sleepQuality?: number;
  spO2?: number;
  steps?: number;
  stress?: number; // 1..4 subjective scale
  respiration?: number;
}

interface IntervalsStreamEntry {
  type?: string;
  data?: unknown[];
}

function buildBasicAuth(apiKey: string): string {
  return `Basic ${btoa(`API_KEY:${apiKey.trim()}`)}`;
}

async function intervalsGetJson<T>(
  path: string,
  apiKey: string
): Promise<T> {
  const res = await fetch(`/api/intervals${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: buildBasicAuth(apiKey),
    },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Intervals.icu API (${res.status}): ${errText.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

function mapIntervalsSport(rawType?: string): SportType {
  const s = (rawType ?? '').toLowerCase();
  if (s.includes('ride') || s.includes('cycling') || s.includes('bike') || s.includes('gravel')) {
    return 'cycling';
  }
  if (s.includes('trail')) return 'trail_running';
  if (s.includes('run')) return 'running';
  if (s.includes('walk') || s.includes('hike')) return 'walking';
  if (s.includes('swim')) return 'swimming';
  if (s.includes('weight') || s.includes('strength')) return 'strength';
  return 'other';
}

function mapWellnessDay(w: IntervalsWellnessDay): DailyHealth {
  const sleepScore =
    typeof w.sleepQuality === 'number' && w.sleepQuality > 0
      ? Math.min(100, Math.round(w.sleepQuality <= 5 ? w.sleepQuality * 22 : w.sleepQuality))
      : undefined;

  // Map Intervals subjective 1..4 stress scale cleanly to 0..100 when needed
  const stressAvg =
    typeof w.stress === 'number' && w.stress > 0
      ? Math.round(w.stress <= 5 ? w.stress * 22 : w.stress)
      : undefined;

  return {
    date: w.id,
    sources: ['intervals'],
    sleepSeconds: typeof w.sleepSecs === 'number' && w.sleepSecs > 0 ? Math.round(w.sleepSecs) : undefined,
    sleepScore,
    hrvLastNight:
      typeof w.hrv === 'number' && w.hrv > 0
        ? Math.round(w.hrv)
        : typeof w.hrvSDNN === 'number' && w.hrvSDNN > 0
          ? Math.round(w.hrvSDNN)
          : undefined,
    rhr: typeof w.restingHR === 'number' && w.restingHR > 0 ? Math.round(w.restingHR) : undefined,
    steps: typeof w.steps === 'number' && w.steps > 0 ? Math.round(w.steps) : undefined,
    spo2Avg: typeof w.spO2 === 'number' && w.spO2 > 0 ? Number(w.spO2.toFixed(1)) : undefined,
    weightKg: typeof w.weight === 'number' && w.weight > 0 ? Number(w.weight.toFixed(1)) : undefined,
    respirationAvg:
      typeof w.respiration === 'number' && w.respiration > 0
        ? Number(w.respiration.toFixed(1))
        : undefined,
    stressAvg,
  };
}

function mapIntervalsActivity(raw: IntervalsRawActivity): ActivitySummary {
  const duration = Math.round(raw.elapsed_time ?? raw.moving_time ?? 0);
  const moving = Math.round(raw.moving_time ?? duration);
  const distance = Math.round(raw.distance ?? 0);

  return {
    id: `intervals_${raw.id}`,
    source: 'intervals',
    intervalsActivityId: raw.id,
    name: raw.name || 'Attività',
    sport: mapIntervalsSport(raw.type),
    startTime: raw.start_date_local || raw.start_date || new Date().toISOString(),
    distanceMeters: distance,
    durationSeconds: duration,
    movingDurationSeconds: moving,
    elevationGainMeters: Math.round(raw.total_elevation_gain ?? 0),
    elevationLossMeters: 0,
    avgSpeedMps:
      typeof raw.average_speed === 'number'
        ? raw.average_speed
        : moving > 0
          ? distance / moving
          : 0,
    maxSpeedMps: typeof raw.max_speed === 'number' ? raw.max_speed : 0,
    avgHr: raw.average_heartrate ? Math.round(raw.average_heartrate) : undefined,
    maxHr: raw.max_heartrate ? Math.round(raw.max_heartrate) : undefined,
    avgCadence: raw.average_cadence ? Math.round(raw.average_cadence) : undefined,
    avgPower: raw.icu_average_watts ? Math.round(raw.icu_average_watts) : undefined,
    normalizedPower: raw.icu_weighted_avg_watts ? Math.round(raw.icu_weighted_avg_watts) : undefined,
    maxPower: raw.max_watts ? Math.round(raw.max_watts) : undefined,
    tss: raw.icu_training_load ? Math.round(raw.icu_training_load) : undefined,
    intensityFactor:
      typeof raw.icu_intensity === 'number'
        ? Number((raw.icu_intensity / 100).toFixed(2))
        : undefined,
    calories: raw.calories ? Math.round(raw.calories) : undefined,
    hasStreams: false,
    parserVersion: PARSER_VERSION,
  };
}

function parseIntervalsStreams(
  rawStreams: IntervalsStreamEntry[] | Record<string, IntervalsStreamEntry | unknown[]>
): StreamPoint[] {
  const map = new Map<string, unknown[]>();
  if (Array.isArray(rawStreams)) {
    for (const entry of rawStreams) {
      if (entry.type && Array.isArray(entry.data)) {
        map.set(entry.type, entry.data);
      }
    }
  } else if (rawStreams && typeof rawStreams === 'object') {
    for (const [k, val] of Object.entries(rawStreams)) {
      if (Array.isArray(val)) map.set(k, val);
      else if (val && typeof val === 'object' && Array.isArray((val as IntervalsStreamEntry).data)) {
        map.set(k, (val as IntervalsStreamEntry).data!);
      }
    }
  }

  const timeArr = map.get('time') ?? [];
  const latlngArr = map.get('latlng') ?? [];
  const wattsArr = map.get('watts') ?? [];
  const hrArr = map.get('heartrate') ?? [];
  const cadArr = map.get('cadence') ?? [];
  const altArr = map.get('altitude') ?? [];
  const spdArr = map.get('velocity_smooth') ?? [];
  const distArr = map.get('distance') ?? [];
  const gradeArr = map.get('grade_smooth') ?? [];

  const len = Math.max(
    timeArr.length,
    latlngArr.length,
    wattsArr.length,
    hrArr.length,
    altArr.length
  );
  const points: StreamPoint[] = [];

  for (let i = 0; i < len; i++) {
    const ll = Array.isArray(latlngArr[i]) ? (latlngArr[i] as [number, number]) : undefined;
    const t = typeof timeArr[i] === 'number' ? (timeArr[i] as number) : i;
    const pwr = typeof wattsArr[i] === 'number' ? Math.round(wattsArr[i] as number) : undefined;
    const hr = typeof hrArr[i] === 'number' ? Math.round(hrArr[i] as number) : undefined;
    const cad = typeof cadArr[i] === 'number' ? Math.round(cadArr[i] as number) : undefined;
    const ele =
      typeof altArr[i] === 'number' ? Number((altArr[i] as number).toFixed(1)) : undefined;
    const spd =
      typeof spdArr[i] === 'number'
        ? Number(((spdArr[i] as number) * 3.6).toFixed(1))
        : undefined;
    const d =
      typeof distArr[i] === 'number' ? Number(((distArr[i] as number) / 1000).toFixed(3)) : 0;
    const grade =
      typeof gradeArr[i] === 'number' ? Number((gradeArr[i] as number).toFixed(1)) : undefined;

    points.push({
      t,
      d,
      lat: ll && Math.abs(ll[0]) <= 90 ? ll[0] : undefined,
      lon: ll && Math.abs(ll[1]) <= 180 ? ll[1] : undefined,
      pwr,
      hr,
      cad,
      ele,
      spd,
      grade,
    });
  }
  return points;
}

export async function downloadIntervalsActivityStreams(
  settings: UserSettings,
  intervalsId: string,
  baseSummary: ActivitySummary
): Promise<{ summary: ActivitySummary; detail: ActivityDetail }> {
  const apiKey = settings.intervalsApiKey?.trim();
  if (!apiKey) {
    throw new Error('Inserisci la tua Intervals.icu API Key nelle Impostazioni.');
  }

  const raw = await intervalsGetJson<
    IntervalsStreamEntry[] | Record<string, IntervalsStreamEntry | unknown[]>
  >(
    `/activity/${encodeURIComponent(intervalsId)}/streams.json?types=time,watts,heartrate,cadence,altitude,velocity_smooth,latlng,distance,grade_smooth`,
    apiKey
  );

  const streams = parseIntervalsStreams(raw);
  sanitizePowerStreams(streams, false);

  const pwrPoints = streams.filter((s) => (s.pwr ?? 0) > 0);
  const avgPower =
    pwrPoints.length > 0
      ? Math.round(pwrPoints.reduce((a, b) => a + (b.pwr ?? 0), 0) / pwrPoints.length)
      : baseSummary.avgPower;
  const maxPower =
    pwrPoints.length > 0 ? Math.max(...pwrPoints.map((s) => s.pwr ?? 0)) : baseSummary.maxPower;
  const np = computeCleanNormalizedPower(streams) ?? baseSummary.normalizedPower;
  const { hrZones, powerZones } = computeZones(streams, settings.maxHr, settings.ftpWatts);
  const compacted = compactStreams(streams);

  const summary: ActivitySummary = {
    ...baseSummary,
    avgPower,
    maxPower,
    normalizedPower: np,
    hrZonesSeconds: hrZones ?? baseSummary.hrZonesSeconds,
    powerZonesSeconds: powerZones ?? baseSummary.powerZonesSeconds,
    previewCoords: downsampleForPreview(streams),
    hasStreams: compacted.length > 0,
    parserVersion: PARSER_VERSION,
  };

  return {
    summary,
    detail: {
      activityId: summary.id,
      streams: compacted,
      laps: [],
    },
  };
}

export async function syncIntervalsAccount(
  settings: UserSettings,
  options?: {
    daysBack?: number;
    syncedIds?: Set<string>;
    onProgress?: (msg: string) => void;
  }
): Promise<{
  activities: ActivitySummary[];
  details: ActivityDetail[];
  healthDays: DailyHealth[];
  athleteProfile?: { name?: string; avatarUrl?: string; location?: string };
}> {
  const apiKey = settings.intervalsApiKey?.trim();
  if (!apiKey) {
    throw new Error('Inserisci la tua Intervals.icu API Key nelle Impostazioni.');
  }

  const report = options?.onProgress ?? (() => {});
  const athleteId = encodeURIComponent(settings.intervalsAthleteId?.trim() || '0');
  const syncedIds = options?.syncedIds ?? new Set<string>();
  const daysBack = options?.daysBack ?? (syncedIds.size === 0 ? 180 : 30);

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 86400 * 1000);
  const newest = endDate.toISOString().slice(0, 10);
  const oldest = startDate.toISOString().slice(0, 10);

  report('Sincronizzazione salute & attività da Intervals.icu...');

  const [rawAthlete, rawWellness, rawActivities] = await Promise.all([
    intervalsGetJson<{
      name?: string;
      profile_medium?: string;
      city?: string;
      country?: string;
    }>(`/athlete/${athleteId}`, apiKey).catch(() => null),
    intervalsGetJson<IntervalsWellnessDay[]>(
      `/athlete/${athleteId}/wellness?oldest=${oldest}&newest=${newest}`,
      apiKey
    ),
    intervalsGetJson<IntervalsRawActivity[]>(
      `/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`,
      apiKey
    ),
  ]);

  const loc = [rawAthlete?.city, rawAthlete?.country].filter(Boolean).join(', ').trim();
  const athleteProfile =
    rawAthlete?.name || rawAthlete?.profile_medium || loc
      ? {
          name: rawAthlete?.name || undefined,
          avatarUrl: rawAthlete?.profile_medium || undefined,
          location: loc || undefined,
        }
      : undefined;

  const healthDays = Array.isArray(rawWellness)
    ? rawWellness
        .filter((w) => typeof w.id === 'string' && w.id.length === 10)
        .map(mapWellnessDay)
        .filter(
          (d) =>
            d.sleepSeconds !== undefined ||
            d.hrvLastNight !== undefined ||
            d.rhr !== undefined ||
            d.steps !== undefined ||
            d.spo2Avg !== undefined ||
            d.weightKg !== undefined
        )
    : [];

  const sortedActs = (Array.isArray(rawActivities) ? rawActivities : []).sort((a, b) =>
    (b.start_date_local ?? b.start_date ?? '').localeCompare(
      a.start_date_local ?? a.start_date ?? ''
    )
  );

  const activities = sortedActs.map(mapIntervalsActivity);
  const details: ActivityDetail[] = [];

  const pendingIndices = activities
    .map((act, idx) => (act.intervalsActivityId && !syncedIds.has(act.id) ? idx : -1))
    .filter((idx) => idx >= 0);

  for (let i = 0; i < pendingIndices.length; i++) {
    const idx = pendingIndices[i];
    const act = activities[idx];
    if (!act.intervalsActivityId) continue;
    report(
      `Tracce Intervals.icu (${i + 1}/${pendingIndices.length}): ${act.name}...`
    );
    try {
      const parsed = await downloadIntervalsActivityStreams(
        settings,
        act.intervalsActivityId,
        act
      );
      activities[idx] = parsed.summary;
      details.push(parsed.detail);
    } catch (err) {
      console.warn(`Stream Intervals non disponibili per ${act.intervalsActivityId}:`, err);
    }
  }

  return { activities, details, healthDays, athleteProfile };
}
