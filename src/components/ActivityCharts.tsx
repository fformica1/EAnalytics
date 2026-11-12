import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Activity,
  Flame,
  Gauge,
  Heart,
  Mountain,
  RotateCcw,
  Scale,
  Thermometer,
  TrendingUp,
  Wind,
  Zap,
} from 'lucide-react';
import type { ActivityLap, ActivitySummary, StreamPoint } from '../types/fitness';
import {
  formatDurationHMS,
  formatPaceMinKm,
  isRunningLike,
} from '../utils/formatters';
import { getChartTheme, useIsLightTheme } from '../utils/theme';

interface ActivityChartsProps {
  activity: ActivitySummary;
  streams: StreamPoint[];
  laps?: ActivityLap[];
  onHoverIndex: (idx: number | null) => void;
}

type XAxisMode = 'distance' | 'time';

interface StatColumn {
  label: string;
  value: string;
  unit?: string;
}

interface MetricSeriesDef {
  name: string;
  color: string;
  fill?: boolean;
  renderAs?: 'line' | 'scatter' | 'bar';
  points: [number, number | null][];
}

interface MetricChartDef {
  id: string;
  title: string;
  unit: string;
  icon: React.ReactNode;
  series: MetricSeriesDef[];
  stats: StatColumn[];
  yZeroBase?: boolean;
  formatValue: (v: number) => string;
}

const SYNC_GROUP = 'velopulse-activity-charts';

interface DetectedIntervalBlock {
  kind: 'work' | 'recovery';
  workIndex?: number;
  phaseLabel: string;
  zoneColor: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  avgSignal: number;
  avgVpwr?: number;
  avgHr?: number;
  avgCadence?: number;
  avgGrade?: number;
}

interface AutoIntervalAnalysis {
  signalType: 'pwr' | 'spd' | 'hr';
  unit: string;
  sport: ActivitySummary['sport'];
  running: boolean;
  fromLaps: boolean;
  baseline: number;
  totalDurationSec: number;
  workoutLabel: string;
  blocks: DetectedIntervalBlock[];
  workBlocks: DetectedIntervalBlock[];
  totalWorkSec: number;
  avgWorkSignal: number;
  avgRecoverySignal: number;
}

function getZwiftBlockColor(
  val: number,
  signalType: 'pwr' | 'spd' | 'hr',
  ftpRef: number,
  baseline: number
): string {
  if (signalType === 'pwr') {
    const pct = val / Math.max(100, ftpRef);
    if (pct < 0.56) return '#94a3b8'; // Z1 Gray
    if (pct < 0.76) return '#007CC3'; // Z2 Blue
    if (pct < 0.90) return '#10b981'; // Z3 Green
    if (pct < 1.05) return '#f59e0b'; // Z4 Yellow/Amber
    if (pct < 1.20) return '#f43f5e'; // Z5 Red
    return '#a855f7'; // Z6 Purple
  }
  const ratio = val / Math.max(1, baseline);
  if (ratio < 0.94) return '#94a3b8';
  if (ratio < 1.04) return '#007CC3';
  if (ratio < 1.10) return '#10b981';
  if (ratio < 1.17) return '#f59e0b';
  return '#f43f5e';
}

function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.5)];
}

function coeffOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (mean <= 0) return 0;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

function buildAnalysisFromLaps(
  laps: ActivityLap[],
  streams: StreamPoint[],
  activity: ActivitySummary,
  signalType: 'pwr' | 'spd' | 'hr',
  globalMedian: number,
  estFtp: number,
  running: boolean
): AutoIntervalAnalysis | null {
  if (laps.length < 2) return null;

  // Detect if laps are merely uniform distance auto-laps (e.g. every 1 km or 5 km)
  const nonFinalLaps = laps.length > 2 ? laps.slice(0, -1) : laps;
  const distCv = coeffOfVariation(nonFinalLaps.map((l) => l.distanceMeters || 0));
  const durCvAll = coeffOfVariation(nonFinalLaps.map((l) => l.durationSec || 0));

  const lapMetrics = laps.map((lap) => {
    const startSec = Math.max(0, lap.startTimeSec);
    const endSec = Math.max(startSec + 1, lap.startTimeSec + lap.durationSec);
    const inLap = streams.filter((p) => p.t >= startSec && p.t <= endSec);

    const pwrVals = inLap.map((p) => p.pwr ?? p.vPwr).filter((v): v is number => v !== undefined && v > 0);
    const vpVals = inLap.map((p) => p.vPwr).filter((v): v is number => v !== undefined && v >= 0);
    const spdVals = inLap.map((p) => p.spd).filter((v): v is number => v !== undefined && v > 0);
    const hrVals = inLap.map((p) => p.hr).filter((v): v is number => v !== undefined && v > 35);
    const cadVals = inLap.map((p) => p.cad).filter((v): v is number => v !== undefined && v > 20);
    const gradeVals = inLap.map((p) => p.grade).filter((v): v is number => v !== undefined);

    const avgSignal =
      signalType === 'pwr'
        ? lap.avgPower ?? (pwrVals.length > 0 ? pwrVals.reduce((a, b) => a + b, 0) / pwrVals.length : 0)
        : signalType === 'spd'
          ? (lap.avgSpeedMps > 0 ? lap.avgSpeedMps * 3.6 : spdVals.length > 0 ? spdVals.reduce((a, b) => a + b, 0) / spdVals.length : 0)
          : lap.avgHr ?? (hrVals.length > 0 ? hrVals.reduce((a, b) => a + b, 0) / hrVals.length : 0);

    return {
      lap,
      startSec,
      endSec,
      durationSec: Math.max(1, Math.round(lap.durationSec)),
      avgSignal,
      avgVpwr: vpVals.length > 0 ? Math.round(vpVals.reduce((a, b) => a + b, 0) / vpVals.length) : undefined,
      avgHr: lap.avgHr ?? (hrVals.length > 0 ? Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length) : undefined),
      avgCadence: lap.avgCadence ?? (cadVals.length > 0 ? Math.round(cadVals.reduce((a, b) => a + b, 0) / cadVals.length) : undefined),
      avgGrade: gradeVals.length > 0 ? Number((gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length).toFixed(1)) : undefined,
    };
  });

  const sigCv = coeffOfVariation(lapMetrics.map((m) => m.avgSignal).filter((v) => v > 0));
  // Uniform distance auto-laps with steady intensity -> let stream detector handle it
  if (nonFinalLaps.length >= 3 && distCv < 0.03 && durCvAll < 0.12 && sigCv < 0.1) {
    return null;
  }

  const lapMed = medianOf(lapMetrics.map((m) => m.avgSignal).filter((v) => v > 0)) || globalMedian;
  const maxLapSig = Math.max(...lapMetrics.map((m) => m.avgSignal), 1);
  const workThresh =
    signalType === 'pwr'
      ? Math.max(lapMed * 1.15, estFtp * 0.78)
      : signalType === 'spd'
        ? lapMed * 1.08
        : lapMed * 1.04;

  // If all laps are steady (very low spread), mark top-half/above-threshold laps only if meaningful contrast
  if (maxLapSig < workThresh * 1.03 && sigCv < 0.08) {
    return null;
  }

  const firstWorkIdx = lapMetrics.findIndex((m) => m.avgSignal >= workThresh);
  const lastWorkIdx = lapMetrics.map((m) => m.avgSignal >= workThresh).lastIndexOf(true);
  if (firstWorkIdx < 0) return null;

  let workCounter = 0;
  const blocks: DetectedIntervalBlock[] = lapMetrics.map((m, idx) => {
    const isWork = m.avgSignal >= workThresh;
    if (isWork) workCounter++;
    let phaseLabel = `Lap ${idx + 1}`;
    if (isWork) {
      phaseLabel = `Lavoro #${workCounter}`;
    } else if (idx < firstWorkIdx && m.durationSec >= 90) {
      phaseLabel = 'Riscaldamento';
    } else if (idx > lastWorkIdx && m.durationSec >= 90) {
      phaseLabel = 'Defaticamento';
    } else {
      phaseLabel = 'Recupero';
    }

    return {
      kind: isWork ? 'work' : 'recovery',
      workIndex: isWork ? workCounter : undefined,
      phaseLabel,
      zoneColor: getZwiftBlockColor(m.avgSignal, signalType, estFtp, lapMed),
      startSec: m.startSec,
      endSec: m.endSec,
      durationSec: m.durationSec,
      avgSignal: m.avgSignal,
      avgVpwr: m.avgVpwr,
      avgHr: m.avgHr,
      avgCadence: m.avgCadence,
      avgGrade: m.avgGrade,
    };
  });

  const workBlocks = blocks.filter((b) => b.kind === 'work');
  const recoveryBlocks = blocks.filter((b) => b.kind === 'recovery');
  if (workBlocks.length === 0) return null;

  const totalWorkSec = workBlocks.reduce((s, b) => s + b.durationSec, 0);
  const avgWorkSignal =
    totalWorkSec > 0
      ? workBlocks.reduce((s, b) => s + b.avgSignal * b.durationSec, 0) / totalWorkSec
      : 0;
  const totalRecSec = recoveryBlocks.reduce((s, b) => s + b.durationSec, 0);
  const avgRecoverySignal =
    totalRecSec > 0
      ? recoveryBlocks.reduce((s, b) => s + b.avgSignal * b.durationSec, 0) / totalRecSec
      : lapMed;

  const totalDurationSec = Math.max(
    streams[streams.length - 1]?.t ?? 0,
    blocks[blocks.length - 1]?.endSec ?? 0,
    activity.durationSeconds || 1
  );

  const unit = signalType === 'pwr' ? 'W' : signalType === 'spd' ? 'km/h' : 'bpm';
  return {
    signalType,
    unit,
    sport: activity.sport,
    running,
    fromLaps: true,
    baseline: lapMed,
    totalDurationSec,
    workoutLabel: `${workBlocks.length} lavori da Lap`,
    blocks,
    workBlocks,
    totalWorkSec,
    avgWorkSignal,
    avgRecoverySignal,
  };
}

function detectAutoIntervals(
  streams: StreamPoint[],
  activity: ActivitySummary,
  laps: ActivityLap[] = []
): AutoIntervalAnalysis | null {
  const running = isRunningLike(activity.sport);
  const isSwim = activity.sport === 'swimming';
  const minSpdFilter = isSwim ? 0.8 : 1.5;

  const pwrValid = streams.filter((p) => (p.pwr ?? p.vPwr ?? 0) > 20);
  const spdValid = streams.filter((p) => (p.spd ?? 0) > minSpdFilter);
  const hrValid = streams.filter((p) => (p.hr ?? 0) > 60);

  const lapHasPwr = laps.some((l) => (l.avgPower ?? 0) > 20);
  const lapHasSpd = laps.some((l) => (l.avgSpeedMps ?? 0) > 0.25);
  const lapHasHr = laps.some((l) => (l.avgHr ?? 0) > 60);

  const signalType: 'pwr' | 'spd' | 'hr' | null =
    pwrValid.length >= 25 || (laps.length >= 2 && lapHasPwr)
      ? 'pwr'
      : spdValid.length >= 25 || (laps.length >= 2 && lapHasSpd)
        ? 'spd'
        : hrValid.length >= 25 || (laps.length >= 2 && lapHasHr)
          ? 'hr'
          : null;
  if (!signalType) return null;

  // Priority 1: Use device/manual structured Laps even if streams are sparse (e.g. pool swim)
  if (laps.length >= 2) {
    const lapFallbackMed =
      signalType === 'pwr'
        ? activity.avgPower ?? 180
        : signalType === 'spd'
          ? (activity.avgSpeedMps > 0 ? activity.avgSpeedMps * 3.6 : isSwim ? 2.8 : 10)
          : activity.avgHr ?? 140;
    const estFtpFromActivity =
      activity.normalizedPower && activity.intensityFactor && activity.intensityFactor > 0.2
        ? Math.round(activity.normalizedPower / activity.intensityFactor)
        : Math.max(180, Math.round(lapFallbackMed * 1.25));
    const lapBased = buildAnalysisFromLaps(
      laps,
      streams,
      activity,
      signalType,
      lapFallbackMed,
      estFtpFromActivity,
      running
    );
    if (lapBased) return lapBased;
  }

  if (streams.length < 30) return null;

  // Grade-adjusted effort for speed (downhills penalized, climbs fairly weighted)
  // For power, uses real power when present and falls back to Virtual Power if dropout/estimated
  const rawDisplayVals = streams.map((p) =>
    signalType === 'pwr'
      ? (p.pwr ?? p.vPwr ?? 0)
      : signalType === 'spd'
        ? (p.spd ?? 0)
        : (p.hr ?? 0)
  );
  const effortVals = streams.map((p, i) => {
    const v = rawDisplayVals[i];
    if (v <= 0) return 0;
    if (signalType === 'spd' && p.grade !== undefined) {
      const gradeFactor = Math.max(0.65, Math.min(1.55, 1 + p.grade * 0.032));
      return v * gradeFactor;
    }
    return v;
  });

  // ~10s rolling smoothed effort signal
  const smoothed = effortVals.map((_, i) => {
    const tCenter = streams[i].t;
    let sum = 0;
    let cnt = 0;
    for (let j = i; j >= 0 && tCenter - streams[j].t <= 5; j--) {
      if (effortVals[j] > 0) {
        sum += effortVals[j];
        cnt++;
      }
    }
    for (let j = i + 1; j < streams.length && streams[j].t - tCenter <= 5; j++) {
      if (effortVals[j] > 0) {
        sum += effortVals[j];
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : 0;
  });

  const activeEffort = smoothed.filter((v) => v > 0);
  if (activeEffort.length < 20) return null;
  const globalMedian = medianOf(activeEffort);
  if (globalMedian <= 0) return null;

  const estFtp =
    activity.normalizedPower && activity.intensityFactor && activity.intensityFactor > 0.2
      ? Math.round(activity.normalizedPower / activity.intensityFactor)
      : Math.max(180, Math.round(globalMedian * 1.28));

  const spdMedian = medianOf(
    streams.map((p) => p.spd ?? 0).filter((v) => v > minSpdFilter)
  );
  const maxHrRef = activity.maxHr ?? 190;

  // Local rolling baseline (±7 min) blended with global median to reject slow fatigue/cardiac drift
  const windowStep = Math.max(1, Math.floor(streams.length / 80));
  const localBaselines = smoothed.map((_, i) => {
    const tCenter = streams[i].t;
    const local: number[] = [];
    for (let j = 0; j < streams.length; j += windowStep) {
      if (Math.abs(streams[j].t - tCenter) <= 420 && smoothed[j] > 0) {
        local.push(smoothed[j]);
      }
    }
    const localMed = local.length >= 6 ? medianOf(local) : globalMedian;
    return globalMedian * 0.55 + localMed * 0.45;
  });

  // Compute hysteresis (Schmitt-trigger) start/end thresholds tuned per sport
  // (running/swimming pace surges are tighter % than cycling watts).
  const isPaceSport = running || isSwim;
  const minWorkSec = isPaceSport ? 20 : 30;
  const runDetector = (strictMult: number) => {
    const startThreshold =
      signalType === 'pwr'
        ? Math.max(globalMedian * 1.38 * strictMult, globalMedian + 55 * strictMult)
        : signalType === 'spd'
          ? globalMedian * (isPaceSport ? 1.11 : 1.18) * strictMult
          : Math.max(globalMedian * (isPaceSport ? 1.07 : 1.1) * strictMult, maxHrRef * 0.78);
    const endThreshold =
      signalType === 'pwr'
        ? Math.max(globalMedian * 1.15, globalMedian + 22)
        : signalType === 'spd'
          ? globalMedian * (isPaceSport ? 1.04 : 1.07)
          : Math.max(globalMedian * 1.03, maxHrRef * 0.73);

    // 2-state Schmitt trigger using blended local+global reference
    const stateWork = new Array<boolean>(streams.length).fill(false);
    let inWork = false;
    for (let i = 0; i < streams.length; i++) {
      const refRatio = localBaselines[i] / (globalMedian || 1);
      const up = startThreshold * (0.6 + 0.4 * refRatio);
      const down = endThreshold * (0.6 + 0.4 * refRatio);
      if (!inWork && smoothed[i] >= up) inWork = true;
      else if (inWork && smoothed[i] <= down) inWork = false;
      stateWork[i] = inWork;
    }

    const spans: { kind: 'work' | 'recovery'; startIdx: number; endIdx: number }[] = [];
    let sStart = 0;
    for (let i = 1; i <= stateWork.length; i++) {
      if (i === stateWork.length || stateWork[i] !== stateWork[sStart]) {
        spans.push({
          kind: stateWork[sStart] ? 'work' : 'recovery',
          startIdx: sStart,
          endIdx: i - 1,
        });
        sStart = i;
      }
    }

    // Merge brief <= 10s recovery dips inside an effort
    const merged: typeof spans = [];
    for (const sp of spans) {
      const dur = streams[sp.endIdx].t - streams[sp.startIdx].t;
      const prev = merged[merged.length - 1];
      if (sp.kind === 'recovery' && dur <= 10 && prev?.kind === 'work') {
        prev.endIdx = sp.endIdx;
      } else if (prev && prev.kind === sp.kind) {
        prev.endIdx = sp.endIdx;
      } else {
        merged.push({ ...sp });
      }
    }
    return merged;
  };

  let mergedSpans = runDetector(1.0);
  // If too many noisy fragments (> 18 work candidates), tighten threshold once
  const rawWorkCount = mergedSpans.filter(
    (s) => s.kind === 'work' && streams[s.endIdx].t - streams[s.startIdx].t >= minWorkSec
  ).length;
  if (rawWorkCount > 18) {
    mergedSpans = runDetector(1.12);
  }

  // Validate candidate work spans (>= minWorkSec, slope, HR lag response, anti-fatigue)
  const validatedSpans = mergedSpans.map((sp) => {
    const dur = streams[sp.endIdx].t - streams[sp.startIdx].t;
    if (sp.kind !== 'work' || dur < minWorkSec) {
      return { ...sp, kind: 'recovery' as const };
    }

    let sigSum = 0;
    let sigCnt = 0;
    let spdSum = 0;
    let spdCnt = 0;
    let gradeSum = 0;
    let gradeCnt = 0;
    let lateHrSum = 0;
    let lateHrCnt = 0;
    const midIdx = Math.floor((sp.startIdx + sp.endIdx) / 2);
    const endTimePlusLag = streams[sp.endIdx].t + 10;

    for (let i = sp.startIdx; i <= sp.endIdx; i++) {
      if (rawDisplayVals[i] > 0) {
        sigSum += rawDisplayVals[i];
        sigCnt++;
      }
      if ((streams[i].spd ?? 0) > 1) {
        spdSum += streams[i].spd!;
        spdCnt++;
      }
      if (streams[i].grade !== undefined) {
        gradeSum += streams[i].grade!;
        gradeCnt++;
      }
    }
    for (let i = midIdx; i < streams.length && streams[i].t <= endTimePlusLag; i++) {
      if ((streams[i].hr ?? 0) > 35) {
        lateHrSum += streams[i].hr!;
        lateHrCnt++;
      }
    }

    // Pre-interval 30s HR baseline
    let preHrSum = 0;
    let preHrCnt = 0;
    const startT = streams[sp.startIdx].t;
    for (let i = sp.startIdx - 1; i >= 0 && startT - streams[i].t <= 30; i--) {
      if ((streams[i].hr ?? 0) > 35) {
        preHrSum += streams[i].hr!;
        preHrCnt++;
      }
    }

    const avgSig = sigCnt > 0 ? sigSum / sigCnt : 0;
    const avgSpd = spdCnt > 0 ? spdSum / spdCnt : 0;
    const avgGrade = gradeCnt > 0 ? gradeSum / gradeCnt : undefined;
    const lateHr = lateHrCnt > 0 ? lateHrSum / lateHrCnt : undefined;
    const preHr = preHrCnt > 0 ? preHrSum / preHrCnt : undefined;

    // 1. Reject downhill coasting false positives when using speed without power
    if (signalType === 'spd' && avgGrade !== undefined && avgGrade < -1.5) {
      return { ...sp, kind: 'recovery' as const };
    }
    // 2. Reject HR-only drift when speed actually dropped below baseline
    if (signalType === 'hr' && spdMedian > 0 && avgSpd > 0 && avgSpd < spdMedian * 0.92) {
      return { ...sp, kind: 'recovery' as const };
    }
    // 3. Require physiological response for >= 35s mild blocks when HR sensor is active
    if (
      dur >= 35 &&
      lateHr !== undefined &&
      preHr !== undefined &&
      lateHr - preHr < 2 &&
      lateHr < maxHrRef * 0.68 &&
      avgSig < globalMedian * 1.25
    ) {
      return { ...sp, kind: 'recovery' as const };
    }

    return sp;
  });

  // Coalesce adjacent recovery blocks
  const cleanSpans: typeof mergedSpans = [];
  for (const sp of validatedSpans) {
    const prev = cleanSpans[cleanSpans.length - 1];
    if (prev && prev.kind === sp.kind) {
      prev.endIdx = sp.endIdx;
    } else {
      cleanSpans.push({ ...sp });
    }
  }

  // Filter outlier tiny work blips when >= 3 work blocks exist (e.g. a 32s blip among 4m repeats)
  const candWorkDurs = cleanSpans
    .filter((s) => s.kind === 'work')
    .map((s) => streams[s.endIdx].t - streams[s.startIdx].t);
  const medWorkDur = medianOf(candWorkDurs);
  if (candWorkDurs.length >= 3 && medWorkDur >= 60) {
    for (let i = 0; i < cleanSpans.length; i++) {
      const d = streams[cleanSpans[i].endIdx].t - streams[cleanSpans[i].startIdx].t;
      if (cleanSpans[i].kind === 'work' && d < medWorkDur * 0.3) {
        cleanSpans[i].kind = 'recovery';
      }
    }
  }

  // Cluster concentrated interval sets (max 10 min recovery gap inside a set)
  // and keep only the main concentrated training set(s) instead of isolated stray efforts
  const workIndicesInClean = cleanSpans
    .map((s, idx) => (s.kind === 'work' ? idx : -1))
    .filter((idx) => idx >= 0);

  if (workIndicesInClean.length >= 3) {
    const sets: number[][] = [[workIndicesInClean[0]]];
    for (let k = 1; k < workIndicesInClean.length; k++) {
      const prevWorkIdx = workIndicesInClean[k - 1];
      const currWorkIdx = workIndicesInClean[k];
      const gapSec = streams[cleanSpans[currWorkIdx].startIdx].t - streams[cleanSpans[prevWorkIdx].endIdx].t;
      if (gapSec <= 600) {
        sets[sets.length - 1].push(currWorkIdx);
      } else {
        sets.push([currWorkIdx]);
      }
    }
    const multiBlockSets = sets.filter((st) => st.length >= 2);
    if (multiBlockSets.length > 0) {
      const keepSet = new Set(multiBlockSets.flat());
      for (const wi of workIndicesInClean) {
        if (!keepSet.has(wi)) {
          cleanSpans[wi].kind = 'recovery';
        }
      }
    }
  }

  // Final coalesce after outlier + set clustering
  const finalSpans: typeof mergedSpans = [];
  for (const sp of cleanSpans) {
    const prev = finalSpans[finalSpans.length - 1];
    if (prev && prev.kind === sp.kind) {
      prev.endIdx = sp.endIdx;
    } else {
      finalSpans.push({ ...sp });
    }
  }

  // Keep the entire outing timeline (0 -> end) so warm-up & cool-down appear as
  // wide steady Zwift-style blocks and concentrated intervals stand out proportionally.
  const firstWorkSpanIdx = finalSpans.findIndex((s) => s.kind === 'work');
  const lastWorkSpanIdx = finalSpans.map((s) => s.kind).lastIndexOf('work');
  if (firstWorkSpanIdx < 0 || lastWorkSpanIdx < 0) return null;

  let workCounter = 0;
  const blocks: DetectedIntervalBlock[] = finalSpans
    .map((sp, spanIdx) => {
      const startSec = streams[sp.startIdx].t;
      const endSec = streams[sp.endIdx].t;
      const durationSec = Math.max(1, endSec - startSec);
      let sigSum = 0;
      let sigCnt = 0;
      let vpSum = 0;
      let vpCnt = 0;
      let hrSum = 0;
      let hrCnt = 0;
      let cadSum = 0;
      let cadCnt = 0;
      let gradeSum = 0;
      let gradeCnt = 0;

      for (let i = sp.startIdx; i <= sp.endIdx; i++) {
        if (rawDisplayVals[i] > 0) {
          sigSum += rawDisplayVals[i];
          sigCnt++;
        }
        const vp = streams[i].vPwr;
        if (vp !== undefined && vp >= 0) {
          vpSum += vp;
          vpCnt++;
        }
        const hr = streams[i].hr;
        if (hr && hr > 35) {
          hrSum += hr;
          hrCnt++;
        }
        const cad = streams[i].cad;
        if (cad && cad > 20) {
          cadSum += cad;
          cadCnt++;
        }
        const gr = streams[i].grade;
        if (gr !== undefined) {
          gradeSum += gr;
          gradeCnt++;
        }
      }
      const isWorkBlock = sp.kind === 'work';
      if (isWorkBlock) workCounter++;
      const avgSignal = sigCnt > 0 ? sigSum / sigCnt : 0;

      let phaseLabel = 'Recupero';
      if (isWorkBlock) {
        phaseLabel = `Lavoro #${workCounter}`;
      } else if (spanIdx < firstWorkSpanIdx && durationSec >= 90) {
        phaseLabel = 'Riscaldamento';
      } else if (spanIdx > lastWorkSpanIdx && durationSec >= 90) {
        phaseLabel = 'Defaticamento';
      }

      return {
        kind: sp.kind,
        workIndex: isWorkBlock ? workCounter : undefined,
        phaseLabel,
        zoneColor: getZwiftBlockColor(avgSignal, signalType, estFtp, globalMedian),
        startSec,
        endSec,
        durationSec,
        avgSignal,
        avgVpwr: vpCnt > 0 ? Math.round(vpSum / vpCnt) : undefined,
        avgHr: hrCnt > 0 ? Math.round(hrSum / hrCnt) : undefined,
        avgCadence: cadCnt > 0 ? Math.round(cadSum / cadCnt) : undefined,
        avgGrade: gradeCnt > 0 ? Number((gradeSum / gradeCnt).toFixed(1)) : undefined,
      };
    })
    .filter((b) => b.durationSec >= 10);

  const workBlocks = blocks.filter((b) => b.kind === 'work');
  const recoveryBlocks = blocks.filter((b) => b.kind === 'recovery');

  // Reject unstructured free rides that still produce > 20 scattered fragments
  if (workBlocks.length > 20) return null;

  // Require true recurrence (>= 2 intervals) or a single sustained >= 120s high-intensity block
  if (workBlocks.length < 2 && !(workBlocks.length === 1 && workBlocks[0].durationSec >= 120)) {
    return null;
  }

  // Classify workout structure based on recurrence & slope parity
  const workGrades = workBlocks
    .map((b) => b.avgGrade)
    .filter((g): g is number => g !== undefined);
  const gradeSpread =
    workGrades.length >= 2 ? Math.max(...workGrades) - Math.min(...workGrades) : 99;
  const meanGrade =
    workGrades.length > 0 ? workGrades.reduce((a, b) => a + b, 0) / workGrades.length : 0;
  const durCv = coeffOfVariation(workBlocks.map((b) => b.durationSec));
  const sigCv = coeffOfVariation(workBlocks.map((b) => b.avgSignal));

  let workoutLabel = 'Variazioni di ritmo';
  if (workBlocks.length >= 2 && gradeSpread <= 2.8) {
    if (meanGrade >= 2.2) workoutLabel = 'Ripetute in salita';
    else workoutLabel = 'Ripetute in pianura';
  } else if (workBlocks.length >= 3 && durCv <= 0.35 && sigCv <= 0.22) {
    workoutLabel = 'Lavoro strutturato';
  }

  const totalWorkSec = workBlocks.reduce((s, b) => s + b.durationSec, 0);
  const avgWorkSignal =
    totalWorkSec > 0
      ? workBlocks.reduce((s, b) => s + b.avgSignal * b.durationSec, 0) / totalWorkSec
      : 0;
  const totalRecSec = recoveryBlocks.reduce((s, b) => s + b.durationSec, 0);
  const avgRecoverySignal =
    totalRecSec > 0
      ? recoveryBlocks.reduce((s, b) => s + b.avgSignal * b.durationSec, 0) / totalRecSec
      : globalMedian;

  const totalDurationSec = Math.max(
    streams[streams.length - 1]?.t ?? 0,
    blocks[blocks.length - 1]?.endSec ?? 0,
    1
  );

  const unit = signalType === 'pwr' ? 'W' : signalType === 'spd' ? 'km/h' : 'bpm';
  return {
    signalType,
    unit,
    sport: activity.sport,
    running,
    fromLaps: false,
    baseline: globalMedian,
    totalDurationSec,
    workoutLabel,
    blocks,
    workBlocks,
    totalWorkSec,
    avgWorkSignal,
    avgRecoverySignal,
  };
}

function computeNumericStats(vals: number[]): {
  min: number;
  avg: number;
  max: number;
} | null {
  if (vals.length === 0) return null;
  let min = vals[0];
  let max = vals[0];
  let sum = 0;
  for (const v of vals) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    min,
    avg: sum / vals.length,
    max,
  };
}

function findNearestStreamIndex(
  streams: StreamPoint[],
  xVal: number,
  xMode: XAxisMode
): number {
  let lo = 0;
  let hi = streams.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const midVal = xMode === 'distance' ? streams[mid].d : streams[mid].t;
    if (midVal < xVal) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const prevVal = xMode === 'distance' ? streams[lo - 1].d : streams[lo - 1].t;
    const curVal = xMode === 'distance' ? streams[lo].d : streams[lo].t;
    if (Math.abs(prevVal - xVal) < Math.abs(curVal - xVal)) {
      return lo - 1;
    }
  }
  return lo;
}

export function ActivityCharts({
  activity,
  streams,
  laps = [],
  onHoverIndex,
}: ActivityChartsProps) {
  const [xMode, setXMode] = useState<XAxisMode>('distance');
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 100]);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  const lastIdxRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const running = isRunningLike(activity.sport);

  const scheduleHoverIdx = useCallback(
    (nextIdx: number | null) => {
      if (lastIdxRef.current === nextIdx) return;
      lastIdxRef.current = nextIdx;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        onHoverIndex(nextIdx);
      });
    },
    [onHoverIndex]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const xBounds = useMemo(() => {
    if (streams.length === 0) return { min: 0, max: 1 };
    const first = xMode === 'distance' ? streams[0].d : streams[0].t;
    const last =
      xMode === 'distance'
        ? streams[streams.length - 1].d
        : streams[streams.length - 1].t;
    return {
      min: first,
      max: last > first ? last : first + 1,
    };
  }, [streams, xMode]);

  const visibleDomain = useMemo<[number, number]>(() => {
    const span = xBounds.max - xBounds.min;
    const start = xBounds.min + (span * zoomRange[0]) / 100;
    const end = xBounds.min + (span * zoomRange[1]) / 100;
    return [start, Math.max(start + 0.01, end)];
  }, [xBounds, zoomRange]);

  const metrics = useMemo<MetricChartDef[]>(() => {
    if (streams.length === 0) return [];
    const getX = (p: StreamPoint) => (xMode === 'distance' ? p.d : p.t);
    const defs: MetricChartDef[] = [];

    // 1. Altitudine
    const eleVals = streams.map((p) => p.ele).filter((v): v is number => v !== undefined);
    const eleStats = computeNumericStats(eleVals);
    if (eleStats) {
      defs.push({
        id: 'ele',
        title: 'Altitudine',
        unit: 'm',
        icon: <Mountain className="h-4 w-4 text-slate-300" />,
        series: [
          {
            name: 'Altitudine',
            color: '#94a3b8',
            fill: true,
            points: streams.map((p) => [getX(p), p.ele ?? null]),
          },
        ],
        formatValue: (v) => `${Math.round(v)} m`,
        stats: [
          { label: 'Dislivello D+', value: `+${Math.round(activity.elevationGainMeters)}`, unit: 'm' },
          { label: 'Quota Max', value: `${Math.round(eleStats.max)}`, unit: 'm' },
          { label: 'Quota Media', value: `${Math.round(eleStats.avg)}`, unit: 'm' },
          { label: 'Quota Min', value: `${Math.round(eleStats.min)}`, unit: 'm' },
        ],
      });
    }

    // 2. Velocità / Passo
    const spdVals = streams.map((p) => p.spd).filter((v): v is number => v !== undefined && v > 0);
    const spdStats = computeNumericStats(spdVals);
    if (spdStats) {
      const avgKmh = activity.avgSpeedMps > 0 ? activity.avgSpeedMps * 3.6 : spdStats.avg;
      const maxKmh =
        activity.maxSpeedMps > 0
          ? Math.max(activity.maxSpeedMps * 3.6, spdStats.max)
          : spdStats.max;

      const stats: StatColumn[] = running
        ? [
            {
              label: 'Passo Medio',
              value: formatPaceMinKm(avgKmh / 3.6).replace(' /km', ''),
              unit: '/km',
            },
            {
              label: 'Passo Best',
              value: formatPaceMinKm(maxKmh / 3.6).replace(' /km', ''),
              unit: '/km',
            },
            { label: 'Vel Media', value: avgKmh.toFixed(1), unit: 'km/h' },
            { label: 'Vel Max', value: maxKmh.toFixed(1), unit: 'km/h' },
          ]
        : [
            { label: 'Vel Media', value: avgKmh.toFixed(1), unit: 'km/h' },
            { label: 'Vel Max', value: maxKmh.toFixed(1), unit: 'km/h' },
            { label: 'Vel Min', value: spdStats.min.toFixed(1), unit: 'km/h' },
          ];

      defs.push({
        id: 'spd',
        title: running ? 'Passo & Velocità' : 'Velocità',
        unit: 'km/h',
        icon: <Gauge className="h-4 w-4 text-sky-400" />,
        series: [
          {
            name: 'Velocità',
            color: '#38bdf8',
            fill: true,
            points: streams.map((p) => [getX(p), p.spd ?? null]),
          },
        ],
        yZeroBase: true,
        formatValue: (v) =>
          running
            ? `${v.toFixed(1)} km/h (${formatPaceMinKm(v / 3.6)})`
            : `${v.toFixed(1)} km/h`,
        stats,
      });
    }

    // 3. Frequenza Cardiaca
    const hrVals = streams.map((p) => p.hr).filter((v): v is number => v !== undefined && v > 30);
    const hrStats = computeNumericStats(hrVals);
    if (hrStats) {
      const avgHr = activity.avgHr ?? Math.round(hrStats.avg);
      const maxHr = activity.maxHr ?? Math.round(hrStats.max);
      defs.push({
        id: 'hr',
        title: 'Frequenza Cardiaca',
        unit: 'bpm',
        icon: <Heart className="h-4 w-4 text-rose-400" />,
        series: [
          {
            name: 'FC',
            color: '#f43f5e',
            fill: true,
            points: streams.map((p) => [getX(p), p.hr ?? null]),
          },
        ],
        formatValue: (v) => `${Math.round(v)} bpm`,
        stats: [
          { label: 'FC Media', value: `${avgHr}`, unit: 'bpm' },
          { label: 'FC Max', value: `${maxHr}`, unit: 'bpm' },
          { label: 'FC Min', value: `${Math.round(hrStats.min)}`, unit: 'bpm' },
          ...(activity.calories
            ? [{ label: 'Calorie', value: `${activity.calories}`, unit: 'kcal' }]
            : []),
        ],
      });
    }

    // 4. Potenza (Reale e/o Virtual Power insieme)
    const powerCap = activity.isEstimatedPower ? 1600 : 2200;
    const pwrVals = streams
      .map((p) => p.pwr)
      .filter((v): v is number => v !== undefined && v >= 0 && v <= powerCap);
    const vPwrVals = streams
      .map((p) => p.vPwr)
      .filter((v): v is number => v !== undefined && v >= 0 && v <= 1600);
    const pwrStats = computeNumericStats(pwrVals);
    const vPwrStats = computeNumericStats(vPwrVals);
    if ((pwrStats && pwrStats.max > 0) || (vPwrStats && vPwrStats.max > 0)) {
      const hasDualPower = Boolean(pwrStats && vPwrStats && vPwrVals.length >= 10);
      const primaryStats = pwrStats ?? vPwrStats!;
      const nonZeroPwr = (pwrVals.length > 0 ? pwrVals : vPwrVals).filter((v) => v > 0);
      const avgNonZero =
        nonZeroPwr.length > 0
          ? Math.round(nonZeroPwr.reduce((a, b) => a + b, 0) / nonZeroPwr.length)
          : Math.round(primaryStats.avg);

      const powerSeries: MetricSeriesDef[] = [];
      if (pwrStats) {
        powerSeries.push({
          name: activity.isEstimatedPower ? 'Virtual Power' : hasDualPower ? 'Potenza Reale' : 'Potenza',
          color: '#a855f7',
          fill: true,
          points: streams.map((p) => [
            getX(p),
            p.pwr !== undefined && p.pwr >= 0 && p.pwr <= powerCap ? p.pwr : null,
          ]),
        });
      }
      if (hasDualPower || (!pwrStats && vPwrStats)) {
        powerSeries.push({
          name: 'Virtual Power',
          color: '#007CC3',
          fill: !pwrStats,
          points: streams.map((p) => [
            getX(p),
            p.vPwr !== undefined && p.vPwr >= 0 && p.vPwr <= 1600 ? p.vPwr : null,
          ]),
        });
      }

      defs.push({
        id: 'pwr',
        title: hasDualPower
          ? 'Potenza Reale vs Virtual Power'
          : activity.isEstimatedPower
            ? 'Potenza Stimata (Virtual Power)'
            : 'Potenza',
        unit: 'W',
        icon: <Zap className="h-4 w-4 text-purple-400" />,
        series: powerSeries,
        yZeroBase: true,
        formatValue: (v) => `${Math.round(v)} W`,
        stats: [
          {
            label: hasDualPower ? 'Media Reale' : 'Pot. Media',
            value: `${activity.avgPower ?? Math.round(primaryStats.avg)}`,
            unit: 'W',
          },
          ...(hasDualPower && vPwrStats
            ? [{ label: 'Media Virtual', value: `${Math.round(vPwrStats.avg)}`, unit: 'W' }]
            : []),
          ...(activity.normalizedPower
            ? [{ label: 'NP', value: `${activity.normalizedPower}`, unit: 'W' }]
            : []),
          { label: 'Media (>0)', value: `${avgNonZero}`, unit: 'W' },
          {
            label: 'Pot. Max',
            value: `${activity.maxPower ?? Math.round(primaryStats.max)}`,
            unit: 'W',
          },
        ],
      });
    }

    // 5. Cadenza
    const cadVals = streams.map((p) => p.cad).filter((v): v is number => v !== undefined && v > 0);
    const cadStats = computeNumericStats(cadVals);
    if (cadStats) {
      const unit = running ? 'spm' : 'rpm';
      defs.push({
        id: 'cad',
        title: 'Cadenza',
        unit,
        icon: <Flame className="h-4 w-4 text-emerald-400" />,
        series: [
          {
            name: 'Cadenza',
            color: '#10b981',
            renderAs: 'scatter',
            points: streams.map((p) => [getX(p), p.cad ?? null]),
          },
        ],
        yZeroBase: true,
        formatValue: (v) => `${Math.round(v)} ${unit}`,
        stats: [
          { label: 'Cad. Media', value: `${activity.avgCadence ?? Math.round(cadStats.avg)}`, unit },
          { label: 'Cad. Max', value: `${activity.maxCadence ?? Math.round(cadStats.max)}`, unit },
          { label: 'Cad. Min', value: `${Math.round(cadStats.min)}`, unit },
        ],
      });
    }

    // 6. Bilanciamento Sx/Dx (Cycling Dynamics)
    const lrVals = streams.map((p) => p.lrBal).filter((v): v is number => v !== undefined);
    const lrStats = computeNumericStats(lrVals);
    if (lrStats) {
      const leftAvg = activity.lrBalanceLeftPct ?? lrStats.avg;
      const rightAvg = activity.lrBalanceRightPct ?? 100 - leftAvg;
      defs.push({
        id: 'lrBal',
        title: 'Bilanciamento Pedalata (Sx %)',
        unit: '%',
        icon: <Scale className="h-4 w-4 text-sky-400" />,
        series: [
          {
            name: 'Sinistra %',
            color: '#38bdf8',
            renderAs: 'scatter',
            points: streams.map((p) => [getX(p), p.lrBal ?? null]),
          },
        ],
        formatValue: (v) => `Sx ${v.toFixed(1)}% / Dx ${(100 - v).toFixed(1)}%`,
        stats: [
          { label: 'Media Sx', value: leftAvg.toFixed(1), unit: '%' },
          { label: 'Media Dx', value: rightAvg.toFixed(1), unit: '%' },
          { label: 'Min Sx', value: lrStats.min.toFixed(1), unit: '%' },
          { label: 'Max Sx', value: lrStats.max.toFixed(1), unit: '%' },
        ],
      });
    }

    // 7. Efficienza di Coppia (Left & Right)
    const lTeVals = streams.map((p) => p.lTe).filter((v): v is number => v !== undefined);
    const rTeVals = streams.map((p) => p.rTe).filter((v): v is number => v !== undefined);
    if (lTeVals.length > 0 || rTeVals.length > 0) {
      const lStats = computeNumericStats(lTeVals);
      const rStats = computeNumericStats(rTeVals);
      const series: MetricSeriesDef[] = [];
      if (lTeVals.length > 0) {
        series.push({
          name: 'Sx',
          color: '#38bdf8',
          renderAs: 'scatter',
          points: streams.map((p) => [getX(p), p.lTe ?? null]),
        });
      }
      if (rTeVals.length > 0) {
        series.push({
          name: 'Dx',
          color: '#007CC3',
          renderAs: 'scatter',
          points: streams.map((p) => [getX(p), p.rTe ?? null]),
        });
      }
      defs.push({
        id: 'torqueEff',
        title: 'Efficienza di Coppia',
        unit: '%',
        icon: <Activity className="h-4 w-4 text-sky-400" />,
        series,
        yZeroBase: true,
        formatValue: (v) => `${v.toFixed(1)}%`,
        stats: [
          ...(lStats
            ? [{ label: 'Media Sx', value: (activity.avgLeftTorqueEff ?? lStats.avg).toFixed(1), unit: '%' }]
            : []),
          ...(rStats
            ? [{ label: 'Media Dx', value: (activity.avgRightTorqueEff ?? rStats.avg).toFixed(1), unit: '%' }]
            : []),
          ...(lStats ? [{ label: 'Max Sx', value: lStats.max.toFixed(1), unit: '%' }] : []),
          ...(rStats ? [{ label: 'Max Dx', value: rStats.max.toFixed(1), unit: '%' }] : []),
        ],
      });
    }

    // 8. Fluidità Pedalata (Left & Right)
    const lSmVals = streams.map((p) => p.lSm).filter((v): v is number => v !== undefined);
    const rSmVals = streams.map((p) => p.rSm).filter((v): v is number => v !== undefined);
    if (lSmVals.length > 0 || rSmVals.length > 0) {
      const lStats = computeNumericStats(lSmVals);
      const rStats = computeNumericStats(rSmVals);
      const series: MetricSeriesDef[] = [];
      if (lSmVals.length > 0) {
        series.push({
          name: 'Sx',
          color: '#10b981',
          renderAs: 'scatter',
          points: streams.map((p) => [getX(p), p.lSm ?? null]),
        });
      }
      if (rSmVals.length > 0) {
        series.push({
          name: 'Dx',
          color: '#f59e0b',
          renderAs: 'scatter',
          points: streams.map((p) => [getX(p), p.rSm ?? null]),
        });
      }
      defs.push({
        id: 'smoothness',
        title: 'Fluidità Pedalata',
        unit: '%',
        icon: <Activity className="h-4 w-4 text-emerald-400" />,
        series,
        yZeroBase: true,
        formatValue: (v) => `${v.toFixed(1)}%`,
        stats: [
          ...(lStats
            ? [{ label: 'Media Sx', value: (activity.avgLeftSmoothness ?? lStats.avg).toFixed(1), unit: '%' }]
            : []),
          ...(rStats
            ? [{ label: 'Media Dx', value: (activity.avgRightSmoothness ?? rStats.avg).toFixed(1), unit: '%' }]
            : []),
          ...(lStats ? [{ label: 'Max Sx', value: lStats.max.toFixed(1), unit: '%' }] : []),
          ...(rStats ? [{ label: 'Max Dx', value: rStats.max.toFixed(1), unit: '%' }] : []),
        ],
      });
    }

    // 9. Pendenza
    const gradeVals = streams.map((p) => p.grade).filter((v): v is number => v !== undefined);
    const gradeStats = computeNumericStats(gradeVals);
    if (gradeStats && (Math.abs(gradeStats.max) > 0.2 || Math.abs(gradeStats.min) > 0.2)) {
      defs.push({
        id: 'grade',
        title: 'Pendenza',
        unit: '%',
        icon: <TrendingUp className="h-4 w-4 text-[#ff6b2c]" />,
        series: [
          {
            name: 'Pendenza',
            color: '#ff6b2c',
            fill: true,
            points: streams.map((p) => [getX(p), p.grade ?? null]),
          },
        ],
        formatValue: (v) => `${v.toFixed(1)}%`,
        stats: [
          { label: 'Salita Max', value: `${gradeStats.max.toFixed(1)}`, unit: '%' },
          { label: 'Media', value: `${gradeStats.avg.toFixed(1)}`, unit: '%' },
          { label: 'Discesa Max', value: `${gradeStats.min.toFixed(1)}`, unit: '%' },
        ],
      });
    }

    // 10. Dinamiche Corsa (Oscillazione Verticale, GCT, Passo)
    const vOscVals = streams.map((p) => p.vOsc).filter((v): v is number => v !== undefined && v > 0);
    const vOscStats = computeNumericStats(vOscVals);
    if (vOscStats) {
      defs.push({
        id: 'vOsc',
        title: 'Oscillazione Verticale',
        unit: 'mm',
        icon: <Activity className="h-4 w-4 text-sky-400" />,
        series: [
          {
            name: 'Oscillazione',
            color: '#38bdf8',
            renderAs: 'scatter',
            points: streams.map((p) => [getX(p), p.vOsc ?? null]),
          },
        ],
        formatValue: (v) => `${v.toFixed(1)} mm`,
        stats: [
          { label: 'Media', value: vOscStats.avg.toFixed(1), unit: 'mm' },
          { label: 'Min', value: vOscStats.min.toFixed(1), unit: 'mm' },
          { label: 'Max', value: vOscStats.max.toFixed(1), unit: 'mm' },
        ],
      });
    }

    const gctVals = streams.map((p) => p.gct).filter((v): v is number => v !== undefined && v > 0);
    const gctStats = computeNumericStats(gctVals);
    if (gctStats) {
      defs.push({
        id: 'gct',
        title: 'Tempo di Contatto al Suolo',
        unit: 'ms',
        icon: <Activity className="h-4 w-4 text-amber-400" />,
        series: [
          {
            name: 'Contatto suolo',
            color: '#f59e0b',
            renderAs: 'scatter',
            points: streams.map((p) => [getX(p), p.gct ?? null]),
          },
        ],
        formatValue: (v) => `${Math.round(v)} ms`,
        stats: [
          { label: 'Media', value: `${Math.round(gctStats.avg)}`, unit: 'ms' },
          { label: 'Min', value: `${Math.round(gctStats.min)}`, unit: 'ms' },
          { label: 'Max', value: `${Math.round(gctStats.max)}`, unit: 'ms' },
        ],
      });
    }

    const stepVals = streams.map((p) => p.stepLen).filter((v): v is number => v !== undefined && v > 0);
    const stepStats = computeNumericStats(stepVals);
    if (stepStats) {
      defs.push({
        id: 'stepLen',
        title: 'Lunghezza Passo',
        unit: 'm',
        icon: <Activity className="h-4 w-4 text-emerald-400" />,
        series: [
          {
            name: 'Lunghezza passo',
            color: '#10b981',
            renderAs: 'scatter',
            points: streams.map((p) => [getX(p), p.stepLen ?? null]),
          },
        ],
        formatValue: (v) => `${v.toFixed(2)} m`,
        stats: [
          { label: 'Media', value: stepStats.avg.toFixed(2), unit: 'm' },
          { label: 'Min', value: stepStats.min.toFixed(2), unit: 'm' },
          { label: 'Max', value: stepStats.max.toFixed(2), unit: 'm' },
        ],
      });
    }

    // 11. Frequenza Respiratoria
    const respVals = streams.map((p) => p.resp).filter((v): v is number => v !== undefined && v > 0);
    const respStats = computeNumericStats(respVals);
    if (respStats) {
      defs.push({
        id: 'resp',
        title: 'Frequenza Respiratoria',
        unit: 'brpm',
        icon: <Wind className="h-4 w-4 text-cyan-400" />,
        series: [
          {
            name: 'Respirazione',
            color: '#22d3ee',
            fill: true,
            points: streams.map((p) => [getX(p), p.resp ?? null]),
          },
        ],
        formatValue: (v) => `${v.toFixed(1)} brpm`,
        stats: [
          {
            label: 'Resp. Media',
            value: (activity.avgRespiration ?? respStats.avg).toFixed(1),
            unit: 'brpm',
          },
          {
            label: 'Resp. Max',
            value: (activity.maxRespiration ?? respStats.max).toFixed(1),
            unit: 'brpm',
          },
          {
            label: 'Resp. Min',
            value: (activity.minRespiration ?? respStats.min).toFixed(1),
            unit: 'brpm',
          },
        ],
      });
    }

    // 12. Temperatura
    const tempVals = streams.map((p) => p.temp).filter((v): v is number => v !== undefined);
    const tempStats = computeNumericStats(tempVals);
    if (tempStats) {
      defs.push({
        id: 'temp',
        title: 'Temperatura',
        unit: '°C',
        icon: <Thermometer className="h-4 w-4 text-cyan-400" />,
        series: [
          {
            name: 'Temperatura',
            color: '#06b6d4',
            points: streams.map((p) => [getX(p), p.temp ?? null]),
          },
        ],
        formatValue: (v) => `${v.toFixed(1)} °C`,
        stats: [
          { label: 'Media', value: tempStats.avg.toFixed(1), unit: '°C' },
          { label: 'Min', value: tempStats.min.toFixed(1), unit: '°C' },
          { label: 'Max', value: tempStats.max.toFixed(1), unit: '°C' },
        ],
      });
    }

    // 13. Qualsiasi altro campo extra Connect IQ / ciclocomputer
    if (activity.extraFields && activity.extraFields.length > 0) {
      for (const ef of activity.extraFields) {
        const vals = streams
          .map((p) => p.extra?.[ef.key])
          .filter((v): v is number => v !== undefined);
        const st = computeNumericStats(vals);
        if (!st) continue;
        const unitLabel = ef.unit ? ` ${ef.unit}` : '';
        defs.push({
          id: `extra-${ef.key}`,
          title: ef.label,
          unit: ef.unit || '',
          icon: <Activity className="h-4 w-4 text-indigo-400" />,
          series: [
            {
              name: ef.label,
              color: '#818cf8',
              fill: true,
              points: streams.map((p) => [getX(p), p.extra?.[ef.key] ?? null]),
            },
          ],
          formatValue: (v) => `${Number(v.toFixed(1))}${unitLabel}`,
          stats: [
            { label: 'Media', value: Number(st.avg.toFixed(1)).toString(), unit: ef.unit || undefined },
            { label: 'Min', value: Number(st.min.toFixed(1)).toString(), unit: ef.unit || undefined },
            { label: 'Max', value: Number(st.max.toFixed(1)).toString(), unit: ef.unit || undefined },
          ],
        });
      }
    }

    return defs;
  }, [streams, xMode, activity, running]);

  const autoIntervals = useMemo(
    () => detectAutoIntervals(streams, activity, laps),
    [streams, activity, laps]
  );

  const handleHoverX = useCallback(
    (xVal: number | null) => {
      if (xVal === null) {
        scheduleHoverIdx(null);
        return;
      }
      const idx = findNearestStreamIndex(streams, xVal, xMode);
      scheduleHoverIdx(idx);
    },
    [streams, xMode, scheduleHoverIdx]
  );

  if (metrics.length === 0 && !autoIntervals) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-[#111827]/70 p-6 text-center text-sm text-slate-400">
        Nessuna serie temporale disponibile per i grafici.
      </div>
    );
  }

  const isZoomed = zoomRange[0] > 0 || zoomRange[1] < 100;

  return (
    <div className="space-y-3">
      {/* Compact Selector Only: Distance / Time (+ Reset when pinched) */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex rounded-full bg-[#242424] p-0.5 text-xs">
          <button
            onClick={() => {
              setXMode('distance');
              setZoomRange([0, 100]);
            }}
            className={`rounded-full px-3.5 py-1 font-semibold transition ${
              xMode === 'distance'
                ? 'bg-[#007CC3] text-white shadow-sm'
                : 'text-[#A0A5AA] hover:text-white'
            }`}
          >
            Distanza
          </button>
          <button
            onClick={() => {
              setXMode('time');
              setZoomRange([0, 100]);
            }}
            className={`rounded-full px-3.5 py-1 font-semibold transition ${
              xMode === 'time'
                ? 'bg-[#007CC3] text-white shadow-sm'
                : 'text-[#A0A5AA] hover:text-white'
            }`}
          >
            Tempo
          </button>
        </div>

        {isZoomed && (
          <button
            onClick={() => setZoomRange([0, 100])}
            className="flex items-center gap-1 rounded-full bg-[#242424] px-3 py-1 text-xs font-semibold text-white hover:bg-[#323232]"
          >
            <RotateCcw className="h-3 w-3" />
            Reset Zoom
          </button>
        )}
      </div>

      {/* Individual Full-Width Metric Cards */}
      <div className="space-y-3">
        {autoIntervals && (
          <AutoIntervalsCard
            analysis={autoIntervals}
            isMobile={isMobile}
            zoomRange={zoomRange}
            onZoomChange={setZoomRange}
          />
        )}
        {metrics.map((metric) => (
          <SingleMetricChartCard
            key={metric.id}
            metric={metric}
            xMode={xMode}
            domain={visibleDomain}
            zoomRange={zoomRange}
            isMobile={isMobile}
            onHoverX={handleHoverX}
            onZoomChange={setZoomRange}
          />
        ))}
      </div>
    </div>
  );
}

function attachXAxisZoomGestures(
  el: HTMLElement,
  isMobileRef: { current: boolean },
  zoomRangeRef: { current: [number, number] },
  onZoomChangeRef: { current: (next: [number, number]) => void }
): () => void {
  let pinchState: {
    startDist: number;
    startRange: [number, number];
    anchorDataPct: number;
  } | null = null;
  let zoomRaf: number | null = null;

  const getRatioFromClientX = (clientX: number) => {
    const rect = el.getBoundingClientRect();
    const padLeft = isMobileRef.current ? 6 : 48;
    const padRight = isMobileRef.current ? 6 : 16;
    const plotW = Math.max(20, rect.width - padLeft - padRight);
    return Math.max(0, Math.min(1, (clientX - rect.left - padLeft) / plotW));
  };

  const commitZoom = (next: [number, number]) => {
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    zoomRaf = requestAnimationFrame(() => {
      onZoomChangeRef.current([
        Number(next[0].toFixed(2)),
        Number(next[1].toFixed(2)),
      ]);
    });
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midRatio = (getRatioFromClientX(t0.clientX) + getRatioFromClientX(t1.clientX)) / 2;
      const curRange = zoomRangeRef.current;
      pinchState = {
        startDist: Math.max(12, dist),
        startRange: [curRange[0], curRange[1]],
        anchorDataPct: curRange[0] + midRatio * (curRange[1] - curRange[0]),
      };
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2 && pinchState) {
      e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const curDist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const curMidRatio = (getRatioFromClientX(t0.clientX) + getRatioFromClientX(t1.clientX)) / 2;
      const scale = pinchState.startDist / curDist;
      const origSpan = pinchState.startRange[1] - pinchState.startRange[0];
      const newSpan = Math.max(2, Math.min(100, origSpan * scale));

      let newStart = pinchState.anchorDataPct - curMidRatio * newSpan;
      let newEnd = newStart + newSpan;
      if (newStart < 0) {
        newStart = 0;
        newEnd = newSpan;
      }
      if (newEnd > 100) {
        newEnd = 100;
        newStart = Math.max(0, 100 - newSpan);
      }
      commitZoom([newStart, newEnd]);
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) {
      pinchState = null;
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const curRange = zoomRangeRef.current;
    const curSpan = curRange[1] - curRange[0];
    const ratio = getRatioFromClientX(e.clientX);
    const anchor = curRange[0] + ratio * curSpan;
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const newSpan = Math.max(2, Math.min(100, curSpan * factor));
    let newStart = anchor - ratio * newSpan;
    let newEnd = newStart + newSpan;
    if (newStart < 0) {
      newStart = 0;
      newEnd = newSpan;
    }
    if (newEnd > 100) {
      newEnd = 100;
      newStart = Math.max(0, 100 - newSpan);
    }
    commitZoom([newStart, newEnd]);
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });
  el.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    if (zoomRaf !== null) cancelAnimationFrame(zoomRaf);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    el.removeEventListener('wheel', onWheel);
  };
}

const SingleMetricChartCard = memo(function SingleMetricChartCard({
  metric,
  xMode,
  domain,
  zoomRange,
  isMobile,
  onHoverX,
  onZoomChange,
}: {
  metric: MetricChartDef;
  xMode: XAxisMode;
  domain: [number, number];
  zoomRange: [number, number];
  isMobile: boolean;
  onHoverX: (xVal: number | null) => void;
  onZoomChange: (next: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isLight = useIsLightTheme();
  const onHoverXRef = useRef(onHoverX);
  onHoverXRef.current = onHoverX;
  const zoomRangeRef = useRef(zoomRange);
  zoomRangeRef.current = zoomRange;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chart.group = SYNC_GROUP;
    echarts.connect(SYNC_GROUP);
    chartRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    const handlePointer = (event: unknown) => {
      const e = event as { axesInfo?: { value?: number }[] };
      const val = e?.axesInfo?.[0]?.value;
      if (typeof val === 'number' && Number.isFinite(val)) {
        onHoverXRef.current(val);
      }
    };
    const handleOut = () => onHoverXRef.current(null);

    chart.on('updateAxisPointer', handlePointer);
    chart.on('globalout', handleOut);

    const detachZoom = attachXAxisZoomGestures(
      containerRef.current,
      isMobileRef,
      zoomRangeRef,
      onZoomChangeRef
    );

    return () => {
      detachZoom();
      chart.off('updateAxisPointer', handlePointer);
      chart.off('globalout', handleOut);
      window.removeEventListener('resize', handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const gridOption = isMobile
      ? { left: 6, right: 6, top: 10, bottom: 22 }
      : { left: 48, right: 16, top: 12, bottom: 24 };

    const ct = getChartTheme(isLight);

    chart.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
          trigger: 'axis',
          confine: true,
          backgroundColor: ct.tooltipBg,
          borderColor: ct.tooltipBorder,
          textStyle: { color: ct.tooltipText, fontSize: 12 },
          axisPointer: {
            type: 'line',
            lineStyle: { color: '#007CC3', width: 1.2, type: 'solid' },
          },
          formatter: (params: unknown) => {
            const arr = Array.isArray(params) ? params : [params];
            const first = arr[0] as { data?: [number, number | null] } | undefined;
            if (!first?.data) return '';
            const x = first.data[0];
            const xLabel =
              xMode === 'distance' ? `${x.toFixed(2)} km` : formatDurationHMS(x);
            const lines = (arr as { seriesName?: string; data?: [number, number | null] }[]).map(
              (item) => {
                const y = item.data?.[1];
                const yLabel = y !== null && y !== undefined ? metric.formatValue(y) : '—';
                const prefix = arr.length > 1 && item.seriesName ? `${item.seriesName}: ` : '';
                return `<div style="font-weight:700;color:${ct.tooltipText}">${prefix}${yLabel}</div>`;
              }
            );
            return `<div style="font-size:10px;color:${ct.tooltipSubText};text-transform:uppercase">${xLabel}</div>${lines.join('')}`;
          },
        },
        grid: gridOption,
        xAxis: {
          type: 'value',
          min: domain[0],
          max: domain[1],
          axisLine: { lineStyle: { color: ct.axisLine } },
          splitLine: {
            show: true,
            lineStyle: { color: ct.splitLineSubtle },
          },
          axisLabel: {
            color: ct.axisLabel,
            fontSize: 10,
            formatter: (v: number) =>
              xMode === 'distance' ? `${v.toFixed(1)} km` : formatDurationHMS(v),
          },
        },
        yAxis: {
          type: 'value',
          scale: !metric.yZeroBase,
          min: metric.yZeroBase ? 0 : undefined,
          splitNumber: 3,
          axisLabel: isMobile
            ? {
                inside: true,
                margin: 4,
                color: ct.mobileAxisLabel,
                fontSize: 9,
                verticalAlign: 'bottom',
              }
            : { color: ct.axisLabel, fontSize: 10 },
          splitLine: { lineStyle: { color: ct.splitLine } },
        },
        series: metric.series.map((s) => {
          const mode = s.renderAs ?? 'line';
          if (mode === 'scatter') {
            return {
              name: s.name,
              type: 'scatter' as const,
              symbolSize: isMobile ? 3.5 : 4.5,
              itemStyle: { color: s.color, opacity: 0.9 },
              data: s.points,
            };
          }
          if (mode === 'bar') {
            return {
              name: s.name,
              type: 'bar' as const,
              barMaxWidth: 16,
              itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] },
              data: s.points,
            };
          }
          return {
            name: s.name,
            type: 'line' as const,
            showSymbol: false,
            smooth: 0.2,
            connectNulls: true,
            lineStyle: { width: 2, color: s.color },
            itemStyle: { color: s.color },
            areaStyle: s.fill
              ? {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: `${s.color}42` },
                    { offset: 1, color: `${s.color}03` },
                  ]),
                }
              : undefined,
            data: s.points,
          };
        }),
      },
      true
    );
  }, [metric, xMode, domain, isMobile, isLight]);

  const colCount = Math.min(4, metric.stats.length);

  return (
    <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] px-2.5 py-3.5 sm:mx-0 sm:rounded-xl sm:border sm:p-4">
      {/* Header Row (Title only, no floating hover value on right) */}
      <div className="mb-1 flex items-center gap-2 px-1">
        {metric.icon}
        <span className="text-sm font-bold tracking-tight text-white">
          {metric.title}
        </span>
        {metric.series.length > 1 && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-[#A0A5AA]">
            {metric.series.map((s) => (
              <span key={s.name} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Edge-to-Edge Chart on Mobile */}
      <div ref={containerRef} className="h-44 w-full touch-pan-y sm:h-48" />

      {/* Strava-style Clean Stat Columns (Neutral Inter typography) */}
      <div
        className="mt-3 grid gap-2 border-t border-white/[0.07] px-1 pt-3"
        style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
      >
        {metric.stats.map((st) => (
          <div key={st.label} className="min-w-0">
            <div className="truncate text-[11px] font-medium text-[#A0A5AA]">
              {st.label}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
              <span className="text-base font-bold text-white sm:text-lg">
                {st.value}
              </span>
              {st.unit && (
                <span className="text-[11px] font-medium text-[#A0A5AA]">
                  {st.unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

const AutoIntervalsCard = memo(function AutoIntervalsCard({
  analysis,
  isMobile,
  zoomRange,
  onZoomChange,
}: {
  analysis: AutoIntervalAnalysis;
  isMobile: boolean;
  zoomRange: [number, number];
  onZoomChange: (next: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isLight = useIsLightTheme();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const zoomRangeRef = useRef(zoomRange);
  zoomRangeRef.current = zoomRange;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    const detachZoom = attachXAxisZoomGestures(
      containerRef.current,
      isMobileRef,
      zoomRangeRef,
      onZoomChangeRef
    );
    return () => {
      detachZoom();
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  const formatMetricVal = useCallback(
    (v: number) => {
      if (analysis.signalType === 'pwr') return `${Math.round(v)} W`;
      if (analysis.signalType === 'spd') {
        if (analysis.sport === 'swimming' && v > 0.2) {
          const secPer100m = Math.round(100 / (v / 3.6));
          const mins = Math.floor(secPer100m / 60);
          const secs = secPer100m % 60;
          return `${mins}:${String(secs).padStart(2, '0')} /100m`;
        }
        return analysis.running ? formatPaceMinKm(v / 3.6) : `${v.toFixed(1)} km/h`;
      }
      return `${Math.round(v)} bpm`;
    },
    [analysis.signalType, analysis.running, analysis.sport]
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ct = getChartTheme(isLight);
    const maxSig = Math.max(...analysis.blocks.map((b) => b.avgSignal), 1);
    const domainStart = (analysis.totalDurationSec * zoomRange[0]) / 100;
    const domainEnd = Math.max(
      domainStart + 1,
      (analysis.totalDurationSec * zoomRange[1]) / 100
    );

    chart.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        tooltip: {
          trigger: 'item',
          confine: true,
          backgroundColor: ct.tooltipBg,
          borderColor: ct.tooltipBorder,
          textStyle: { color: ct.tooltipText, fontSize: 12 },
          formatter: (params: unknown) => {
            const p = params as { dataIndex?: number } | undefined;
            const b = analysis.blocks[p?.dataIndex ?? 0];
            if (!b) return '';
            const cadUnit = analysis.running ? 'spm' : 'rpm';
            const extras = [
              b.avgVpwr !== undefined ? `VP ${b.avgVpwr} W` : '',
              b.avgHr ? `FC ${b.avgHr} bpm` : '',
              b.avgCadence ? `${b.avgCadence} ${cadUnit}` : '',
              b.avgGrade !== undefined ? `${b.avgGrade > 0 ? '+' : ''}${b.avgGrade}%` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return `<div style="font-size:11px;color:${ct.tooltipSubText}">${b.phaseLabel} · ${formatDurationHMS(b.durationSec)}</div>
              <div style="font-weight:700;color:${ct.tooltipText}">${formatMetricVal(b.avgSignal)}</div>
              ${extras ? `<div style="font-size:11px;color:${ct.tooltipSubText}">${extras}</div>` : ''}`;
          },
        },
        grid: isMobile
          ? { left: 6, right: 6, top: 10, bottom: 22 }
          : { left: 48, right: 16, top: 12, bottom: 24 },
        xAxis: {
          type: 'value',
          min: domainStart,
          max: domainEnd,
          axisLine: { lineStyle: { color: ct.axisLine } },
          axisLabel: {
            color: ct.axisLabel,
            fontSize: 10,
            formatter: (v: number) => formatDurationHMS(v),
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: Math.ceil(maxSig * 1.12),
          splitNumber: 3,
          axisLabel: isMobile
            ? {
                inside: true,
                margin: 4,
                color: ct.mobileAxisLabel,
                fontSize: 9,
                verticalAlign: 'bottom',
              }
            : { color: ct.axisLabel, fontSize: 10 },
          splitLine: { lineStyle: { color: ct.splitLine } },
        },
        series: [
          {
            type: 'custom',
            clip: true,
            renderItem: (
              _params: unknown,
              api: {
                value: (idx: number) => number;
                coord: (pt: [number, number]) => [number, number];
              }
            ) => {
              const startX = api.value(0);
              const endX = api.value(1);
              const valY = api.value(2);
              const isWork = api.value(3) === 1;
              const pTopLeft = api.coord([startX, valY]);
              const pBottomRight = api.coord([endX, 0]);
              const width = Math.max(2, pBottomRight[0] - pTopLeft[0] - 1);
              const height = Math.max(2, pBottomRight[1] - pTopLeft[1]);
              const block = analysis.blocks[api.value(4)];
              const fillColor = block?.zoneColor ?? '#007CC3';
              return {
                type: 'rect',
                shape: {
                  x: pTopLeft[0],
                  y: pTopLeft[1],
                  width,
                  height,
                  r: [3, 3, 0, 0],
                },
                style: {
                  fill: fillColor,
                  opacity: isWork ? 0.95 : 0.45,
                },
              };
            },
            encode: { x: [0, 1], y: 2 },
            data: analysis.blocks.map((b, idx) => ({
              value: [b.startSec, b.endSec, Number(b.avgSignal.toFixed(1)), b.kind === 'work' ? 1 : 0, idx],
            })),
          },
        ],
      },
      true
    );
  }, [analysis, isMobile, isLight, zoomRange, formatMetricVal]);

  return (
    <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] px-2.5 py-3.5 sm:mx-0 sm:rounded-xl sm:border sm:p-4">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-[#007CC3]" />
          <span className="text-sm font-bold tracking-tight text-white">
            Intervalli & Variazioni Rilevati
          </span>
        </div>
        <span className="rounded-full bg-[#007CC3]/15 px-2.5 py-0.5 text-[10px] font-semibold text-[#007CC3]">
          {analysis.fromLaps ? 'Da Lap' : 'Auto'} · {analysis.workoutLabel}
        </span>
      </div>

      <div ref={containerRef} className="h-44 w-full touch-pan-y sm:h-48" />

      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-white/[0.07] px-1 pt-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-[#A0A5AA]">Lavori</div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-white sm:text-lg">
            {analysis.workBlocks.length}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-[#A0A5AA]">Tempo Lavoro</div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-white sm:text-lg">
            {formatDurationHMS(analysis.totalWorkSec)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-[#A0A5AA]">Media Lavoro</div>
          <div className="mt-0.5 truncate text-base font-bold tabular-nums text-white sm:text-lg">
            {formatMetricVal(analysis.avgWorkSignal)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium text-[#A0A5AA]">Media Rec.</div>
          <div className="mt-0.5 truncate text-base font-bold tabular-nums text-white sm:text-lg">
            {formatMetricVal(analysis.avgRecoverySignal)}
          </div>
        </div>
      </div>

      <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto px-1">
        {analysis.workBlocks.map((b) => (
          <div
            key={b.workIndex}
            className="shrink-0 rounded-lg border border-white/[0.08] bg-[#161616] px-2.5 py-1 text-[11px] tabular-nums text-[#D4D6D9]"
          >
            <span className="font-bold text-[#007CC3]">L{b.workIndex}</span> ·{' '}
            {formatDurationHMS(b.durationSec)} ·{' '}
            <span className="font-semibold text-white">{formatMetricVal(b.avgSignal)}</span>
            {b.avgVpwr !== undefined ? ` · VP ${b.avgVpwr} W` : ''}
            {b.avgHr ? ` · ${b.avgHr} bpm` : ''}
            {b.avgCadence ? ` · ${b.avgCadence} ${analysis.running ? 'spm' : 'rpm'}` : ''}
            {b.avgGrade !== undefined ? ` · ${b.avgGrade > 0 ? '+' : ''}${b.avgGrade}%` : ''}
          </div>
        ))}
      </div>
    </div>
  );
});
