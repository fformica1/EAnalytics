import type {
  ActivityDetail,
  ActivitySummary,
  DailyHealth,
  SportType,
  TimelinePoint,
  UserSettings,
} from '../types/fitness';
import { extractFitFromGarminZip } from './fitParser';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

function mapGarminSport(typeKey: unknown): SportType {
  const k = String(typeKey ?? '').toLowerCase();
  if (k.includes('cycling') || k.includes('biking') || k.includes('mountain_biking')) return 'cycling';
  if (k.includes('trail_running')) return 'trail_running';
  if (k.includes('running')) return 'running';
  if (k.includes('walking') || k.includes('hiking')) return 'walking';
  if (k.includes('strength') || k.includes('training')) return 'strength';
  if (k.includes('swimming')) return 'swimming';
  return 'other';
}

let cachedJwt: { token: string; expMs: number; keyFingerprint: string } | null = null;

function quickHash(val: string): string {
  let h = 0;
  for (let i = 0; i < val.length; i++) {
    h = (Math.imul(31, h) + val.charCodeAt(i)) | 0;
  }
  return String(h);
}

export async function getGarminBearerToken(settings: UserSettings): Promise<string> {
  const apiKey = settings.garminApiKey.trim();
  if (!apiKey) {
    throw new Error('Inserisci prima la tua Garmin Personal API Key nelle Impostazioni.');
  }

  const fp = quickHash(apiKey);
  if (cachedJwt && cachedJwt.keyFingerprint === fp && cachedJwt.expMs - Date.now() > 120_000) {
    return cachedJwt.token;
  }

  const base = settings.proxyBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/token`, {
    method: 'POST',
    headers: {
      'X-Garmin-Api-Key': apiKey,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Autenticazione Garmin fallita (${res.status}): ${errText.slice(0, 180)}`);
  }

  const token = (await res.text()).trim();
  let expMs = Date.now() + 3600_000;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number') {
      expMs = payload.exp * 1000;
    }
  } catch {
    // ignore JWT parse fallback
  }

  cachedJwt = { token, expMs, keyFingerprint: fp };
  return token;
}

async function garminGetJson<T = unknown>(
  settings: UserSettings,
  token: string,
  path: string
): Promise<T | null> {
  const base = settings.proxyBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Errore Garmin ${res.status} su ${path}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function downloadAndParseGarminActivity(
  settings: UserSettings,
  garminActivityId: number,
  existingSummary?: ActivitySummary
): Promise<{ summary: ActivitySummary; detail: ActivityDetail }> {
  const token = await getGarminBearerToken(settings);
  const base = settings.proxyBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/download-service/files/activity/${garminActivityId}`, {
    headers: {
      Accept: 'application/zip, application/x-zip-compressed, application/octet-stream',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Download file .FIT fallito (${res.status})`);
  }
  const zipBuffer = await res.arrayBuffer();
  const parsed = await extractFitFromGarminZip(zipBuffer, {
    existingId: `garmin-${garminActivityId}`,
    name: existingSummary?.name,
    maxHr: settings.maxHr,
    ftpWatts: settings.ftpWatts,
  });

  if (existingSummary) {
    parsed.summary = {
      ...existingSummary,
      ...parsed.summary,
      id: existingSummary.id,
      garminActivityId,
      name: existingSummary.name,
      locationName: existingSummary.locationName,
      aerobicTe: existingSummary.aerobicTe ?? parsed.summary.aerobicTe,
      anaerobicTe: existingSummary.anaerobicTe ?? parsed.summary.anaerobicTe,
      trainingLoad: existingSummary.trainingLoad ?? parsed.summary.trainingLoad,
      totalStrokes: existingSummary.totalStrokes ?? parsed.summary.totalStrokes,
      bmrCalories: existingSummary.bmrCalories ?? parsed.summary.bmrCalories,
      avgRespiration: existingSummary.avgRespiration ?? parsed.summary.avgRespiration,
      maxRespiration: existingSummary.maxRespiration ?? parsed.summary.maxRespiration,
      minRespiration: existingSummary.minRespiration ?? parsed.summary.minRespiration,
      waterEstimatedMl: existingSummary.waterEstimatedMl ?? parsed.summary.waterEstimatedMl,
      vo2MaxValue: existingSummary.vo2MaxValue ?? parsed.summary.vo2MaxValue,
      steps: existingSummary.steps ?? parsed.summary.steps,
      poolLengthMeters: existingSummary.poolLengthMeters ?? parsed.summary.poolLengthMeters,
      activeLengths: existingSummary.activeLengths ?? parsed.summary.activeLengths,
      avgSwolf: existingSummary.avgSwolf ?? parsed.summary.avgSwolf,
      grit: existingSummary.grit ?? parsed.summary.grit,
      flow: existingSummary.flow ?? parsed.summary.flow,
      hasStreams: parsed.detail.streams.length > 0,
      parserVersion: 6,
    };
    parsed.detail.activityId = existingSummary.id;
  }

  return parsed;
}

function mapTimelinePairs(pairs: unknown): TimelinePoint[] | undefined {
  if (!Array.isArray(pairs)) return undefined;
  const out: TimelinePoint[] = [];
  for (const row of pairs) {
    if (Array.isArray(row) && row.length >= 2 && typeof row[0] === 'number' && typeof row[1] === 'number') {
      if (row[1] < 0) continue;
      const d = new Date(row[0]);
      const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      out.push({ t, v: Math.round(row[1]) });
    }
  }
  return out.length > 0 ? out : undefined;
}

function mapGarminActivitySummary(raw: Record<string, unknown>): ActivitySummary {
  const actId = Number(raw.activityId);
  const actType = (raw.activityType ?? {}) as Record<string, unknown>;
  const sport = mapGarminSport(actType.typeKey);
  const startLocal =
    typeof raw.startTimeLocal === 'string'
      ? raw.startTimeLocal.replace(' ', 'T')
      : new Date().toISOString();

  const avgCad =
    typeof raw.averageBikingCadenceInRevPerMinute === 'number'
      ? Math.round(raw.averageBikingCadenceInRevPerMinute)
      : typeof raw.averageRunningCadenceInStepsPerMinute === 'number'
        ? Math.round(raw.averageRunningCadenceInStepsPerMinute)
        : undefined;

  const maxCad =
    typeof raw.maxBikingCadenceInRevPerMinute === 'number'
      ? Math.round(raw.maxBikingCadenceInRevPerMinute)
      : typeof raw.maxRunningCadenceInStepsPerMinute === 'number'
        ? Math.round(raw.maxRunningCadenceInStepsPerMinute)
        : undefined;

  return {
    id: `garmin-${actId}`,
    source: 'garmin',
    garminActivityId: actId,
    name: typeof raw.activityName === 'string' ? raw.activityName : `Attività #${actId}`,
    sport,
    startTime: startLocal,
    distanceMeters: Number(raw.distance ?? 0),
    durationSeconds: Number(raw.duration ?? 0),
    movingDurationSeconds: Number(raw.movingDuration ?? raw.duration ?? 0),
    elevationGainMeters: Number(raw.elevationGain ?? 0),
    elevationLossMeters: Number(raw.elevationLoss ?? 0),
    avgSpeedMps: Number(raw.averageSpeed ?? 0),
    maxSpeedMps: Number(raw.maxSpeed ?? 0),
    avgHr: typeof raw.averageHR === 'number' ? Math.round(raw.averageHR) : undefined,
    maxHr: typeof raw.maxHR === 'number' ? Math.round(raw.maxHR) : undefined,
    minHr: typeof raw.minHR === 'number' ? Math.round(raw.minHR) : undefined,
    avgCadence: avgCad,
    maxCadence: maxCad,
    minElevationMeters:
      typeof raw.minElevation === 'number' ? Number(raw.minElevation.toFixed(1)) : undefined,
    maxElevationMeters:
      typeof raw.maxElevation === 'number' ? Number(raw.maxElevation.toFixed(1)) : undefined,
    minTempC:
      typeof raw.minTemperature === 'number' ? Number(raw.minTemperature.toFixed(1)) : undefined,
    maxTempC:
      typeof raw.maxTemperature === 'number' ? Number(raw.maxTemperature.toFixed(1)) : undefined,
    waterEstimatedMl:
      typeof raw.waterEstimated === 'number' ? Math.round(raw.waterEstimated) : undefined,
    vo2MaxValue:
      typeof raw.vO2MaxValue === 'number' ? Math.round(raw.vO2MaxValue) : undefined,
    steps: typeof raw.steps === 'number' ? Math.round(raw.steps) : undefined,
    poolLengthMeters:
      typeof raw.poolLength === 'number' ? Number(raw.poolLength.toFixed(1)) : undefined,
    activeLengths:
      typeof raw.numberOfActiveLengths === 'number'
        ? Math.round(raw.numberOfActiveLengths)
        : undefined,
    avgSwolf: typeof raw.averageSwolf === 'number' ? Math.round(raw.averageSwolf) : undefined,
    grit: typeof raw.grit === 'number' ? Number(raw.grit.toFixed(1)) : undefined,
    flow: typeof raw.avgFlow === 'number' ? Number(raw.avgFlow.toFixed(1)) : undefined,
    avgPower: typeof raw.avgPower === 'number' ? Math.round(raw.avgPower) : undefined,
    normalizedPower: typeof raw.normPower === 'number' ? Math.round(raw.normPower) : undefined,
    maxPower: typeof raw.maxPower === 'number' ? Math.round(raw.maxPower) : undefined,
    calories: typeof raw.calories === 'number' ? Math.round(raw.calories) : undefined,
    bmrCalories: typeof raw.bmrCalories === 'number' ? Math.round(raw.bmrCalories) : undefined,
    trainingLoad:
      typeof raw.activityTrainingLoad === 'number'
        ? Number(raw.activityTrainingLoad.toFixed(1))
        : undefined,
    totalStrokes: typeof raw.strokes === 'number' ? Math.round(raw.strokes) : undefined,
    avgRespiration:
      typeof raw.avgRespirationRate === 'number'
        ? Number(raw.avgRespirationRate.toFixed(1))
        : undefined,
    maxRespiration:
      typeof raw.maxRespirationRate === 'number'
        ? Number(raw.maxRespirationRate.toFixed(1))
        : undefined,
    minRespiration:
      typeof raw.minRespirationRate === 'number'
        ? Number(raw.minRespirationRate.toFixed(1))
        : undefined,
    aerobicTe:
      typeof raw.aerobicTrainingEffect === 'number'
        ? Number(raw.aerobicTrainingEffect.toFixed(1))
        : undefined,
    anaerobicTe:
      typeof raw.anaerobicTrainingEffect === 'number'
        ? Number(raw.anaerobicTrainingEffect.toFixed(1))
        : undefined,
    locationName: typeof raw.locationName === 'string' ? raw.locationName : undefined,
    hasStreams: false,
    hrZonesSeconds:
      typeof raw.hrTimeInZone_1 === 'number'
        ? [
            Math.round(Number(raw.hrTimeInZone_1 ?? 0)),
            Math.round(Number(raw.hrTimeInZone_2 ?? 0)),
            Math.round(Number(raw.hrTimeInZone_3 ?? 0)),
            Math.round(Number(raw.hrTimeInZone_4 ?? 0)),
            Math.round(Number(raw.hrTimeInZone_5 ?? 0)),
          ]
        : undefined,
  };
}

export async function syncGarminAccount(
  settings: UserSettings,
  options: {
    days?: number;
    syncedIds?: Set<string>;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<{
  activities: ActivitySummary[];
  details: ActivityDetail[];
  healthDays: DailyHealth[];
  athleteProfile?: { name?: string; avatarUrl?: string; location?: string };
}> {
  const days = options.days ?? 14;
  const syncedIds = options.syncedIds ?? new Set<string>();
  const isInitialSync = syncedIds.size === 0;
  const report = options.onProgress ?? (() => {});

  report('Autenticazione Garmin Personal API...');
  const token = await getGarminBearerToken(settings);

  const today = new Date();
  const endStr = isoDate(today);
  const startStr = isoDate(addDays(today, -days));

  report('Verifica attività Garmin...');
  const rawActs: Record<string, unknown>[] = [];
  const pageSize = 50;
  const maxTotal = isInitialSync ? 250 : 100;

  for (let start = 0; start < maxTotal; start += pageSize) {
    const page =
      (await garminGetJson<Record<string, unknown>[]>(
        settings,
        token,
        `/activitylist-service/activities/search/activities?start=${start}&limit=${pageSize}`
      )) ?? [];
    if (page.length === 0) break;
    rawActs.push(...page);

    if (page.length < pageSize) break;
    // On incremental refresh, stop paginating once an entire page is already synced locally
    if (!isInitialSync) {
      const pageSummaries = page.map(mapGarminActivitySummary);
      if (pageSummaries.every((a) => syncedIds.has(a.id))) break;
    }
  }

  const socialProfile = await garminGetJson<Record<string, unknown>>(
    settings,
    token,
    '/userprofile-service/socialProfile'
  ).catch(() => null);

  const firstRaw = rawActs[0] as Record<string, unknown> | undefined;
  const profileName =
    (typeof socialProfile?.fullName === 'string' && socialProfile.fullName) ||
    (typeof socialProfile?.displayName === 'string' && socialProfile.displayName) ||
    (typeof firstRaw?.ownerFullName === 'string' ? firstRaw.ownerFullName : undefined);
  const profileAvatar =
    (typeof socialProfile?.profileImageUrlLarge === 'string' && socialProfile.profileImageUrlLarge) ||
    (typeof socialProfile?.profileImageUrlMedium === 'string' && socialProfile.profileImageUrlMedium) ||
    (typeof firstRaw?.ownerProfileImageUrlMedium === 'string'
      ? firstRaw.ownerProfileImageUrlMedium
      : undefined);
  const profileLocation =
    (typeof socialProfile?.location === 'string' && socialProfile.location) ||
    (typeof firstRaw?.locationName === 'string' ? firstRaw.locationName : undefined);

  const athleteProfile =
    profileName || profileAvatar || profileLocation
      ? {
          name: profileName || undefined,
          avatarUrl: profileAvatar || undefined,
          location: profileLocation || undefined,
        }
      : undefined;

  const activities = rawActs.map(mapGarminActivitySummary);
  const details: ActivityDetail[] = [];

  // Download raw .FIT ONLY for new or not-yet-parsed activities
  const pendingIndices = activities
    .map((act, idx) => (act.garminActivityId && !syncedIds.has(act.id) ? idx : -1))
    .filter((idx) => idx >= 0);

  const batchSize = 3;
  for (let b = 0; b < pendingIndices.length; b += batchSize) {
    const batch = pendingIndices.slice(b, b + batchSize);
    report(
      `Scaricamento tracce .FIT (${Math.min(b + batch.length, pendingIndices.length)}/${pendingIndices.length})...`
    );
    await Promise.all(
      batch.map(async (idx) => {
        const act = activities[idx];
        if (!act.garminActivityId) return;
        try {
          const parsed = await downloadAndParseGarminActivity(settings, act.garminActivityId, act);
          activities[idx] = parsed.summary;
          details.push(parsed.detail);
        } catch (err) {
          console.warn(`FIT non disponibile per attività ${act.garminActivityId}:`, err);
        }
      })
    );
  }

  report('Scaricamento metriche salute H24 (Sonno, HRV, Body Battery, Stress)...');

  const [sleepSummaries, hrvSummaries, bbReports, stressStats, stepStats, dailySumObj, weightObj] =
    await Promise.all([
      garminGetJson<Record<string, unknown>[]>(
        settings,
        token,
        `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${startStr}&endDate=${endStr}`
      ).catch(() => null),
      garminGetJson<{ hrvSummaries?: Record<string, unknown>[] }>(
        settings,
        token,
        `/hrv-service/hrv/daily/${startStr}/${endStr}`
      ).catch(() => null),
      garminGetJson<Record<string, unknown>[]>(
        settings,
        token,
        `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${startStr}&endDate=${endStr}`
      ).catch(() => null),
      garminGetJson<Record<string, unknown>[]>(
        settings,
        token,
        `/usersummary-service/stats/stress/daily/${startStr}/${endStr}`
      ).catch(() => null),
      garminGetJson<Record<string, unknown>[]>(
        settings,
        token,
        `/usersummary-service/stats/steps/daily/${startStr}/${endStr}`
      ).catch(() => null),
      garminGetJson<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(
        settings,
        token,
        `/usersummary-service/v2/dailysummaries?startDate=${startStr}&endDate=${endStr}`
      ).catch(() => null),
      garminGetJson<{ dateWeightSummaries?: Record<string, unknown>[] }>(
        settings,
        token,
        `/weight-service/weight/range/${startStr}/${endStr}?includeAll=true`
      ).catch(() => null),
    ]);

  const byDate = new Map<string, DailyHealth>();
  const ensureDay = (date: string): DailyHealth => {
    let rec = byDate.get(date);
    if (!rec) {
      rec = { date, sources: ['garmin'] };
      byDate.set(date, rec);
    }
    return rec;
  };

  if (Array.isArray(sleepSummaries)) {
    for (const s of sleepSummaries) {
      const date = typeof s.calendarDate === 'string' ? s.calendarDate : null;
      if (!date) continue;
      const rec = ensureDay(date);
      if (typeof s.sleepTimeSeconds === 'number') rec.sleepSeconds = s.sleepTimeSeconds;
      if (typeof s.deepSleepSeconds === 'number') rec.deepSleepSeconds = s.deepSleepSeconds;
      if (typeof s.lightSleepSeconds === 'number') rec.lightSleepSeconds = s.lightSleepSeconds;
      if (typeof s.remSleepSeconds === 'number') rec.remSleepSeconds = s.remSleepSeconds;
      if (typeof s.awakeSleepSeconds === 'number') rec.awakeSleepSeconds = s.awakeSleepSeconds;
      if (typeof s.averageSpO2Value === 'number') rec.spo2Avg = Math.round(s.averageSpO2Value);
      if (typeof s.averageRespirationValue === 'number')
        rec.respirationAvg = Number(s.averageRespirationValue.toFixed(1));
      const sleepScores = s.sleepScores as { overall?: { value?: number } } | undefined;
      if (typeof sleepScores?.overall?.value === 'number') {
        rec.sleepScore = sleepScores.overall.value;
      }
    }
  }

  const hrvList = hrvSummaries?.hrvSummaries ?? (Array.isArray(hrvSummaries) ? hrvSummaries : []);
  if (Array.isArray(hrvList)) {
    for (const h of hrvList) {
      const date = typeof h.calendarDate === 'string' ? h.calendarDate : null;
      if (!date) continue;
      const rec = ensureDay(date);
      if (typeof h.lastNightAvg === 'number') rec.hrvLastNight = Math.round(h.lastNightAvg);
      if (typeof h.weeklyAvg === 'number') rec.hrvWeeklyAvg = Math.round(h.weeklyAvg);
      if (typeof h.status === 'string') rec.hrvStatus = h.status;
      const baseline = h.baseline as { balancedLow?: number; balancedUpper?: number } | undefined;
      if (typeof baseline?.balancedLow === 'number') rec.hrvBaselineLow = baseline.balancedLow;
      if (typeof baseline?.balancedUpper === 'number') rec.hrvBaselineHigh = baseline.balancedUpper;
    }
  }

  if (Array.isArray(bbReports)) {
    for (const b of bbReports) {
      const date = typeof b.date === 'string' ? b.date : null;
      if (!date) continue;
      const rec = ensureDay(date);
      if (typeof b.charged === 'number') rec.bodyBatteryCharged = b.charged;
      if (typeof b.drained === 'number') rec.bodyBatteryDrained = b.drained;
      const timeline = mapTimelinePairs(b.bodyBatteryValuesArray);
      if (timeline) {
        rec.bodyBatteryTimeline = timeline;
        rec.bodyBatteryMax = Math.max(...timeline.map((p) => p.v));
        rec.bodyBatteryMin = Math.min(...timeline.map((p) => p.v));
        rec.bodyBatteryCurrent = timeline[timeline.length - 1].v;
      }
    }
  }

  if (Array.isArray(stressStats)) {
    for (const st of stressStats) {
      const date = typeof st.calendarDate === 'string' ? st.calendarDate : null;
      if (!date) continue;
      const rec = ensureDay(date);
      const values = st.values as { overallStressLevel?: number } | undefined;
      if (typeof values?.overallStressLevel === 'number' && values.overallStressLevel >= 0) {
        rec.stressAvg = Math.round(values.overallStressLevel);
      } else if (typeof st.overallStressLevel === 'number' && st.overallStressLevel >= 0) {
        rec.stressAvg = Math.round(st.overallStressLevel);
      }
    }
  }

  if (Array.isArray(stepStats)) {
    for (const sp of stepStats) {
      const date = typeof sp.calendarDate === 'string' ? sp.calendarDate : null;
      if (!date) continue;
      const rec = ensureDay(date);
      if (typeof sp.totalSteps === 'number') rec.steps = sp.totalSteps;
      if (typeof sp.stepGoal === 'number') rec.stepsGoal = sp.stepGoal;
    }
  }

  const dailyList = Array.isArray(dailySumObj)
    ? dailySumObj
    : Array.isArray((dailySumObj as { data?: unknown[] } | null)?.data)
      ? (dailySumObj as { data: Record<string, unknown>[] }).data
      : [];

  for (const ds of dailyList) {
    const date = typeof ds.calendarDate === 'string' ? ds.calendarDate : null;
    if (!date) continue;
    const rec = ensureDay(date);
    if (typeof ds.restingHeartRate === 'number') rec.rhr = Math.round(ds.restingHeartRate);
    if (typeof ds.minHeartRate === 'number') rec.hrMin = Math.round(ds.minHeartRate);
    if (typeof ds.maxHeartRate === 'number') rec.hrMax = Math.round(ds.maxHeartRate);
    if (typeof ds.totalSteps === 'number') rec.steps = ds.totalSteps;
    if (typeof ds.dailyStepGoal === 'number') rec.stepsGoal = ds.dailyStepGoal;
    if (typeof ds.totalKilocalories === 'number') rec.caloriesTotal = Math.round(ds.totalKilocalories);
    if (typeof ds.activeKilocalories === 'number')
      rec.caloriesActive = Math.round(ds.activeKilocalories);
    if (typeof ds.averageStressLevel === 'number' && ds.averageStressLevel >= 0)
      rec.stressAvg = Math.round(ds.averageStressLevel);
    if (typeof ds.maxStressLevel === 'number' && ds.maxStressLevel >= 0)
      rec.stressMax = Math.round(ds.maxStressLevel);
    if (typeof ds.bodyBatteryHighestValue === 'number')
      rec.bodyBatteryMax = ds.bodyBatteryHighestValue;
    if (typeof ds.bodyBatteryLowestValue === 'number')
      rec.bodyBatteryMin = ds.bodyBatteryLowestValue;
    if (typeof ds.bodyBatteryMostRecentValue === 'number')
      rec.bodyBatteryCurrent = ds.bodyBatteryMostRecentValue;
  }

  const weights = weightObj?.dateWeightSummaries ?? [];
  for (const w of weights) {
    const date = typeof w.calendarDate === 'string' ? w.calendarDate : null;
    if (!date) continue;
    const rec = ensureDay(date);
    if (typeof w.weight === 'number') {
      rec.weightKg = Number((w.weight / 1000).toFixed(1));
    }
  }

  // Fetch today & yesterday detailed 24h HR + stress curves
  for (const dOffset of [0, -1]) {
    const targetDate = isoDate(addDays(today, dOffset));
    const hrResp = await garminGetJson<{ heartRateValues?: unknown }>(
      settings,
      token,
      `/wellness-service/wellness/dailyHeartRate?date=${targetDate}`
    ).catch(() => null);
    if (hrResp?.heartRateValues) {
      const hrTimeline = mapTimelinePairs(hrResp.heartRateValues);
      if (hrTimeline) {
        ensureDay(targetDate).hrTimeline = hrTimeline;
      }
    }
  }

  return {
    activities,
    details,
    healthDays: Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date)),
    athleteProfile,
  };
}
