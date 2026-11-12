import type { ActivitySummary, DailyHealth, TimelinePoint } from '../types/fitness';

function mergeTimelines(
  primary?: TimelinePoint[],
  secondary?: TimelinePoint[]
): TimelinePoint[] | undefined {
  if (!primary?.length && !secondary?.length) return undefined;
  if (!primary?.length) return secondary;
  if (!secondary?.length) return primary;

  const map = new Map<string, number>();
  for (const pt of secondary) {
    if (pt.t && Number.isFinite(pt.v)) map.set(pt.t, pt.v);
  }
  for (const pt of primary) {
    if (pt.t && Number.isFinite(pt.v)) map.set(pt.t, pt.v);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, v]) => ({ t, v }));
}

function mergeSources(a?: string[], b?: string[]): string[] | undefined {
  const set = new Set<string>([...(a ?? []), ...(b ?? [])]);
  return set.size > 0 ? Array.from(set) : undefined;
}

/**
 * Merges two DailyHealth records for the same YYYY-MM-DD date without losing
 * defined fields or overwriting native Garmin data with estimated/empty fields.
 */
export function mergeDailyHealthRecord(
  existing: DailyHealth | undefined,
  incoming: DailyHealth
): DailyHealth {
  if (!existing) return incoming;

  const merged: DailyHealth = { ...existing };

  // Incoming scalar fields override only when incoming value is defined AND
  // (existing is missing OR incoming is non-estimated Garmin/explicit data)
  const keys = Object.keys(incoming) as (keyof DailyHealth)[];
  for (const key of keys) {
    if (
      key === 'date' ||
      key === 'sources' ||
      key === 'hrTimeline' ||
      key === 'stressTimeline' ||
      key === 'bodyBatteryTimeline' ||
      key === 'bodyBatteryEstimated'
    ) {
      continue;
    }
    const val = incoming[key];
    if (val === undefined || val === null) continue;

    // Never replace native Garmin Body Battery with an estimated recalculation
    if (
      incoming.bodyBatteryEstimated &&
      existing.bodyBatteryEstimated === false &&
      key.startsWith('bodyBattery')
    ) {
      continue;
    }

    (merged as unknown as Record<string, unknown>)[key] = val;
  }

  merged.sources = mergeSources(existing.sources, incoming.sources);
  merged.hrTimeline = mergeTimelines(existing.hrTimeline, incoming.hrTimeline);
  merged.stressTimeline = mergeTimelines(existing.stressTimeline, incoming.stressTimeline);

  // Preserve native Body Battery timeline if incoming is estimated or missing
  if (incoming.bodyBatteryEstimated && existing.bodyBatteryTimeline && !existing.bodyBatteryEstimated) {
    merged.bodyBatteryTimeline = existing.bodyBatteryTimeline;
    merged.bodyBatteryEstimated = false;
  } else {
    merged.bodyBatteryTimeline = mergeTimelines(
      incoming.bodyBatteryTimeline,
      existing.bodyBatteryTimeline
    );
    if (incoming.bodyBatteryMax !== undefined && !incoming.bodyBatteryEstimated) {
      merged.bodyBatteryEstimated = false;
    } else if (existing.bodyBatteryEstimated !== undefined) {
      merged.bodyBatteryEstimated = incoming.bodyBatteryEstimated ?? existing.bodyBatteryEstimated;
    }
  }

  return merged;
}

/**
 * Finds an existing activity representing the same real-world workout from
 * another ecosystem (within +-6 minutes startTime and ~12% duration/distance).
 */
export function findDuplicateActivity(
  candidate: ActivitySummary,
  existingList: ActivitySummary[]
): ActivitySummary | undefined {
  const exact = existingList.find((a) => a.id === candidate.id);
  if (exact) return exact;

  const candMs = Date.parse(candidate.startTime);
  if (!Number.isFinite(candMs)) return undefined;

  return existingList.find((ex) => {
    const exMs = Date.parse(ex.startTime);
    if (!Number.isFinite(exMs) || Math.abs(candMs - exMs) > 6 * 60 * 1000) return false;

    const maxDur = Math.max(ex.durationSeconds, candidate.durationSeconds, 1);
    if (Math.abs(ex.durationSeconds - candidate.durationSeconds) / maxDur > 0.15) return false;

    if (ex.distanceMeters > 500 || candidate.distanceMeters > 500) {
      const maxDist = Math.max(ex.distanceMeters, candidate.distanceMeters, 1);
      if (Math.abs(ex.distanceMeters - candidate.distanceMeters) / maxDist > 0.15) return false;
    }
    return true;
  });
}

/**
 * Merges duplicate workout metadata from a secondary source into the existing
 * primary record while keeping the richer GPS/FIT streams intact.
 */
export function mergeActivityRecords(
  existing: ActivitySummary,
  incoming: ActivitySummary
): ActivitySummary {
  return {
    ...existing,
    garminActivityId: existing.garminActivityId ?? incoming.garminActivityId,
    intervalsActivityId: existing.intervalsActivityId ?? incoming.intervalsActivityId,
    hasStreams: existing.hasStreams || incoming.hasStreams,
    avgHr: existing.avgHr ?? incoming.avgHr,
    maxHr: existing.maxHr ?? incoming.maxHr,
    avgCadence: existing.avgCadence ?? incoming.avgCadence,
    avgPower: existing.avgPower ?? incoming.avgPower,
    normalizedPower: existing.normalizedPower ?? incoming.normalizedPower,
    maxPower: existing.maxPower ?? incoming.maxPower,
    tss: existing.tss ?? incoming.tss,
    intensityFactor: existing.intensityFactor ?? incoming.intensityFactor,
    calories: existing.calories ?? incoming.calories,
    hrZonesSeconds: existing.hrZonesSeconds ?? incoming.hrZonesSeconds,
    powerZonesSeconds: existing.powerZonesSeconds ?? incoming.powerZonesSeconds,
    previewCoords:
      (existing.previewCoords?.length ?? 0) >= (incoming.previewCoords?.length ?? 0)
        ? existing.previewCoords
        : incoming.previewCoords,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function estimateDayBodyBattery(
  day: DailyHealth,
  dayActivities: ActivitySummary[],
  baselineHrv: number,
  baselineRhr: number
): Partial<DailyHealth> | null {
  const hasRecoverySignal =
    (day.sleepSeconds ?? 0) > 0 ||
    day.hrvLastNight !== undefined ||
    day.rhr !== undefined ||
    day.sleepScore !== undefined;

  if (!hasRecoverySignal) return null;

  // Baseline sleep charge around 45..88 based on sleep duration & quality
  const sleepHours = (day.sleepSeconds ?? 25200) / 3600;
  const durationScore = clamp((sleepHours / 8.0) * 72, 22, 78);
  const qualityBonus = day.sleepScore !== undefined ? ((day.sleepScore - 65) / 35) * 14 : 6;
  const hrvBonus =
    day.hrvLastNight !== undefined && baselineHrv > 0
      ? clamp(((day.hrvLastNight - baselineHrv) / baselineHrv) * 30, -14, 14)
      : 0;
  const rhrBonus =
    day.rhr !== undefined && baselineRhr > 0
      ? clamp(((baselineRhr - day.rhr) / baselineRhr) * 28, -10, 10)
      : 0;

  const nightLow = clamp(Math.round(28 + hrvBonus * 0.4), 15, 50);
  const morningPeak = clamp(
    Math.round(durationScore + qualityBonus + hrvBonus + rhrBonus + 12),
    42,
    98
  );
  const charged = Math.max(0, morningPeak - nightLow);

  // Workout + daytime drain from merged activities (Garmin Edge / watch / band)
  let workoutStrain = 0;
  const workoutHours: { hour: number; load: number }[] = [];
  for (const act of dayActivities) {
    const load =
      act.tss !== undefined
        ? act.tss * 0.32
        : act.calories !== undefined
          ? act.calories * 0.025
          : (act.durationSeconds / 60) * 0.3;
    const clampedLoad = clamp(load, 4, 48);
    workoutStrain += clampedLoad;
    const h = new Date(act.startTime).getHours();
    workoutHours.push({ hour: Number.isFinite(h) ? h : 17, load: clampedLoad });
  }

  const baseDaytimeDrain = day.stressAvg !== undefined ? clamp(day.stressAvg * 0.55, 18, 45) : 26;
  const totalDrain = clamp(Math.round(baseDaytimeDrain + workoutStrain), 18, morningPeak - 8);
  const eveningEnd = clamp(morningPeak - totalDrain, 5, morningPeak - 5);

  // Build 24h timeline (00:00 -> 23:00) reflecting sleep recharge + daytime/workout drain
  const timeline: TimelinePoint[] = [];
  let level = nightLow;
  for (let hour = 0; hour <= 23; hour++) {
    if (hour <= 7) {
      const progress = hour / 7;
      level = nightLow + (morningPeak - nightLow) * progress;
    } else {
      const wakeProgress = 1 / 16;
      level -= baseDaytimeDrain * wakeProgress;
      for (const w of workoutHours) {
        if (hour === w.hour || hour === Math.min(23, w.hour + 1)) {
          level -= w.load * 0.5;
        }
      }
    }
    timeline.push({
      t: `${String(hour).padStart(2, '0')}:00`,
      v: clamp(Math.round(level), 5, 100),
    });
  }

  const vals = timeline.map((p) => p.v);
  return {
    bodyBatteryEstimated: true,
    bodyBatteryMax: Math.max(...vals),
    bodyBatteryMin: Math.min(...vals),
    bodyBatteryCurrent: eveningEnd,
    bodyBatteryCharged: charged,
    bodyBatteryDrained: totalDrain,
    bodyBatteryTimeline: timeline,
  };
}

/**
 * Cross-ecosystem fusion pass: when a day lacks native Garmin Body Battery,
 * synthesizes an estimated recovery/Body Battery curve combining sleep/HRV/RHR
 * (e.g. from band / Intervals.icu) and workout strain (e.g. from Garmin Edge).
 */
export function enrichDailyHealthWithFusion(
  healthDays: DailyHealth[],
  activities: ActivitySummary[]
): DailyHealth[] {
  const hrvVals = healthDays
    .map((d) => d.hrvLastNight)
    .filter((v): v is number => v !== undefined && v > 0);
  const baselineHrv =
    hrvVals.length > 0 ? hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length : 55;

  const rhrVals = healthDays
    .map((d) => d.rhr)
    .filter((v): v is number => v !== undefined && v > 0);
  const baselineRhr =
    rhrVals.length > 0 ? rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length : 54;

  const actsByDate = new Map<string, ActivitySummary[]>();
  for (const act of activities) {
    const dateKey = act.startTime.slice(0, 10);
    const arr = actsByDate.get(dateKey);
    if (arr) arr.push(act);
    else actsByDate.set(dateKey, [act]);
  }

  return healthDays.map((day) => {
    const hasNativeBb =
      day.bodyBatteryMax !== undefined &&
      (day.bodyBatteryTimeline?.length ?? 0) > 0 &&
      !day.bodyBatteryEstimated;
    if (hasNativeBb) return day;

    const est = estimateDayBodyBattery(
      day,
      actsByDate.get(day.date) ?? [],
      baselineHrv,
      baselineRhr
    );
    if (!est) return day;

    return {
      ...day,
      ...est,
    };
  });
}
