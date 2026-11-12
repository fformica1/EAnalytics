import type {
  ActivityDetail,
  ActivitySummary,
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

const STRAVA_API = 'https://www.strava.com/api/v3';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const PARSER_VERSION = 5;

export function buildStravaAuthUrl(clientId: string): string {
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all,profile:read_all',
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeStravaCode(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteName?: string;
  athleteAvatarUrl?: string;
  athleteLocation?: string;
}> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Strava OAuth (${res.status}): ${txt.slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: {
      firstname?: string;
      lastname?: string;
      profile?: string;
      profile_medium?: string;
      city?: string;
      country?: string;
    };
  };
  const a = data.athlete;
  const fullName = [a?.firstname, a?.lastname].filter(Boolean).join(' ').trim();
  const loc = [a?.city, a?.country].filter(Boolean).join(', ').trim();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
    athleteName: fullName || undefined,
    athleteAvatarUrl: a?.profile || a?.profile_medium || undefined,
    athleteLocation: loc || undefined,
  };
}

async function ensureValidStravaToken(settings: UserSettings): Promise<{
  token: string;
  updatedFields: Partial<UserSettings>;
}> {
  const nowSec = Math.floor(Date.now() / 1000);
  const token = settings.stravaAccessToken?.trim() ?? '';
  const refresh = settings.stravaRefreshToken?.trim() ?? '';
  const expiresAt = settings.stravaExpiresAt ?? 0;

  if (token && (expiresAt === 0 || expiresAt > nowSec + 120)) {
    return { token, updatedFields: {} };
  }

  if (refresh && settings.stravaClientId?.trim() && settings.stravaClientSecret?.trim()) {
    const res = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: settings.stravaClientId.trim(),
        client_secret: settings.stravaClientSecret.trim(),
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };
      return {
        token: data.access_token,
        updatedFields: {
          stravaAccessToken: data.access_token,
          stravaRefreshToken: data.refresh_token,
          stravaExpiresAt: data.expires_at,
        },
      };
    }
  }

  if (token) return { token, updatedFields: {} };
  throw new Error('Strava non configurato. Inserisci Client ID/Secret o Access Token nelle Impostazioni.');
}

async function stravaGetJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${STRAVA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Strava API (${res.status}): ${txt.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

function mapStravaSport(rawType?: unknown): SportType {
  const s = String(rawType ?? '').toLowerCase();
  if (s.includes('ride') || s.includes('cycling') || s.includes('ebike')) return 'cycling';
  if (s.includes('trail')) return 'trail_running';
  if (s.includes('run')) return 'running';
  if (s.includes('walk') || s.includes('hike')) return 'walking';
  if (s.includes('swim')) return 'swimming';
  if (s.includes('weight') || s.includes('workout') || s.includes('crossfit')) return 'strength';
  return 'other';
}

function mapStravaSummary(raw: Record<string, unknown>): ActivitySummary {
  const idNum = Number(raw.id);
  const dist = Number(raw.distance ?? 0);
  const elapsed = Number(raw.elapsed_time ?? raw.moving_time ?? 0);
  const moving = Number(raw.moving_time ?? elapsed);
  const avgSpd =
    typeof raw.average_speed === 'number' ? raw.average_speed : moving > 0 ? dist / moving : 0;
  const loc = [raw.location_city, raw.location_country].filter(Boolean).join(', ');

  return {
    id: `strava_${idNum}`,
    source: 'strava',
    stravaActivityId: idNum,
    name: typeof raw.name === 'string' ? raw.name : 'Attività Strava',
    sport: mapStravaSport(raw.sport_type ?? raw.type),
    startTime:
      typeof raw.start_date_local === 'string'
        ? raw.start_date_local
        : typeof raw.start_date === 'string'
          ? raw.start_date
          : new Date().toISOString(),
    distanceMeters: Math.round(dist),
    durationSeconds: Math.round(elapsed),
    movingDurationSeconds: Math.round(moving),
    elevationGainMeters: Math.round(Number(raw.total_elevation_gain ?? 0)),
    elevationLossMeters: 0,
    avgSpeedMps: avgSpd,
    maxSpeedMps: typeof raw.max_speed === 'number' ? raw.max_speed : 0,
    avgHr: typeof raw.average_heartrate === 'number' ? Math.round(raw.average_heartrate) : undefined,
    maxHr: typeof raw.max_heartrate === 'number' ? Math.round(raw.max_heartrate) : undefined,
    avgCadence: typeof raw.average_cadence === 'number' ? Math.round(raw.average_cadence) : undefined,
    avgPower: typeof raw.average_watts === 'number' ? Math.round(raw.average_watts) : undefined,
    normalizedPower:
      typeof raw.weighted_average_watts === 'number'
        ? Math.round(raw.weighted_average_watts)
        : undefined,
    maxPower: typeof raw.max_watts === 'number' ? Math.round(raw.max_watts) : undefined,
    calories: typeof raw.calories === 'number' ? Math.round(raw.calories) : undefined,
    locationName: loc || undefined,
    hasStreams: false,
    parserVersion: PARSER_VERSION,
  };
}

export async function downloadStravaActivityStreams(
  settings: UserSettings,
  stravaId: number,
  baseSummary: ActivitySummary
): Promise<{ summary: ActivitySummary; detail: ActivityDetail }> {
  const { token } = await ensureValidStravaToken(settings);
  const raw = await stravaGetJson<Record<string, { data?: unknown[] }>>(
    `/activities/${stravaId}/streams?keys=time,latlng,distance,altitude,velocity_smooth,heartrate,cadence,watts,temp,grade_smooth&key_by_type=true`,
    token
  );

  const timeArr = (raw.time?.data ?? []) as number[];
  const llArr = (raw.latlng?.data ?? []) as [number, number][];
  const distArr = (raw.distance?.data ?? []) as number[];
  const altArr = (raw.altitude?.data ?? []) as number[];
  const spdArr = (raw.velocity_smooth?.data ?? []) as number[];
  const hrArr = (raw.heartrate?.data ?? []) as number[];
  const cadArr = (raw.cadence?.data ?? []) as number[];
  const pwrArr = (raw.watts?.data ?? []) as number[];
  const tempArr = (raw.temp?.data ?? []) as number[];
  const gradeArr = (raw.grade_smooth?.data ?? []) as number[];

  const len = Math.max(timeArr.length, llArr.length, hrArr.length, pwrArr.length);
  const streams: StreamPoint[] = [];
  for (let i = 0; i < len; i++) {
    const ll = Array.isArray(llArr[i]) ? llArr[i] : undefined;
    streams.push({
      t: typeof timeArr[i] === 'number' ? timeArr[i] : i,
      d: typeof distArr[i] === 'number' ? Number((distArr[i] / 1000).toFixed(3)) : 0,
      lat: ll && Math.abs(ll[0]) <= 90 ? ll[0] : undefined,
      lon: ll && Math.abs(ll[1]) <= 180 ? ll[1] : undefined,
      ele: typeof altArr[i] === 'number' ? Number(altArr[i].toFixed(1)) : undefined,
      spd: typeof spdArr[i] === 'number' ? Number((spdArr[i] * 3.6).toFixed(1)) : undefined,
      hr: typeof hrArr[i] === 'number' ? Math.round(hrArr[i]) : undefined,
      cad: typeof cadArr[i] === 'number' ? Math.round(cadArr[i]) : undefined,
      pwr: typeof pwrArr[i] === 'number' ? Math.round(pwrArr[i]) : undefined,
      temp: typeof tempArr[i] === 'number' ? Number(tempArr[i].toFixed(1)) : undefined,
      grade: typeof gradeArr[i] === 'number' ? Number(gradeArr[i].toFixed(1)) : undefined,
    });
  }

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

export async function syncStravaAccount(
  settings: UserSettings,
  options?: { syncedIds?: Set<string>; onProgress?: (msg: string) => void }
): Promise<{
  activities: ActivitySummary[];
  details: ActivityDetail[];
  updatedTokenFields: Partial<UserSettings>;
  athleteProfile?: { name?: string; avatarUrl?: string; location?: string };
}> {
  const report = options?.onProgress ?? (() => {});
  const syncedIds = options?.syncedIds ?? new Set<string>();
  const { token, updatedFields } = await ensureValidStravaToken(settings);

  report('Scaricamento profilo e attività Strava...');
  const [athlete, rawActs] = await Promise.all([
    stravaGetJson<{
      firstname?: string;
      lastname?: string;
      profile?: string;
      profile_medium?: string;
      city?: string;
      country?: string;
    }>('/athlete', token).catch(() => null),
    stravaGetJson<Record<string, unknown>[]>('/athlete/activities?per_page=50', token),
  ]);

  const fullName = [athlete?.firstname, athlete?.lastname].filter(Boolean).join(' ').trim();
  const loc = [athlete?.city, athlete?.country].filter(Boolean).join(', ').trim();
  const athleteProfile =
    fullName || athlete?.profile || athlete?.profile_medium || loc
      ? {
          name: fullName || undefined,
          avatarUrl: athlete?.profile || athlete?.profile_medium || undefined,
          location: loc || undefined,
        }
      : undefined;

  const activities = (Array.isArray(rawActs) ? rawActs : []).map(mapStravaSummary);
  const details: ActivityDetail[] = [];

  const pendingIndices = activities
    .map((act, idx) => (act.stravaActivityId && !syncedIds.has(act.id) ? idx : -1))
    .filter((idx) => idx >= 0);

  for (let i = 0; i < pendingIndices.length; i++) {
    const idx = pendingIndices[i];
    const act = activities[idx];
    if (!act.stravaActivityId) continue;
    report(`Tracce Strava (${i + 1}/${pendingIndices.length}): ${act.name}...`);
    try {
      const parsed = await downloadStravaActivityStreams(settings, act.stravaActivityId, act);
      activities[idx] = parsed.summary;
      details.push(parsed.detail);
    } catch (err) {
      console.warn(`Stream Strava non disponibili per ${act.stravaActivityId}:`, err);
    }
  }

  return { activities, details, updatedTokenFields: updatedFields, athleteProfile };
}
