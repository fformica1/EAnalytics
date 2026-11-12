import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Award,
  Calendar,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { getAllActivityDetails } from '../db/storage';
import type {
  ActivityDetail,
  ActivitySummary,
  DailyHealth,
  SportType,
  StreamPoint,
} from '../types/fitness';
import {
  formatDateShort,
  formatDistanceKm,
  formatDuration,
  formatPaceMinKm,
  isRunningLike,
  sportLabel,
} from '../utils/formatters';
import { getChartTheme, useIsLightTheme } from '../utils/theme';

interface ProgressViewProps {
  activities: ActivitySummary[];
  healthDays: DailyHealth[];
  onSelectActivity: (activity: ActivitySummary) => void;
}

type MetricKind = 'distance' | 'time' | 'elevation' | 'count';
type TimeframeKind = 'week' | 'month' | 'year';

function parseActivityDate(startTime: string): Date {
  return new Date(startTime.includes(' ') ? startTime.replace(' ', 'T') : startTime);
}

/**
 * Compute best average power over a given duration window (in seconds)
 * using time-weighted sliding window over stream points.
 */
function bestWindowPower(
  streams: StreamPoint[],
  windowSec: number,
  hardMax = 2200
): number | undefined {
  const pwrPts = streams.filter(
    (p) => p.pwr !== undefined && p.pwr >= 0 && p.pwr <= hardMax
  );
  if (pwrPts.length < 2) return undefined;
  const totalSpan = pwrPts[pwrPts.length - 1].t - pwrPts[0].t;
  if (totalSpan < windowSec * 0.85) return undefined;

  let left = 0;
  let weightedSum = 0;
  let weightedDur = 0;
  let best = 0;

  for (let right = 1; right < pwrPts.length; right++) {
    const dt = Math.max(1, pwrPts[right].t - pwrPts[right - 1].t);
    weightedSum += (pwrPts[right].pwr ?? 0) * dt;
    weightedDur += dt;

    while (left < right && pwrPts[right].t - pwrPts[left].t > windowSec) {
      const ldt = Math.max(1, pwrPts[left + 1].t - pwrPts[left].t);
      weightedSum -= (pwrPts[left + 1].pwr ?? 0) * ldt;
      weightedDur -= ldt;
      left++;
    }

    if (pwrPts[right].t - pwrPts[left].t >= windowSec * 0.9 && weightedDur > 0) {
      const avg = weightedSum / weightedDur;
      if (avg > best) best = avg;
    }
  }
  return best > 0 ? Math.round(best) : undefined;
}

/**
 * Compute best time (in seconds) for a target distance (in meters)
 * across stream points using a two-pointer sliding window.
 */
function bestDistanceTimeSec(streams: StreamPoint[], targetMeters: number): number | undefined {
  if (streams.length < 2) return undefined;
  const totalMeters = (streams[streams.length - 1].d - streams[0].d) * 1000;
  if (totalMeters < targetMeters) return undefined;

  let left = 0;
  let bestSec = Infinity;
  for (let right = 1; right < streams.length; right++) {
    while (
      left < right &&
      (streams[right].d - streams[left + 1].d) * 1000 >= targetMeters
    ) {
      left++;
    }
    const distM = (streams[right].d - streams[left].d) * 1000;
    if (distM >= targetMeters) {
      const dur = streams[right].t - streams[left].t;
      if (dur > 0) {
        const normalizedDur = dur * (targetMeters / distM);
        if (normalizedDur < bestSec) bestSec = normalizedDur;
      }
    }
  }
  return Number.isFinite(bestSec) ? Math.round(bestSec) : undefined;
}

export function ProgressView({
  activities,
  healthDays,
  onSelectActivity,
}: ProgressViewProps) {
  const isLight = useIsLightTheme();
  const [sportFilter, setSportFilter] = useState<'all' | SportType>('all');
  const [timeframe, setTimeframe] = useState<TimeframeKind>('year');
  const [metric, setMetric] = useState<MetricKind>('distance');
  const [selectedBucketIdx, setSelectedBucketIdx] = useState<number | null>(null);

  // Classic Monthly Calendar state & swipe gesture ref
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const shiftMonth = (delta: number) => {
    setSelectedCalDate(null);
    setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  };

  // Cached stream details for true peak power curves, FTP estimate, and distance PRs
  const [detailsMap, setDetailsMap] = useState<Map<string, ActivityDetail>>(new Map());

  useEffect(() => {
    getAllActivityDetails()
      .then((all) => {
        setDetailsMap(new Map(all.map((d) => [d.activityId, d])));
      })
      .catch(() => {});
  }, [activities.length]);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const availableSports = useMemo(() => {
    const s = new Set<SportType>();
    activities.forEach((a) => s.add(a.sport));
    return Array.from(s);
  }, [activities]);

  const filtered = useMemo(
    () =>
      sportFilter === 'all'
        ? activities
        : activities.filter((a) => a.sport === sportFilter),
    [activities, sportFilter]
  );

  // Reset selected bar when timeframe/sport changes
  useEffect(() => {
    setSelectedBucketIdx(null);
  }, [timeframe, sportFilter]);

  // Build General Summary Buckets: Last Week (7d), Month (30d), 1 Year (12 months)
  const buckets = useMemo(() => {
    const now = new Date();
    const out: {
      label: string;
      start: Date;
      end: Date;
      distanceKm: number;
      hours: number;
      elevationM: number;
      count: number;
      items: ActivitySummary[];
    }[] = [];

    if (timeframe === 'week') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        out.push({
          label: d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }),
          start: d,
          end,
          distanceKm: 0,
          hours: 0,
          elevationM: 0,
          count: 0,
          items: [],
        });
      }
    } else if (timeframe === 'month') {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const end = new Date(d);
        end.setHours(23, 59, 59, 999);
        out.push({
          label: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
          start: d,
          end,
          distanceKm: 0,
          hours: 0,
          elevationM: 0,
          count: 0,
          items: [],
        });
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
        const mLabel = start.toLocaleDateString('it-IT', { month: 'short' });
        out.push({
          label: mLabel.charAt(0).toUpperCase() + mLabel.slice(1),
          start,
          end,
          distanceKm: 0,
          hours: 0,
          elevationM: 0,
          count: 0,
          items: [],
        });
      }
    }

    for (const act of filtered) {
      const t = parseActivityDate(act.startTime);
      if (Number.isNaN(t.getTime())) continue;
      for (const b of out) {
        if (t >= b.start && t <= b.end) {
          b.distanceKm += act.distanceMeters / 1000;
          b.hours += (act.movingDurationSeconds || act.durationSeconds) / 3600;
          b.elevationM += act.elevationGainMeters || 0;
          b.count += 1;
          b.items.push(act);
          break;
        }
      }
    }

    return out;
  }, [filtered, timeframe]);

  const periodTotals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => {
        acc.distKm += b.distanceKm;
        acc.hours += b.hours;
        acc.eleM += b.elevationM;
        acc.count += b.count;
        return acc;
      },
      { distKm: 0, hours: 0, eleM: 0, count: 0 }
    );
  }, [buckets]);

  // Initialize ECharts ONCE (prevents re-animation when clicking a bar)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = echarts.init(chartContainerRef.current);
    chartInstanceRef.current = chart;

    const onClick = (params: unknown) => {
      const idx = (params as { dataIndex?: number })?.dataIndex;
      if (typeof idx === 'number') {
        setSelectedBucketIdx((prev) => (prev === idx ? null : idx));
      }
    };
    chart.on('click', onClick);

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      chart.off('click', onClick);
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  // Update chart options smoothly with animation: false
  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    const values = buckets.map((b) => {
      if (metric === 'distance') return Number(b.distanceKm.toFixed(1));
      if (metric === 'time') return Number(b.hours.toFixed(1));
      if (metric === 'elevation') return Math.round(b.elevationM);
      return b.count;
    });

    const unit =
      metric === 'distance'
        ? 'km'
        : metric === 'time'
          ? 'h'
          : metric === 'elevation'
            ? 'm'
            : 'att.';

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
          formatter: (params: unknown) => {
            const arr = Array.isArray(params) ? params : [params];
            const p = arr[0] as { dataIndex?: number; value?: number } | undefined;
            const idx = p?.dataIndex ?? 0;
            const b = buckets[idx];
            if (!b) return '';
            return `<div style="font-size:11px;color:${ct.tooltipSubText}">${b.label}</div>
              <div style="font-weight:700;color:${ct.tooltipText}">${p?.value ?? 0} ${unit}</div>
              <div style="font-size:11px;color:${ct.tooltipSubText}">${b.count} attività</div>`;
          },
        },
        grid: { left: 36, right: 12, top: 14, bottom: 26 },
        xAxis: {
          type: 'category',
          data: buckets.map((b) => b.label),
          axisLine: { lineStyle: { color: ct.axisLine } },
          axisLabel: { color: ct.axisLabel, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          splitNumber: 3,
          axisLabel: { color: ct.axisLabel, fontSize: 10 },
          splitLine: { lineStyle: { color: ct.splitLine } },
        },
          series: [
          {
            type: 'bar',
            barMaxWidth: 24,
            data: values.map((v, idx) => ({
              value: v,
              itemStyle: {
                color:
                  selectedBucketIdx === idx
                    ? '#007CC3'
                    : selectedBucketIdx !== null
                      ? 'rgba(0, 124, 195, 0.25)'
                      : idx === values.length - 1
                        ? '#007CC3'
                        : 'rgba(0, 124, 195, 0.55)',
                borderRadius: [4, 4, 0, 0],
              },
            })),
          },
        ],
      },
      true
    );
  }, [buckets, metric, selectedBucketIdx, isLight]);

  // Classic Monthly Calendar calculations
  const calendarData = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0 .. Sun=6

    const dayMap = new Map<string, ActivitySummary[]>();
    let monthDist = 0;
    let monthTime = 0;
    let monthEle = 0;
    let monthCount = 0;

    for (const act of filtered) {
      const key = act.startTime.slice(0, 10);
      const t = parseActivityDate(act.startTime);
      if (t.getFullYear() === year && t.getMonth() === month) {
        monthDist += act.distanceMeters;
        monthTime += act.movingDurationSeconds || act.durationSeconds;
        monthEle += act.elevationGainMeters || 0;
        monthCount += 1;
      }
      const list = dayMap.get(key) ?? [];
      list.push(act);
      dayMap.set(key, list);
    }

    const cells: (null | {
      date: string;
      dayNum: number;
      items: ActivitySummary[];
      totalDistKm: number;
      totalDurSec: number;
    })[] = [];

    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const items = dayMap.get(key) ?? [];
      cells.push({
        date: key,
        dayNum: day,
        items,
        totalDistKm: items.reduce((s, a) => s + a.distanceMeters / 1000, 0),
        totalDurSec: items.reduce(
          (s, a) => s + (a.movingDurationSeconds || a.durationSeconds),
          0
        ),
      });
    }
    // Always pad to 6 weeks (42 cells) so calendar height never shifts
    while (cells.length < 42) {
      cells.push(null);
    }

    const title = firstDay.toLocaleDateString('it-IT', {
      month: 'long',
      year: 'numeric',
    });

    return {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      cells,
      monthDistKm: (monthDist / 1000).toFixed(1),
      monthTime: formatDuration(monthTime),
      monthEleM: Math.round(monthEle),
      monthCount,
    };
  }, [calendarMonth, filtered]);

  // Comprehensive Historical Stats, Power Curve, Estimated FTP, Run & Swim Records
  const recordsAndHistory = useMemo(() => {
    const now = new Date();
    const fourWeeksAgo = new Date(now);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const latestWeight = healthDays.find((d) => d.weightKg && d.weightKg > 0)?.weightKg;

    let w4Count = 0;
    let w4Dist = 0;
    let w4Time = 0;
    let w4Ele = 0;

    let ytdCount = 0;
    let ytdDist = 0;
    let ytdTime = 0;
    let ytdEle = 0;

    let allDist = 0;
    let allTime = 0;
    let allEle = 0;
    let allCalories = 0;
    let maxTrainingLoad = 0;
    let maxHrSeen = 0;

    // Cycling
    const cyclingActs: ActivitySummary[] = [];
    let rideMaxDist = 0;
    let rideMaxEle = 0;
    let rideMaxSpeedMps = 0;
    let rideBestAvgSpeedMps = 0;
    let rideMaxPower = 0;
    let rideBestNp = 0;
    let rideMaxWorkKj = 0;
    let rideMaxVam = 0;
    let best5s = 0;
    let best1m = 0;
    let best5m = 0;
    let best20m = 0;
    let ftpIsFromEstimated = false;

    // Running
    const runActs: ActivitySummary[] = [];
    let runMaxDist = 0;
    let runMaxEle = 0;
    let runBestAvgSpeedMps = 0;
    let runMaxSpeedMps = 0;
    let runMaxCadence = 0;
    let runBest1kSec = Infinity;
    let runBest5kSec = Infinity;
    let runBest10kSec = Infinity;
    let runBestHalfSec = Infinity;

    // Swimming
    const swimActs: ActivitySummary[] = [];
    let swimMaxDist = 0;
    let swimBestSpeedMps = 0;
    let swimMaxDur = 0;
    let swimMaxCal = 0;

    for (const a of activities) {
      const t = parseActivityDate(a.startTime);
      const dur = a.movingDurationSeconds || a.durationSeconds;
      allDist += a.distanceMeters;
      allTime += dur;
      allEle += a.elevationGainMeters || 0;
      allCalories += a.calories || 0;
      if ((a.trainingLoad || 0) > maxTrainingLoad) maxTrainingLoad = a.trainingLoad || 0;
      if ((a.maxHr || 0) > maxHrSeen) maxHrSeen = a.maxHr || 0;

      if (!Number.isNaN(t.getTime())) {
        if (t >= fourWeeksAgo) {
          w4Count += 1;
          w4Dist += a.distanceMeters;
          w4Time += dur;
          w4Ele += a.elevationGainMeters || 0;
        }
        if (t >= yearStart) {
          ytdCount += 1;
          ytdDist += a.distanceMeters;
          ytdTime += dur;
          ytdEle += a.elevationGainMeters || 0;
        }
      }

      const detail = detailsMap.get(a.id);
      const streams = detail?.streams ?? [];

      if (a.sport === 'cycling') {
        cyclingActs.push(a);
        if (a.distanceMeters > rideMaxDist) rideMaxDist = a.distanceMeters;
        if ((a.elevationGainMeters || 0) > rideMaxEle) rideMaxEle = a.elevationGainMeters || 0;
        if ((a.maxSpeedMps || 0) > rideMaxSpeedMps) rideMaxSpeedMps = a.maxSpeedMps || 0;
        if (a.distanceMeters >= 15000 && a.avgSpeedMps > rideBestAvgSpeedMps) {
          rideBestAvgSpeedMps = a.avgSpeedMps;
        }
        const powerCap = a.isEstimatedPower ? 1600 : 2200;
        if (a.maxPower && a.maxPower <= powerCap && a.maxPower > rideMaxPower) {
          rideMaxPower = a.maxPower;
        }
        if (a.normalizedPower && a.normalizedPower <= 1000 && a.normalizedPower > rideBestNp) {
          rideBestNp = a.normalizedPower;
        }
        if ((a.totalWorkKj || 0) > rideMaxWorkKj) rideMaxWorkKj = a.totalWorkKj || 0;
        if (a.elevationGainMeters > 100 && dur > 600) {
          const vam = a.elevationGainMeters / (dur / 3600);
          if (vam > rideMaxVam) rideMaxVam = vam;
        }

        if (streams.length > 10) {
          const p5 = bestWindowPower(streams, 5, powerCap);
          const p60 = bestWindowPower(streams, 60, powerCap);
          const p300 = bestWindowPower(streams, 300, powerCap);
          const p1200 = bestWindowPower(streams, 1200, powerCap);
          if (p5 && p5 > best5s) best5s = p5;
          if (p60 && p60 > best1m) best1m = p60;
          if (p300 && p300 > best5m) best5m = p300;
          if (p1200 && p1200 > best20m) {
            best20m = p1200;
            ftpIsFromEstimated = Boolean(a.isEstimatedPower);
          }
        }
      } else if (isRunningLike(a.sport)) {
        runActs.push(a);
        if (a.distanceMeters > runMaxDist) runMaxDist = a.distanceMeters;
        if ((a.elevationGainMeters || 0) > runMaxEle) runMaxEle = a.elevationGainMeters || 0;
        if (a.distanceMeters >= 2000 && a.avgSpeedMps > runBestAvgSpeedMps) {
          runBestAvgSpeedMps = a.avgSpeedMps;
        }
        if ((a.maxSpeedMps || 0) > runMaxSpeedMps) runMaxSpeedMps = a.maxSpeedMps || 0;
        if ((a.avgCadence || 0) > runMaxCadence) runMaxCadence = a.avgCadence || 0;

        if (streams.length > 10) {
          const t1k = bestDistanceTimeSec(streams, 1000);
          const t5k = bestDistanceTimeSec(streams, 5000);
          const t10k = bestDistanceTimeSec(streams, 10000);
          const t21k = bestDistanceTimeSec(streams, 21097);
          if (t1k && t1k < runBest1kSec) runBest1kSec = t1k;
          if (t5k && t5k < runBest5kSec) runBest5kSec = t5k;
          if (t10k && t10k < runBest10kSec) runBest10kSec = t10k;
          if (t21k && t21k < runBestHalfSec) runBestHalfSec = t21k;
        }
      } else if (a.sport === 'swimming') {
        swimActs.push(a);
        if (a.distanceMeters > swimMaxDist) swimMaxDist = a.distanceMeters;
        if (a.avgSpeedMps > swimBestSpeedMps) swimBestSpeedMps = a.avgSpeedMps;
        if (dur > swimMaxDur) swimMaxDur = dur;
        if ((a.calories || 0) > swimMaxCal) swimMaxCal = a.calories || 0;
      }
    }

    const estimatedFtp =
      best20m > 0
        ? Math.round(best20m * 0.95)
        : rideBestNp > 0
          ? Math.round(rideBestNp * 0.95)
          : 0;
    const ftpWkg =
      estimatedFtp > 0 && latestWeight
        ? Number((estimatedFtp / latestWeight).toFixed(2))
        : undefined;

    return {
      general: {
        avg4wCount: (w4Count / 4).toFixed(1),
        avg4wDist: (w4Dist / 4000).toFixed(1),
        avg4wTime: formatDuration(w4Time / 4),
        avg4wEle: Math.round(w4Ele / 4),
        ytdCount,
        ytdDist: (ytdDist / 1000).toFixed(0),
        ytdTime: formatDuration(ytdTime),
        ytdEle: Math.round(ytdEle),
        allCount: activities.length,
        allDist: (allDist / 1000).toFixed(0),
        allTime: formatDuration(allTime),
        allEle: Math.round(allEle),
        allCalories,
        maxTrainingLoad: Math.round(maxTrainingLoad),
        maxHrSeen,
      },
      cycling: {
        count: cyclingActs.length,
        estimatedFtp,
        ftpWkg,
        ftpIsFromEstimated,
        best5s,
        best1m,
        best5m,
        best20m,
        rideMaxPower,
        rideBestNp,
        rideMaxWorkKj,
        rideMaxDist,
        rideMaxEle: Math.round(rideMaxEle),
        rideMaxSpeedKmh: rideMaxSpeedMps > 0 ? (rideMaxSpeedMps * 3.6).toFixed(1) : undefined,
        rideBestAvgKmh: rideBestAvgSpeedMps > 0 ? (rideBestAvgSpeedMps * 3.6).toFixed(1) : undefined,
        rideMaxVam: Math.round(rideMaxVam),
      },
      running: {
        count: runActs.length,
        runMaxDist,
        runMaxEle: Math.round(runMaxEle),
        runBestPace: runBestAvgSpeedMps > 0 ? formatPaceMinKm(runBestAvgSpeedMps) : undefined,
        runMaxSpeedKmh: runMaxSpeedMps > 0 ? (runMaxSpeedMps * 3.6).toFixed(1) : undefined,
        runMaxCadence,
        runBest1k: Number.isFinite(runBest1kSec) ? formatDuration(runBest1kSec) : undefined,
        runBest5k: Number.isFinite(runBest5kSec) ? formatDuration(runBest5kSec) : undefined,
        runBest10k: Number.isFinite(runBest10kSec) ? formatDuration(runBest10kSec) : undefined,
        runBestHalf: Number.isFinite(runBestHalfSec) ? formatDuration(runBestHalfSec) : undefined,
      },
      swimming: {
        count: swimActs.length,
        swimMaxDist,
        swimBestPace100m:
          swimBestSpeedMps > 0 ? formatDuration(100 / swimBestSpeedMps) : undefined,
        swimMaxDur: swimMaxDur > 0 ? formatDuration(swimMaxDur) : undefined,
        swimMaxCal,
      },
    };
  }, [activities, detailsMap, healthDays]);

  const activeBucket =
    selectedBucketIdx !== null ? buckets[selectedBucketIdx] : null;

  const selectedDayActivities = useMemo(() => {
    if (!selectedCalDate) return [];
    return filtered.filter((a) => a.startTime.slice(0, 10) === selectedCalDate);
  }, [filtered, selectedCalDate]);

  return (
    <div className="space-y-4 pb-10">
      {/* Sport Filter Chips (Strava Dark Pills) */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        <button
          onClick={() => setSportFilter('all')}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            sportFilter === 'all'
              ? 'bg-[#007CC3] text-white'
              : 'bg-[#262626] text-[#D4D6D9] hover:bg-[#323232]'
          }`}
        >
          Tutti gli sport
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

      {/* 1. RIEPILOGO GENERALE (Strava Progress Card) */}
      <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#A0A5AA]">
              <TrendingUp className="h-3.5 w-3.5 text-[#007CC3]" />
              <span>Riepilogo Generale</span>
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-white sm:text-3xl">
              {metric === 'distance' && `${periodTotals.distKm.toFixed(1)} km`}
              {metric === 'time' && `${periodTotals.hours.toFixed(1)} h`}
              {metric === 'elevation' && `${Math.round(periodTotals.eleM)} m`}
              {metric === 'count' && `${periodTotals.count} attività`}
            </div>
            <p className="mt-0.5 text-xs tabular-nums text-[#A0A5AA]">
              {periodTotals.distKm.toFixed(1)} km · {periodTotals.hours.toFixed(1)} h · +
              {Math.round(periodTotals.eleM)} m · {periodTotals.count} attività
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Timeframe Switcher */}
            <div className="flex rounded-full bg-[#121212] p-0.5 text-[11px]">
              {(
                [
                  { id: 'week', label: 'Giorno' },
                  { id: 'month', label: 'Mese' },
                  { id: 'year', label: 'Anno' },
                ] as const
              ).map((tf) => (
                <button
                  key={tf.id}
                  onClick={() => setTimeframe(tf.id)}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    timeframe === tf.id
                      ? 'bg-[#2E2E2E] text-white'
                      : 'text-[#A0A5AA] hover:text-white'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* Metric Switcher */}
            <div className="flex rounded-full bg-[#121212] p-0.5 text-[11px]">
              {(
                [
                  { id: 'distance', label: 'Distanza' },
                  { id: 'time', label: 'Tempo' },
                  { id: 'elevation', label: 'D+' },
                  { id: 'count', label: 'Uscite' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMetric(m.id)}
                  className={`rounded-full px-2.5 py-1 font-semibold transition ${
                    metric === m.id
                      ? 'bg-[#007CC3] text-white'
                      : 'text-[#A0A5AA] hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div ref={chartContainerRef} className="mt-3 h-48 w-full" />

        {activeBucket && (
          <div className="mt-3 border-t border-white/[0.07] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-white">
                Dettaglio {activeBucket.label}
              </span>
              <span className="tabular-nums text-[#A0A5AA]">
                {activeBucket.distanceKm.toFixed(1)} km · {activeBucket.hours.toFixed(1)} h · +
                {Math.round(activeBucket.elevationM)} m · {activeBucket.count} attività
              </span>
            </div>

            {activeBucket.items.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {activeBucket.items.map((act) => (
                  <button
                    key={act.id}
                    onClick={() => onSelectActivity(act)}
                    className="rounded-lg border border-white/[0.08] bg-[#161616] px-3 py-2 text-left text-xs transition hover:border-white/25"
                  >
                    <div className="font-semibold text-white">{act.name}</div>
                    <div className="text-[11px] text-[#A0A5AA]">
                      {formatDateShort(act.startTime)} · {formatDistanceKm(act.distanceMeters)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. CLASSICO CALENDARIO MENSILE CON SWIPE GESTURE & PULSANTI CENTRATI */}
      <div
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            swipeStartRef.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            };
          }
        }}
        onTouchEnd={(e) => {
          if (!swipeStartRef.current || e.changedTouches.length === 0) return;
          const dx = e.changedTouches[0].clientX - swipeStartRef.current.x;
          const dy = e.changedTouches[0].clientY - swipeStartRef.current.y;
          swipeStartRef.current = null;
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            shiftMonth(dx < 0 ? 1 : -1);
          }
        }}
        className="-mx-3 touch-pan-y select-none border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5"
      >
        <div className="mb-3 text-left">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-white">
            <Calendar className="h-4 w-4 text-[#007CC3]" />
            Registro Allenamenti — {calendarData.title}
          </h3>
          <p className="mt-0.5 text-xs tabular-nums text-[#A0A5AA]">
            {calendarData.monthCount} attività · {calendarData.monthDistKm} km ·{' '}
            {calendarData.monthTime} · +{calendarData.monthEleM} m
          </p>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Mese precedente"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#262626] text-[#D4D6D9] transition hover:bg-[#323232] hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                const now = new Date();
                setSelectedCalDate(null);
                setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="rounded-lg bg-[#262626] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#323232]"
            >
              Oggi
            </button>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Mese successivo"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#262626] text-[#D4D6D9] transition hover:bg-[#323232] hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-[#8E9299]">
          <div>Lun</div>
          <div>Mar</div>
          <div>Mer</div>
          <div>Gio</div>
          <div>Ven</div>
          <div>Sab</div>
          <div>Dom</div>
        </div>

        {/* Month Days Grid (Strava Training Log scaled circles) */}
        <div className="mt-2 grid grid-cols-7 gap-y-1.5">
          {calendarData.cells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} className="h-12" />;
            const hasWorkout = cell.items.length > 0;
            const isSelected = selectedCalDate === cell.date;

            // Scale circle size smoothly by workout duration (24px..42px)
            const ratio = Math.min(1, cell.totalDurSec / 7200);
            const diameterPx = Math.round(24 + ratio * 18);

            return (
              <div key={cell.date} className="flex h-12 items-center justify-center">
                {hasWorkout ? (
                  <button
                    onClick={() =>
                      setSelectedCalDate((prev) =>
                        prev === cell.date ? null : cell.date
                      )
                    }
                    title={`${cell.date}: ${cell.totalDistKm.toFixed(1)} km · ${formatDuration(cell.totalDurSec)}`}
                    style={{ width: `${diameterPx}px`, height: `${diameterPx}px` }}
                    className={`flex items-center justify-center rounded-full bg-[#007CC3] text-xs font-bold tabular-nums text-white transition hover:scale-110 ${
                      isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1E1E1E]' : ''
                    }`}
                  >
                    {cell.dayNum}
                  </button>
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center text-xs font-medium tabular-nums text-[#7A7E85]">
                    {cell.dayNum}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {selectedDayActivities.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-white/[0.07] pt-3">
            <div className="text-xs font-semibold text-[#A0A5AA]">
              Allenamenti del {selectedCalDate}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedDayActivities.map((act) => (
                <button
                  key={act.id}
                  onClick={() => onSelectActivity(act)}
                  className="rounded-lg border border-white/10 bg-[#161616] px-3 py-2 text-left text-xs transition hover:border-white/25"
                >
                  <div className="font-bold text-white">{act.name}</div>
                  <div className="mt-0.5 text-[11px] text-[#A0A5AA]">
                    {sportLabel(act.sport)} · {formatDistanceKm(act.distanceMeters)} ·{' '}
                    {formatDuration(act.movingDurationSeconds || act.durationSeconds)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. STORICO COMPLETO IN ELENCO VERTICALE (1 COLONNA) */}
      <div className="space-y-3">
        {/* General Volume Matrix */}
        <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
          <div className="flex items-center gap-1.5 text-sm font-bold text-white">
            <Award className="h-4 w-4 text-[#007CC3]" />
            Volume & Massimali Generali
          </div>
          <div className="mt-3 space-y-2.5 text-xs">
            <StatRow label="Media 4 sett. (uscite)" value={`${recordsAndHistory.general.avg4wCount}/sett`} />
            <StatRow label="Media 4 sett. (dist.)" value={`${recordsAndHistory.general.avg4wDist} km`} />
            <StatRow label="Media 4 sett. (tempo)" value={recordsAndHistory.general.avg4wTime} />
            <StatRow label="Media 4 sett. (D+)" value={`${recordsAndHistory.general.avg4wEle} m`} />
            <StatRow label={`Anno ${new Date().getFullYear()} (att.)`} value={String(recordsAndHistory.general.ytdCount)} />
            <StatRow label={`Anno ${new Date().getFullYear()} (dist.)`} value={`${recordsAndHistory.general.ytdDist} km`} />
            <StatRow label={`Anno ${new Date().getFullYear()} (tempo)`} value={recordsAndHistory.general.ytdTime} />
            <StatRow label={`Anno ${new Date().getFullYear()} (D+)`} value={`${recordsAndHistory.general.ytdEle} m`} />
            <StatRow label="Storico attività" value={String(recordsAndHistory.general.allCount)} />
            <StatRow label="Storico distanza" value={`${recordsAndHistory.general.allDist} km`} />
            <StatRow label="Storico dislivello" value={`${recordsAndHistory.general.allEle} m`} />
            <StatRow label="Storico tempo" value={recordsAndHistory.general.allTime} />
            {recordsAndHistory.general.allCalories > 0 && (
              <StatRow
                label="Calorie totali"
                value={`${recordsAndHistory.general.allCalories.toLocaleString('it-IT')} kcal`}
              />
            )}
            {recordsAndHistory.general.maxTrainingLoad > 0 && (
              <StatRow label="Training Load max" value={`${recordsAndHistory.general.maxTrainingLoad}`} />
            )}
            {recordsAndHistory.general.maxHrSeen > 0 && (
              <StatRow label="FC Max registrata" value={`${recordsAndHistory.general.maxHrSeen} bpm`} />
            )}
          </div>
        </div>

        {/* Cycling Power, Estimated FTP & Records */}
        {recordsAndHistory.cycling.count > 0 && (
          <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                Ciclismo — Stima FTP, Potenza & Record
              </span>
              <span className="text-xs text-[#A0A5AA]">
                {recordsAndHistory.cycling.count} uscite
              </span>
            </div>
            <div className="mt-3 space-y-2.5 text-xs">
              <StatRow
                label={
                  recordsAndHistory.cycling.ftpIsFromEstimated
                    ? 'FTP Stimata (Virtual)'
                    : 'FTP Stimata'
                }
                value={
                  recordsAndHistory.cycling.estimatedFtp > 0
                    ? `${recordsAndHistory.cycling.estimatedFtp} W${
                        recordsAndHistory.cycling.ftpWkg
                          ? ` (${recordsAndHistory.cycling.ftpWkg} W/kg)`
                          : ''
                      }`
                    : '—'
                }
              />
              <StatRow
                label="Picco 20 min"
                value={recordsAndHistory.cycling.best20m ? `${recordsAndHistory.cycling.best20m} W` : '—'}
              />
              <StatRow
                label="Picco 5 min"
                value={recordsAndHistory.cycling.best5m ? `${recordsAndHistory.cycling.best5m} W` : '—'}
              />
              <StatRow
                label="Picco 1 min"
                value={recordsAndHistory.cycling.best1m ? `${recordsAndHistory.cycling.best1m} W` : '—'}
              />
              <StatRow
                label="Picco 5 sec"
                value={recordsAndHistory.cycling.best5s ? `${recordsAndHistory.cycling.best5s} W` : '—'}
              />
              <StatRow
                label="Potenza Max picco"
                value={
                  recordsAndHistory.cycling.rideMaxPower
                    ? `${recordsAndHistory.cycling.rideMaxPower} W`
                    : '—'
                }
              />
              <StatRow
                label="Miglior NP uscita"
                value={
                  recordsAndHistory.cycling.rideBestNp
                    ? `${recordsAndHistory.cycling.rideBestNp} W`
                    : '—'
                }
              />
              <StatRow
                label="Lavoro max uscita"
                value={
                  recordsAndHistory.cycling.rideMaxWorkKj
                    ? `${recordsAndHistory.cycling.rideMaxWorkKj} kJ`
                    : '—'
                }
              />
              <StatRow
                label="Uscita più lunga"
                value={formatDistanceKm(recordsAndHistory.cycling.rideMaxDist)}
              />
              <StatRow
                label="Dislivello max"
                value={`${recordsAndHistory.cycling.rideMaxEle} m`}
              />
              <StatRow
                label="Velocità max"
                value={
                  recordsAndHistory.cycling.rideMaxSpeedKmh
                    ? `${recordsAndHistory.cycling.rideMaxSpeedKmh} km/h`
                    : '—'
                }
              />
              <StatRow
                label="Media max (>15 km)"
                value={
                  recordsAndHistory.cycling.rideBestAvgKmh
                    ? `${recordsAndHistory.cycling.rideBestAvgKmh} km/h`
                    : '—'
                }
              />
              {recordsAndHistory.cycling.rideMaxVam > 0 && (
                <StatRow
                  label="VAM max uscita"
                  value={`${recordsAndHistory.cycling.rideMaxVam} m/h`}
                />
              )}
            </div>
          </div>
        )}

        {/* Running Records */}
        {recordsAndHistory.running.count > 0 && (
          <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                Corsa — Record Distanze & Passi
              </span>
              <span className="text-xs text-[#A0A5AA]">
                {recordsAndHistory.running.count} corse
              </span>
            </div>
            <div className="mt-3 space-y-2.5 text-xs">
              <StatRow label="Best 1 km" value={recordsAndHistory.running.runBest1k ?? '—'} />
              <StatRow label="Best 5 km" value={recordsAndHistory.running.runBest5k ?? '—'} />
              <StatRow label="Best 10 km" value={recordsAndHistory.running.runBest10k ?? '—'} />
              <StatRow label="Mezza Maratona" value={recordsAndHistory.running.runBestHalf ?? '—'} />
              <StatRow label="Miglior Passo medio" value={recordsAndHistory.running.runBestPace ?? '—'} />
              <StatRow
                label="Corsa più lunga"
                value={formatDistanceKm(recordsAndHistory.running.runMaxDist)}
              />
              <StatRow
                label="Dislivello max"
                value={`${recordsAndHistory.running.runMaxEle} m`}
              />
              <StatRow
                label="Velocità picco"
                value={
                  recordsAndHistory.running.runMaxSpeedKmh
                    ? `${recordsAndHistory.running.runMaxSpeedKmh} km/h`
                    : '—'
                }
              />
              {recordsAndHistory.running.runMaxCadence > 0 && (
                <StatRow
                  label="Cadenza media max"
                  value={`${recordsAndHistory.running.runMaxCadence} spm`}
                />
              )}
            </div>
          </div>
        )}

        {/* Swimming Records */}
        {recordsAndHistory.swimming.count > 0 && (
          <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                Nuoto — Record & Passi
              </span>
              <span className="text-xs text-[#A0A5AA]">
                {recordsAndHistory.swimming.count} sessioni
              </span>
            </div>
            <div className="mt-3 space-y-2.5 text-xs">
              <StatRow
                label="Sessione più lunga"
                value={formatDistanceKm(recordsAndHistory.swimming.swimMaxDist)}
              />
              <StatRow
                label="Miglior passo /100m"
                value={recordsAndHistory.swimming.swimBestPace100m ?? '—'}
              />
              <StatRow
                label="Durata max"
                value={recordsAndHistory.swimming.swimMaxDur ?? '—'}
              />
              <StatRow
                label="Calorie max"
                value={
                  recordsAndHistory.swimming.swimMaxCal
                    ? `${recordsAndHistory.swimming.swimMaxCal} kcal`
                    : '—'
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] pb-1.5 last:border-b-0">
      <span className="text-[#A0A5AA]">{label}</span>
      <span className="font-semibold tabular-nums text-white">{value}</span>
    </div>
  );
}
