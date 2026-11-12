import { Decoder, Stream } from '@garmin/fitsdk';
import JSZip from 'jszip';
import type {
  ActivityDetail,
  ActivityLap,
  ActivitySource,
  ActivitySummary,
  SportType,
  StreamPoint,
} from '../types/fitness';

const SEMICIRCLE_TO_DEG = 180 / 2147483648;

function toDeg(semicircles: unknown): number | undefined {
  if (typeof semicircles !== 'number' || !Number.isFinite(semicircles)) return undefined;
  const deg = semicircles * SEMICIRCLE_TO_DEG;
  if (Math.abs(deg) > 180 || deg === 0) return undefined;
  return deg;
}

function mapFitSport(rawSport: unknown, subSport?: unknown): SportType {
  const s = String(rawSport ?? '').toLowerCase();
  const sub = String(subSport ?? '').toLowerCase();
  if (s.includes('cycling') || s.includes('biking')) return 'cycling';
  if (s.includes('running') && sub.includes('trail')) return 'trail_running';
  if (s.includes('running')) return 'running';
  if (s.includes('walking') || s.includes('hiking')) return 'walking';
  if (s.includes('training') || s.includes('strength')) return 'strength';
  if (s.includes('swimming')) return 'swimming';
  return 'other';
}

export function downsampleForPreview(streams: StreamPoint[], maxPoints = 60): [number, number][] {
  const withCoords = streams.filter((p) => p.lat !== undefined && p.lon !== undefined);
  if (withCoords.length === 0) return [];
  const step = Math.max(1, Math.floor(withCoords.length / maxPoints));
  const out: [number, number][] = [];
  for (let i = 0; i < withCoords.length; i += step) {
    out.push([withCoords[i].lat!, withCoords[i].lon!]);
  }
  const last = withCoords[withCoords.length - 1];
  if (out.length > 0 && (out[out.length - 1][0] !== last.lat || out[out.length - 1][1] !== last.lon)) {
    out.push([last.lat!, last.lon!]);
  }
  return out;
}

export function computeZones(
  streams: StreamPoint[],
  maxHr = 190,
  ftp = 240
): { hrZones: number[] | undefined; powerZones: number[] | undefined } {
  let hasHr = false;
  let hasPower = false;
  const hrZones = [0, 0, 0, 0, 0];
  const powerZones = [0, 0, 0, 0, 0, 0];

  for (let i = 0; i < streams.length; i++) {
    const dt = i === 0 ? 1 : Math.max(1, Math.min(10, streams[i].t - streams[i - 1].t));
    const hr = streams[i].hr;
    if (hr && hr > 35) {
      hasHr = true;
      const pct = hr / maxHr;
      if (pct < 0.6) hrZones[0] += dt;
      else if (pct < 0.7) hrZones[1] += dt;
      else if (pct < 0.8) hrZones[2] += dt;
      else if (pct < 0.9) hrZones[3] += dt;
      else hrZones[4] += dt;
    }

    const pwr = streams[i].pwr;
    if (pwr !== undefined && pwr >= 0) {
      hasPower = true;
      const pct = pwr / ftp;
      if (pct < 0.55) powerZones[0] += dt;
      else if (pct < 0.75) powerZones[1] += dt;
      else if (pct < 0.9) powerZones[2] += dt;
      else if (pct < 1.05) powerZones[3] += dt;
      else if (pct < 1.2) powerZones[4] += dt;
      else powerZones[5] += dt;
    }
  }

  return {
    hrZones: hasHr ? hrZones : undefined,
    powerZones: hasPower ? powerZones : undefined,
  };
}

/**
 * Downsample long streams (e.g. > 2500 points) to keep UI charts & IndexedDB snappy
 * while preserving exact shape and min/max peaks.
 */
export function compactStreams(raw: StreamPoint[], maxPoints = 1800): StreamPoint[] {
  if (raw.length <= maxPoints) return raw;
  const step = raw.length / maxPoints;
  const compacted: StreamPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(raw.length - 1, Math.floor(i * step));
    compacted.push(raw[idx]);
  }
  if (compacted[compacted.length - 1] !== raw[raw.length - 1]) {
    compacted.push(raw[raw.length - 1]);
  }
  return compacted;
}

function computeGrade(points: StreamPoint[]): void {
  const window = 4;
  for (let i = 0; i < points.length; i++) {
    const prevIdx = Math.max(0, i - window);
    const nextIdx = Math.min(points.length - 1, i + window);
    const dDistM = (points[nextIdx].d - points[prevIdx].d) * 1000;
    const prevEle = points[prevIdx].ele;
    const nextEle = points[nextIdx].ele;
    if (dDistM > 15 && prevEle !== undefined && nextEle !== undefined) {
      const rawGrade = ((nextEle - prevEle) / dDistM) * 100;
      points[i].grade = Number(Math.max(-35, Math.min(35, rawGrade)).toFixed(1));
    }
  }
}

/**
 * Remove non-physiological power sensor / Virtual Power glitches (e.g. 9000W spikes)
 * while preserving genuine hard accelerations and sprints.
 */
export function sanitizePowerStreams(points: StreamPoint[], isEstimated: boolean): number {
  const hardMax = isEstimated ? 1600 : 2200;
  let spikesRemoved = 0;

  // Pass 1: hard physiological & uint16 sentinel bounds
  for (let i = 0; i < points.length; i++) {
    const p = points[i].pwr;
    if (p !== undefined && (p < 0 || p > hardMax)) {
      points[i].pwr = undefined;
      spikesRemoved++;
    }
  }

  // Pass 2: isolated single/double-sample spike compared to local neighbor median
  for (let i = 0; i < points.length; i++) {
    const p = points[i].pwr;
    if (p === undefined || p <= 700) continue;

    const neighbors: number[] = [];
    for (let j = Math.max(0, i - 4); j <= Math.min(points.length - 1, i + 4); j++) {
      if (j === i) continue;
      const np = points[j].pwr;
      if (np !== undefined && np <= hardMax) neighbors.push(np);
    }
    if (neighbors.length < 2) continue;

    neighbors.sort((a, b) => a - b);
    const median = neighbors[Math.floor(neighbors.length / 2)];
    const prev = points[i - 1]?.pwr ?? 0;
    const next = points[i + 1]?.pwr ?? 0;

    if (p > Math.max(850, median * 3.2) && prev < p * 0.55 && next < p * 0.55) {
      points[i].pwr = median > 0 ? Math.round(median) : undefined;
      spikesRemoved++;
    }
  }

  return spikesRemoved;
}

export function computeCleanNormalizedPower(points: StreamPoint[]): number | undefined {
  const valid = points.filter((p) => p.pwr !== undefined);
  if (valid.length < 30) return undefined;

  // Time-based ~30s rolling average raised to 4th power
  let left = 0;
  let sum = 0;
  let dur = 0;
  let pow4Sum = 0;
  let pow4Count = 0;

  for (let right = 1; right < valid.length; right++) {
    const dt = Math.max(1, valid[right].t - valid[right - 1].t);
    sum += (valid[right].pwr ?? 0) * dt;
    dur += dt;

    while (left < right && valid[right].t - valid[left].t > 30) {
      const ldt = Math.max(1, valid[left + 1].t - valid[left].t);
      sum -= (valid[left + 1].pwr ?? 0) * ldt;
      dur -= ldt;
      left++;
    }

    if (dur >= 20) {
      const avg30 = sum / dur;
      pow4Sum += avg30 ** 4;
      pow4Count++;
    }
  }

  if (pow4Count === 0) return undefined;
  return Math.round((pow4Sum / pow4Count) ** 0.25);
}

function decodeBalanceRecord(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0xff) return undefined;
  if (raw > 100 && raw <= 255) {
    const isRight = (raw & 0x80) !== 0;
    const pct = raw & 0x7f;
    if (pct > 100) return undefined;
    return isRight ? 100 - pct : pct;
  }
  if (raw >= 0 && raw <= 100) return Number(raw.toFixed(1));
  return undefined;
}

function decodeBalanceSession(raw: unknown): { left: number; right: number } | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0xffff) return undefined;
  let pct: number;
  let isRight = false;
  if (raw > 1000) {
    isRight = (raw & 0x8000) !== 0;
    pct = (raw & 0x7fff) / 100;
  } else if (raw > 100) {
    isRight = (raw & 0x80) !== 0;
    pct = raw & 0x7f;
  } else {
    pct = raw;
  }
  if (pct <= 0 || pct >= 100) return undefined;
  const left = isRight ? 100 - pct : pct;
  const right = 100 - left;
  return { left: Number(left.toFixed(1)), right: Number(right.toFixed(1)) };
}

function formatDevFieldLabel(rawName: string): string {
  return rawName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseFitBuffer(
  buffer: ArrayBuffer,
  options: {
    fileName?: string;
    existingId?: string;
    source?: ActivitySource;
    maxHr?: number;
    ftpWatts?: number;
  } = {}
): { summary: ActivitySummary; detail: ActivityDetail } {
  const stream = Stream.fromArrayBuffer(buffer);
  if (!Decoder.isFIT(stream)) {
    throw new Error(`Il file ${options.fileName ?? ''} non è un file .FIT valido.`);
  }

  const decoder = new Decoder(stream);
  const { messages } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  });

  const records = (messages.recordMesgs ?? []) as Record<string, unknown>[];
  const session = ((messages.sessionMesgs ?? [])[0] ?? {}) as Record<string, unknown>;
  const rawLaps = (messages.lapMesgs ?? []) as Record<string, unknown>[];
  const fieldDescs = (messages.fieldDescriptionMesgs ?? []) as Record<string, unknown>[];
  const timeInZones = (messages.timeInZoneMesgs ?? []) as Record<string, unknown>[];

  // Discover Connect IQ developer fields (e.g. Garmin Virtual Power & extra sensor fields)
  let recordDevPowerKey: string | null = null;
  let sessionDevAvgPowerKey: string | null = null;
  let sessionDevNpKey: string | null = null;
  let sessionDevMaxPowerKey: string | null = null;
  const extraRecordDevFields: { key: string; label: string; unit: string }[] = [];

  for (const fd of fieldDescs) {
    const key = fd.key !== undefined ? String(fd.key) : null;
    if (!key) continue;
    const rawName = String(fd.fieldName ?? `Campo ${key}`);
    const fname = rawName.toLowerCase();
    const units = String(fd.units ?? '');
    const unitsLower = units.toLowerCase();
    const mesgNum = Number(fd.nativeMesgNum);

    if (mesgNum === 20) {
      if (!recordDevPowerKey && (fname === 'power' || fname.includes('power') || unitsLower.startsWith('watt'))) {
        recordDevPowerKey = key;
      } else {
        extraRecordDevFields.push({
          key,
          label: formatDevFieldLabel(rawName),
          unit: units,
        });
      }
    } else if (mesgNum === 18) {
      if (fname === 'avg_power' || fname.includes('avg_power')) sessionDevAvgPowerKey = key;
      else if (fname === 'normalized_power' || fname.includes('norm')) sessionDevNpKey = key;
      else if (fname === 'max_power') sessionDevMaxPowerKey = key;
    }
  }

  let hasNativePower = false;
  let hasDeveloperPower = false;
  const usedExtraKeys = new Set<string>();

  const firstTimestamp =
    (session.startTime instanceof Date ? session.startTime : undefined) ??
    (records[0]?.timestamp instanceof Date ? (records[0].timestamp as Date) : new Date());

  const startTimeMs = firstTimestamp.getTime();
  const sport = mapFitSport(session.sport, session.subSport);

  const rawStreams: StreamPoint[] = [];
  let fallbackDistKm = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const ts = r.timestamp instanceof Date ? r.timestamp.getTime() : startTimeMs + i * 1000;
    const t = Math.max(0, Math.round((ts - startTimeMs) / 1000));

    const speedMps =
      typeof r.enhancedSpeed === 'number'
        ? r.enhancedSpeed
        : typeof r.speed === 'number'
          ? r.speed
          : undefined;

    let dKm: number;
    if (typeof r.distance === 'number' && Number.isFinite(r.distance)) {
      dKm = r.distance / 1000;
      fallbackDistKm = dKm;
    } else {
      const dt = i > 0 ? Math.max(0, t - rawStreams[rawStreams.length - 1].t) : 0;
      if (speedMps !== undefined) {
        fallbackDistKm += (speedMps * dt) / 1000;
      }
      dKm = fallbackDistKm;
    }

    const eleRaw =
      typeof r.enhancedAltitude === 'number'
        ? r.enhancedAltitude
        : typeof r.altitude === 'number'
          ? r.altitude
          : undefined;

    const hr = typeof r.heartRate === 'number' ? Math.round(r.heartRate) : undefined;
    const rawCad = typeof r.cadence === 'number' ? Math.round(r.cadence) : undefined;
    const cad =
      rawCad !== undefined && (sport === 'running' || sport === 'trail_running')
        ? rawCad * 2
        : rawCad;

    let nativePwr: number | undefined;
    if (typeof r.power === 'number' && Number.isFinite(r.power)) {
      nativePwr = Math.round(r.power);
      hasNativePower = true;
    }

    let devPwr: number | undefined;
    if (recordDevPowerKey && r.developerFields && typeof r.developerFields === 'object') {
      const devVal = (r.developerFields as Record<string, unknown>)[recordDevPowerKey];
      if (typeof devVal === 'number' && Number.isFinite(devVal)) {
        const rounded = Math.round(devVal);
        if (rounded >= 0 && rounded <= 1600) {
          devPwr = rounded;
          hasDeveloperPower = true;
        }
      }
    }

    const pwr = nativePwr ?? devPwr;
    const vPwr = nativePwr !== undefined && devPwr !== undefined ? devPwr : undefined;

    const respRaw =
      typeof r.enhancedRespirationRate === 'number'
        ? r.enhancedRespirationRate
        : typeof r.respirationRate === 'number'
          ? r.respirationRate
          : undefined;
    const resp = respRaw !== undefined ? Number(respRaw.toFixed(1)) : undefined;
    const temp = typeof r.temperature === 'number' ? Number(r.temperature.toFixed(1)) : undefined;

    const lrBal = decodeBalanceRecord(r.leftRightBalance);
    const lTe =
      typeof r.leftTorqueEffectiveness === 'number'
        ? Number(r.leftTorqueEffectiveness.toFixed(1))
        : undefined;
    const rTe =
      typeof r.rightTorqueEffectiveness === 'number'
        ? Number(r.rightTorqueEffectiveness.toFixed(1))
        : undefined;
    const lSm =
      typeof r.leftPedalSmoothness === 'number'
        ? Number(r.leftPedalSmoothness.toFixed(1))
        : undefined;
    const rSm =
      typeof r.rightPedalSmoothness === 'number'
        ? Number(r.rightPedalSmoothness.toFixed(1))
        : undefined;
    const vOsc =
      typeof r.verticalOscillation === 'number'
        ? Number(r.verticalOscillation.toFixed(1))
        : undefined;
    const gct =
      typeof r.stanceTime === 'number' ? Math.round(r.stanceTime) : undefined;
    const stepLen =
      typeof r.stepLength === 'number' ? Number((r.stepLength / 1000).toFixed(2)) : undefined;

    let extra: Record<string, number> | undefined;
    if (extraRecordDevFields.length > 0 && r.developerFields && typeof r.developerFields === 'object') {
      const devObj = r.developerFields as Record<string, unknown>;
      for (const ef of extraRecordDevFields) {
        const v = devObj[ef.key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (!extra) extra = {};
          extra[ef.key] = Number(v.toFixed(2));
          usedExtraKeys.add(ef.key);
        }
      }
    }

    rawStreams.push({
      t,
      d: Number(dKm.toFixed(3)),
      lat: toDeg(r.positionLat),
      lon: toDeg(r.positionLong),
      ele: eleRaw !== undefined ? Number(eleRaw.toFixed(1)) : undefined,
      spd: speedMps !== undefined ? Number((speedMps * 3.6).toFixed(1)) : undefined,
      hr,
      cad,
      pwr,
      vPwr,
      resp,
      temp,
      lrBal,
      lTe,
      rTe,
      lSm,
      rSm,
      vOsc,
      gct,
      stepLen,
      extra,
    });
  }

  computeGrade(rawStreams);
  const isEstimatedStream = !hasNativePower && hasDeveloperPower;
  const powerSpikesRemoved = sanitizePowerStreams(rawStreams, isEstimatedStream);
  const streams = compactStreams(rawStreams);

  const laps: ActivityLap[] = rawLaps.map((lap, idx) => {
    const lapStart = lap.startTime instanceof Date ? lap.startTime.getTime() : startTimeMs;
    const dur =
      typeof lap.totalTimerTime === 'number'
        ? lap.totalTimerTime
        : typeof lap.totalElapsedTime === 'number'
          ? lap.totalElapsedTime
          : 0;
    const dist = typeof lap.totalDistance === 'number' ? lap.totalDistance : 0;
    const avgSpd =
      typeof lap.enhancedAvgSpeed === 'number'
        ? lap.enhancedAvgSpeed
        : typeof lap.avgSpeed === 'number'
          ? lap.avgSpeed
          : dur > 0
            ? dist / dur
            : 0;
    const rawCad = typeof lap.avgCadence === 'number' ? Math.round(lap.avgCadence) : undefined;

    return {
      index: idx + 1,
      startTimeSec: Math.max(0, Math.round((lapStart - startTimeMs) / 1000)),
      durationSec: Math.round(dur),
      distanceMeters: dist,
      avgSpeedMps: avgSpd,
      avgHr: typeof lap.avgHeartRate === 'number' ? Math.round(lap.avgHeartRate) : undefined,
      maxHr: typeof lap.maxHeartRate === 'number' ? Math.round(lap.maxHeartRate) : undefined,
      avgCadence:
        rawCad !== undefined && (sport === 'running' || sport === 'trail_running')
          ? rawCad * 2
          : rawCad,
      avgPower: typeof lap.avgPower === 'number' ? Math.round(lap.avgPower) : undefined,
      elevationGain: typeof lap.totalAscent === 'number' ? Math.round(lap.totalAscent) : undefined,
    };
  });

  const { hrZones: computedHrZones, powerZones } = computeZones(
    rawStreams,
    options.maxHr ?? 190,
    options.ftpWatts ?? 240
  );

  // Prefer official Garmin timeInZoneMesgs when available (index 1..5 = Z1..Z5)
  const sessionZoneMesg = timeInZones.find(
    (z) => String(z.referenceMesg ?? '').toLowerCase() === 'session' && Array.isArray(z.timeInHrZone)
  );
  let hrZones = computedHrZones;
  if (sessionZoneMesg && Array.isArray(sessionZoneMesg.timeInHrZone)) {
    const arr = sessionZoneMesg.timeInHrZone as number[];
    if (arr.length >= 6) {
      hrZones = arr.slice(1, 6).map((v) => Math.round(Number(v) || 0));
    }
  }

  const sessionDevFields =
    session.developerFields && typeof session.developerFields === 'object'
      ? (session.developerFields as Record<string, unknown>)
      : {};

  const devAvgPower =
    sessionDevAvgPowerKey && typeof sessionDevFields[sessionDevAvgPowerKey] === 'number'
      ? Math.round(Number(sessionDevFields[sessionDevAvgPowerKey]))
      : undefined;
  const devNp =
    sessionDevNpKey && typeof sessionDevFields[sessionDevNpKey] === 'number'
      ? Math.round(Number(sessionDevFields[sessionDevNpKey]))
      : undefined;
  const devMaxPower =
    sessionDevMaxPowerKey && typeof sessionDevFields[sessionDevMaxPowerKey] === 'number'
      ? Math.round(Number(sessionDevFields[sessionDevMaxPowerKey]))
      : undefined;

  const isEstimatedPower = !hasNativePower && (hasDeveloperPower || devAvgPower !== undefined);
  const hardPowerCap = isEstimatedPower ? 1600 : 2200;

  const pwrStreamVals = rawStreams.map((p) => p.pwr).filter((v): v is number => v !== undefined);
  const streamAvgPower = pwrStreamVals.length
    ? Math.round(pwrStreamVals.reduce((a, b) => a + b, 0) / pwrStreamVals.length)
    : undefined;
  const streamMaxPower = pwrStreamVals.length ? Math.max(...pwrStreamVals) : undefined;
  const cleanNp = computeCleanNormalizedPower(rawStreams);

  const rawAvgPower =
    typeof session.avgPower === 'number' ? Math.round(session.avgPower) : devAvgPower;
  const finalAvgPower =
    powerSpikesRemoved > 0 || (rawAvgPower !== undefined && rawAvgPower > 1200)
      ? streamAvgPower ?? rawAvgPower
      : rawAvgPower ?? streamAvgPower;

  const rawNp =
    typeof session.normalizedPower === 'number' ? Math.round(session.normalizedPower) : devNp;
  const finalNp =
    powerSpikesRemoved > 0 || (rawNp !== undefined && rawNp > 1200)
      ? cleanNp ?? rawNp
      : rawNp ?? cleanNp;

  const rawMaxPower =
    typeof session.maxPower === 'number' ? Math.round(session.maxPower) : devMaxPower;
  const finalMaxPower =
    powerSpikesRemoved > 0 ||
    (rawMaxPower !== undefined && rawMaxPower > hardPowerCap) ||
    (rawMaxPower !== undefined && streamMaxPower !== undefined && rawMaxPower > streamMaxPower * 1.35)
      ? streamMaxPower
      : rawMaxPower ?? streamMaxPower;

  const sessionBalance = decodeBalanceSession(session.leftRightBalance);
  const extraFields = extraRecordDevFields.filter((ef) => usedExtraKeys.has(ef.key));

  const totalDist =
    typeof session.totalDistance === 'number'
      ? session.totalDistance
      : (rawStreams[rawStreams.length - 1]?.d ?? 0) * 1000;
  const totalDur =
    typeof session.totalElapsedTime === 'number'
      ? session.totalElapsedTime
      : rawStreams[rawStreams.length - 1]?.t ?? 0;
  const movingDur =
    typeof session.totalTimerTime === 'number' ? session.totalTimerTime : totalDur;

  const avgSpeed =
    typeof session.enhancedAvgSpeed === 'number'
      ? session.enhancedAvgSpeed
      : typeof session.avgSpeed === 'number'
        ? session.avgSpeed
        : movingDur > 0
          ? totalDist / movingDur
          : 0;

  const maxSpeed =
    typeof session.enhancedMaxSpeed === 'number'
      ? session.enhancedMaxSpeed
      : typeof session.maxSpeed === 'number'
        ? session.maxSpeed
        : 0;

  const id =
    options.existingId ??
    `fit-${startTimeMs}-${Math.round(totalDist)}-${(options.fileName ?? 'act').replace(/\W+/g, '')}`;

  const cleanName = options.fileName
    ? options.fileName.replace(/\.(fit|zip|gpx|tcx)$/i, '')
    : `${sport.charAt(0).toUpperCase() + sport.slice(1)} ${firstTimestamp.toLocaleDateString('it-IT')}`;

  const hrStreamVals = rawStreams.map((p) => p.hr).filter((v): v is number => v !== undefined && v > 30);
  const eleStreamVals = rawStreams.map((p) => p.ele).filter((v): v is number => v !== undefined);
  const tempStreamVals = rawStreams.map((p) => p.temp).filter((v): v is number => v !== undefined);

  const minHr =
    typeof session.minHeartRate === 'number'
      ? Math.round(session.minHeartRate)
      : hrStreamVals.length > 0
        ? Math.min(...hrStreamVals)
        : undefined;
  const minEle =
    typeof session.enhancedMinAltitude === 'number'
      ? Number(session.enhancedMinAltitude.toFixed(1))
      : typeof session.minAltitude === 'number'
        ? Number(session.minAltitude.toFixed(1))
        : eleStreamVals.length > 0
          ? Number(Math.min(...eleStreamVals).toFixed(1))
          : undefined;
  const maxEle =
    typeof session.enhancedMaxAltitude === 'number'
      ? Number(session.enhancedMaxAltitude.toFixed(1))
      : typeof session.maxAltitude === 'number'
        ? Number(session.maxAltitude.toFixed(1))
        : eleStreamVals.length > 0
          ? Number(Math.max(...eleStreamVals).toFixed(1))
          : undefined;
  const avgTemp =
    typeof session.avgTemperature === 'number'
      ? Number(session.avgTemperature.toFixed(1))
      : tempStreamVals.length > 0
        ? Number((tempStreamVals.reduce((a, b) => a + b, 0) / tempStreamVals.length).toFixed(1))
        : undefined;
  const minTemp =
    typeof session.minTemperature === 'number'
      ? Number(session.minTemperature.toFixed(1))
      : tempStreamVals.length > 0
        ? Number(Math.min(...tempStreamVals).toFixed(1))
        : undefined;
  const maxTemp =
    typeof session.maxTemperature === 'number'
      ? Number(session.maxTemperature.toFixed(1))
      : tempStreamVals.length > 0
        ? Number(Math.max(...tempStreamVals).toFixed(1))
        : undefined;

  const summary: ActivitySummary = {
    id,
    source: options.source ?? 'fit',
    name: cleanName,
    sport,
    startTime: firstTimestamp.toISOString(),
    distanceMeters: totalDist,
    durationSeconds: totalDur,
    movingDurationSeconds: movingDur,
    elevationGainMeters: typeof session.totalAscent === 'number' ? session.totalAscent : 0,
    elevationLossMeters: typeof session.totalDescent === 'number' ? session.totalDescent : 0,
    avgSpeedMps: avgSpeed,
    maxSpeedMps: maxSpeed,
    avgHr: typeof session.avgHeartRate === 'number' ? Math.round(session.avgHeartRate) : undefined,
    maxHr: typeof session.maxHeartRate === 'number' ? Math.round(session.maxHeartRate) : undefined,
    minHr,
    avgCadence: typeof session.avgCadence === 'number' ? Math.round(session.avgCadence) : undefined,
    maxCadence: typeof session.maxCadence === 'number' ? Math.round(session.maxCadence) : undefined,
    minElevationMeters: minEle,
    maxElevationMeters: maxEle,
    avgTempC: avgTemp,
    minTempC: minTemp,
    maxTempC: maxTemp,
    timeStandingSec:
      typeof session.timeStanding === 'number' ? Math.round(session.timeStanding) : undefined,
    standCount: typeof session.standCount === 'number' ? Math.round(session.standCount) : undefined,
    thresholdPowerWatts:
      typeof session.thresholdPower === 'number' ? Math.round(session.thresholdPower) : undefined,
    poolLengthMeters:
      typeof session.poolLength === 'number' ? Number(session.poolLength.toFixed(1)) : undefined,
    activeLengths:
      typeof session.numActiveLengths === 'number' ? Math.round(session.numActiveLengths) : undefined,
    avgSwolf:
      typeof session.avgSwolf === 'number' ? Math.round(session.avgSwolf) : undefined,
    avgPower: finalAvgPower,
    normalizedPower: finalNp,
    maxPower: finalMaxPower,
    isEstimatedPower,
    tss:
      typeof session.trainingStressScore === 'number'
        ? Number(session.trainingStressScore.toFixed(1))
        : undefined,
    intensityFactor:
      typeof session.intensityFactor === 'number'
        ? Number(session.intensityFactor.toFixed(2))
        : undefined,
    totalWorkKj:
      typeof session.totalWork === 'number'
        ? Math.round(session.totalWork / 1000)
        : undefined,
    lrBalanceLeftPct: sessionBalance?.left,
    lrBalanceRightPct: sessionBalance?.right,
    avgLeftTorqueEff:
      typeof session.avgLeftTorqueEffectiveness === 'number'
        ? Number(session.avgLeftTorqueEffectiveness.toFixed(1))
        : undefined,
    avgRightTorqueEff:
      typeof session.avgRightTorqueEffectiveness === 'number'
        ? Number(session.avgRightTorqueEffectiveness.toFixed(1))
        : undefined,
    avgLeftSmoothness:
      typeof session.avgLeftPedalSmoothness === 'number'
        ? Number(session.avgLeftPedalSmoothness.toFixed(1))
        : undefined,
    avgRightSmoothness:
      typeof session.avgRightPedalSmoothness === 'number'
        ? Number(session.avgRightPedalSmoothness.toFixed(1))
        : undefined,
    avgCombinedSmoothness:
      typeof session.avgCombinedPedalSmoothness === 'number'
        ? Number(session.avgCombinedPedalSmoothness.toFixed(1))
        : undefined,
    avgLeftPco: typeof session.avgLeftPco === 'number' ? Math.round(session.avgLeftPco) : undefined,
    avgRightPco:
      typeof session.avgRightPco === 'number' ? Math.round(session.avgRightPco) : undefined,
    avgVerticalOscillationMm:
      typeof session.avgVerticalOscillation === 'number'
        ? Number(session.avgVerticalOscillation.toFixed(1))
        : undefined,
    avgStanceTimeMs:
      typeof session.avgStanceTime === 'number' ? Math.round(session.avgStanceTime) : undefined,
    avgStanceTimeBalancePct:
      typeof session.avgStanceTimeBalance === 'number'
        ? Number(session.avgStanceTimeBalance.toFixed(1))
        : undefined,
    avgStepLengthMm:
      typeof session.avgStepLength === 'number' ? Math.round(session.avgStepLength) : undefined,
    avgVerticalRatioPct:
      typeof session.avgVerticalRatio === 'number'
        ? Number(session.avgVerticalRatio.toFixed(1))
        : undefined,
    extraFields: extraFields.length > 0 ? extraFields : undefined,
    calories: typeof session.totalCalories === 'number' ? Math.round(session.totalCalories) : undefined,
    bmrCalories:
      typeof session.metabolicCalories === 'number'
        ? Math.round(session.metabolicCalories)
        : undefined,
    trainingLoad:
      typeof session.trainingLoadPeak === 'number'
        ? Number(session.trainingLoadPeak.toFixed(1))
        : undefined,
    totalStrokes:
      typeof session.totalStrokes === 'number'
        ? Math.round(session.totalStrokes)
        : typeof session.totalCycles === 'number'
          ? Math.round(session.totalCycles)
          : undefined,
    avgRespiration:
      typeof session.enhancedAvgRespirationRate === 'number'
        ? Number(session.enhancedAvgRespirationRate.toFixed(1))
        : undefined,
    maxRespiration:
      typeof session.enhancedMaxRespirationRate === 'number'
        ? Number(session.enhancedMaxRespirationRate.toFixed(1))
        : undefined,
    minRespiration:
      typeof session.enhancedMinRespirationRate === 'number'
        ? Number(session.enhancedMinRespirationRate.toFixed(1))
        : undefined,
    aerobicTe:
      typeof session.totalTrainingEffect === 'number'
        ? Number(session.totalTrainingEffect.toFixed(1))
        : undefined,
    anaerobicTe:
      typeof session.totalAnaerobicTrainingEffect === 'number'
        ? Number(session.totalAnaerobicTrainingEffect.toFixed(1))
        : undefined,
    hasStreams: streams.length > 0,
    parserVersion: 6,
    hrZonesSeconds: hrZones,
    powerZonesSeconds: powerZones,
    previewCoords: downsampleForPreview(streams),
  };

  return {
    summary,
    detail: {
      activityId: id,
      streams,
      laps,
    },
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseGpxString(
  xmlText: string,
  options: { fileName?: string; maxHr?: number; ftpWatts?: number } = {}
): { summary: ActivitySummary; detail: ActivityDetail } {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  if (trkpts.length === 0) {
    throw new Error(`Nessun punto GPS trovato nel file GPX ${options.fileName ?? ''}`);
  }

  const nameEl = doc.querySelector('trk > name') || doc.querySelector('metadata > name');
  const name =
    nameEl?.textContent?.trim() ||
    (options.fileName ? options.fileName.replace(/\.gpx$/i, '') : 'Attività GPX');

  const streams: StreamPoint[] = [];
  let distM = 0;
  let gain = 0;
  let loss = 0;
  let startMs = 0;

  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = Number(pt.getAttribute('lat'));
    const lon = Number(pt.getAttribute('lon'));
    const eleText = pt.getElementsByTagName('ele')[0]?.textContent;
    const ele = eleText ? Number(eleText) : undefined;
    const timeText = pt.getElementsByTagName('time')[0]?.textContent;
    const ms = timeText ? Date.parse(timeText) : i * 1000;
    if (i === 0) startMs = Number.isFinite(ms) ? ms : Date.now();

    const t = Math.max(0, Math.round(((Number.isFinite(ms) ? ms : startMs + i * 1000) - startMs) / 1000));

    let spdKmh: number | undefined;
    if (i > 0) {
      const prev = streams[streams.length - 1];
      if (prev.lat !== undefined && prev.lon !== undefined) {
        const seg = haversineMeters(prev.lat, prev.lon, lat, lon);
        distM += seg;
        const dt = Math.max(1, t - prev.t);
        spdKmh = Number(((seg / dt) * 3.6).toFixed(1));
      }
      if (ele !== undefined && prev.ele !== undefined) {
        const dEle = ele - prev.ele;
        if (dEle > 0.5) gain += dEle;
        else if (dEle < -0.5) loss += Math.abs(dEle);
      }
    }

    const hrNode =
      pt.getElementsByTagName('gpxtpx:hr')[0] ||
      pt.getElementsByTagName('ns3:hr')[0] ||
      pt.getElementsByTagName('hr')[0];
    const cadNode =
      pt.getElementsByTagName('gpxtpx:cad')[0] ||
      pt.getElementsByTagName('ns3:cad')[0] ||
      pt.getElementsByTagName('cad')[0];

    streams.push({
      t,
      d: Number((distM / 1000).toFixed(3)),
      lat,
      lon,
      ele: ele !== undefined ? Number(ele.toFixed(1)) : undefined,
      spd: spdKmh,
      hr: hrNode?.textContent ? Math.round(Number(hrNode.textContent)) : undefined,
      cad: cadNode?.textContent ? Math.round(Number(cadNode.textContent)) : undefined,
    });
  }

  computeGrade(streams);
  const compacted = compactStreams(streams);
  const dur = streams[streams.length - 1].t || 1;
  const { hrZones } = computeZones(streams, options.maxHr ?? 190, options.ftpWatts ?? 240);
  const startIso = new Date(startMs).toISOString();
  const id = `gpx-${startMs}-${Math.round(distM)}`;

  const hrs = streams.map((p) => p.hr).filter((v): v is number => v !== undefined);

  return {
    summary: {
      id,
      source: 'gpx',
      name,
      sport: 'cycling',
      startTime: startIso,
      distanceMeters: distM,
      durationSeconds: dur,
      movingDurationSeconds: dur,
      elevationGainMeters: Math.round(gain),
      elevationLossMeters: Math.round(loss),
      avgSpeedMps: distM / dur,
      maxSpeedMps: Math.max(...streams.map((p) => (p.spd ?? 0) / 3.6), 0),
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined,
      maxHr: hrs.length ? Math.max(...hrs) : undefined,
      hasStreams: compacted.length > 0,
      hrZonesSeconds: hrZones,
      previewCoords: downsampleForPreview(compacted),
    },
    detail: {
      activityId: id,
      streams: compacted,
      laps: [],
    },
  };
}

export async function parseUploadedFiles(
  files: FileList | File[],
  options: { maxHr?: number; ftpWatts?: number } = {}
): Promise<{
  parsed: { summary: ActivitySummary; detail: ActivityDetail }[];
  errors: string[];
}> {
  const parsed: { summary: ActivitySummary; detail: ActivityDetail }[] = [];
  const errors: string[] = [];

  for (const file of Array.from(files)) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.fit')) {
        const buf = await file.arrayBuffer();
        parsed.push(parseFitBuffer(buf, { fileName: file.name, ...options }));
      } else if (lower.endsWith('.gpx')) {
        const text = await file.text();
        parsed.push(parseGpxString(text, { fileName: file.name, ...options }));
      } else if (lower.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        for (const [entryName, entry] of Object.entries(zip.files)) {
          if (entry.dir) continue;
          const entryLower = entryName.toLowerCase();
          if (entryLower.endsWith('.fit')) {
            const buf = await entry.async('arraybuffer');
            parsed.push(parseFitBuffer(buf, { fileName: entryName.split('/').pop(), ...options }));
          } else if (entryLower.endsWith('.gpx')) {
            const text = await entry.async('string');
            parsed.push(parseGpxString(text, { fileName: entryName.split('/').pop(), ...options }));
          }
        }
      } else {
        errors.push(`${file.name}: formato non supportato (usa .fit, .gpx o .zip)`);
      }
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : 'errore parsing'}`);
    }
  }

  return { parsed, errors };
}

export async function extractFitFromGarminZip(
  zipBuffer: ArrayBuffer,
  options: {
    existingId: string;
    name?: string;
    maxHr?: number;
    ftpWatts?: number;
  }
): Promise<{ summary: ActivitySummary; detail: ActivityDetail }> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const fitEntry = Object.values(zip.files).find(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.fit')
  );
  if (!fitEntry) {
    throw new Error('Nessun file .FIT trovato nello ZIP restituito da Garmin');
  }
  const fitBuf = await fitEntry.async('arraybuffer');
  return parseFitBuffer(fitBuf, {
    existingId: options.existingId,
    fileName: options.name,
    source: 'garmin',
    maxHr: options.maxHr,
    ftpWatts: options.ftpWatts,
  });
}
