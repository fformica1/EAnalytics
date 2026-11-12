import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  BatteryCharging,
  Brain,
  Footprints,
  Heart,
  Moon,
  RotateCcw,
  Scale,
  Sparkles,
} from 'lucide-react';
import type { DailyHealth } from '../types/fitness';
import { formatDateShort, formatSleep } from '../utils/formatters';
import { getChartTheme, useIsLightTheme } from '../utils/theme';

interface HealthHomeViewProps {
  healthDays: DailyHealth[];
}

interface StatColumn {
  label: string;
  value: string;
  unit?: string;
}

function findBestDayForMetric(
  daysNewestFirst: DailyHealth[],
  selectedDate: string,
  predicate: (d: DailyHealth) => boolean
): { day: DailyHealth | undefined; isFallback: boolean } {
  const selectedIdx = daysNewestFirst.findIndex((d) => d.date === selectedDate);
  const startIdx = selectedIdx >= 0 ? selectedIdx : 0;

  if (daysNewestFirst[startIdx] && predicate(daysNewestFirst[startIdx])) {
    return { day: daysNewestFirst[startIdx], isFallback: false };
  }

  for (let i = startIdx + 1; i < daysNewestFirst.length; i++) {
    if (predicate(daysNewestFirst[i])) {
      return { day: daysNewestFirst[i], isFallback: true };
    }
  }
  for (let i = 0; i < startIdx; i++) {
    if (predicate(daysNewestFirst[i])) {
      return { day: daysNewestFirst[i], isFallback: true };
    }
  }
  return { day: daysNewestFirst[startIdx], isFallback: false };
}

function formatShortChip(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(5);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

export function HealthHomeView({ healthDays }: HealthHomeViewProps) {
  // healthDays arrives sorted newest -> oldest; display oldest -> newest (most recent on right)
  const orderedOldestFirst = useMemo(() => [...healthDays].reverse(), [healthDays]);

  const [selectedDate, setSelectedDate] = useState<string>(healthDays[0]?.date ?? '');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  const dateStripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (healthDays.length > 0 && !healthDays.some((d) => d.date === selectedDate)) {
      setSelectedDate(healthDays[0].date);
    }
  }, [healthDays, selectedDate]);

  // Keep most recent day (rightmost) in view on mount / sync
  useEffect(() => {
    const el = dateStripRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [orderedOldestFirst.length]);

  const activeDate = selectedDate || healthDays[0]?.date || '';

  // Smart fallback resolution for every health metric
  const bodyBatteryCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) =>
          (d.bodyBatteryTimeline?.length ?? 0) > 0 ||
          d.bodyBatteryMax !== undefined ||
          d.bodyBatteryCurrent !== undefined
      ),
    [healthDays, activeDate]
  );

  const hrCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) => (d.hrTimeline?.length ?? 0) > 0 || d.rhr !== undefined
      ),
    [healthDays, activeDate]
  );

  const sleepCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) => (d.sleepSeconds ?? 0) > 0
      ),
    [healthDays, activeDate]
  );

  const hrvCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) => d.hrvLastNight !== undefined
      ),
    [healthDays, activeDate]
  );

  const stressCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) =>
          (d.stressTimeline?.length ?? 0) > 0 ||
          d.stressAvg !== undefined ||
          d.spo2Avg !== undefined ||
          d.respirationAvg !== undefined
      ),
    [healthDays, activeDate]
  );

  const stepsCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) => d.steps !== undefined || d.caloriesTotal !== undefined
      ),
    [healthDays, activeDate]
  );

  const weightCtx = useMemo(
    () =>
      findBestDayForMetric(
        healthDays,
        activeDate,
        (d) => d.weightKg !== undefined
      ),
    [healthDays, activeDate]
  );

  // Build chart datasets
  const bbDay = bodyBatteryCtx.day;
  const hrDay = hrCtx.day;
  const sleepDay = sleepCtx.day;
  const hrvDay = hrvCtx.day;
  const stressDay = stressCtx.day;
  const stepsDay = stepsCtx.day;
  const weightDay = weightCtx.day;

  const sleepTrendDays = useMemo(
    () => orderedOldestFirst.filter((d) => (d.sleepSeconds ?? 0) > 0),
    [orderedOldestFirst]
  );
  const hrvTrendDays = useMemo(
    () => orderedOldestFirst.filter((d) => d.hrvLastNight !== undefined),
    [orderedOldestFirst]
  );
  const stressTrendDays = useMemo(
    () => orderedOldestFirst.filter((d) => d.stressAvg !== undefined),
    [orderedOldestFirst]
  );
  const stepsTrendDays = useMemo(
    () => orderedOldestFirst.filter((d) => d.steps !== undefined),
    [orderedOldestFirst]
  );
  const weightTrendDays = useMemo(
    () => orderedOldestFirst.filter((d) => d.weightKg !== undefined),
    [orderedOldestFirst]
  );

  if (healthDays.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#1E1E1E] p-6 text-center text-sm text-[#A0A5AA]">
        Nessun dato salute H24 ancora presente. Collega Garmin dalle Impostazioni per sincronizzarlo.
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-10">
      {/* Scrollable Day Pills Only (Oldest Left -> Most Recent Right, no scrollbar) */}
      <div
        ref={dateStripRef}
        className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5"
      >
        {orderedOldestFirst.map((d) => {
          const active = d.date === activeDate;
          return (
            <button
              key={d.date}
              onClick={() => setSelectedDate(d.date)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold tabular-nums transition ${
                active
                  ? 'bg-[#007CC3] text-white'
                  : 'bg-[#262626] text-[#A0A5AA] hover:text-white'
              }`}
            >
              {formatDateShort(d.date)}
            </button>
          );
        })}
      </div>

      {/* 1. BODY BATTERY (24h Chart + Stats) */}
      {bbDay && (
        <HealthChartCard
          title="Body Battery"
          icon={<BatteryCharging className="h-4 w-4 text-sky-400" />}
          fallbackDate={bodyBatteryCtx.isFallback ? formatShortChip(bbDay.date) : undefined}
          sourceBadge={bbDay.bodyBatteryEstimated ? 'Stima multi-ecosistema' : undefined}
          xLabels={(bbDay.bodyBatteryTimeline ?? []).map((p) => p.t)}
          series={[
            {
              name: 'Body Battery',
              type: 'line',
              color: '#38bdf8',
              fill: true,
              data: (bbDay.bodyBatteryTimeline ?? []).map((p) => p.v),
            },
          ]}
          yMin={0}
          yMax={100}
          unit="/100"
          isMobile={isMobile}
          stats={[
            {
              label: 'Attuale',
              value: `${bbDay.bodyBatteryCurrent ?? bbDay.bodyBatteryMax ?? '—'}`,
            },
            { label: 'Picco', value: `${bbDay.bodyBatteryMax ?? '—'}` },
            { label: 'Minimo', value: `${bbDay.bodyBatteryMin ?? '—'}` },
            { label: 'Ricarica', value: `+${bbDay.bodyBatteryCharged ?? 0}` },
            { label: 'Consumo', value: `-${bbDay.bodyBatteryDrained ?? 0}` },
          ]}
        />
      )}

      {/* 2. FREQUENZA CARDIACA H24 (24h Chart + Stats) */}
      {hrDay && (
        <HealthChartCard
          title="Frequenza Cardiaca H24"
          icon={<Heart className="h-4 w-4 text-rose-400" />}
          fallbackDate={hrCtx.isFallback ? formatShortChip(hrDay.date) : undefined}
          xLabels={(hrDay.hrTimeline ?? []).map((p) => p.t)}
          series={[
            {
              name: 'FC',
              type: 'line',
              color: '#f43f5e',
              fill: true,
              data: (hrDay.hrTimeline ?? []).map((p) => p.v),
            },
          ]}
          unit="bpm"
          isMobile={isMobile}
          stats={[
            { label: 'A riposo', value: hrDay.rhr ? `${hrDay.rhr}` : '—', unit: 'bpm' },
            { label: 'Minima', value: hrDay.hrMin ? `${hrDay.hrMin}` : '—', unit: 'bpm' },
            { label: 'Massima', value: hrDay.hrMax ? `${hrDay.hrMax}` : '—', unit: 'bpm' },
          ]}
        />
      )}

      {/* 3. SONNO & FASI (Stacked Trend Chart + Stats) */}
      {sleepDay && (
        <HealthChartCard
          title="Sonno & Fasi"
          icon={<Moon className="h-4 w-4 text-purple-400" />}
          fallbackDate={sleepCtx.isFallback ? formatShortChip(sleepDay.date) : undefined}
          xLabels={sleepTrendDays.map((d) => formatShortChip(d.date))}
          series={[
            {
              name: 'Profondo',
              type: 'bar',
              stack: 'sleep',
              color: '#6366f1',
              data: sleepTrendDays.map((d) =>
                d.deepSleepSeconds ? Number((d.deepSleepSeconds / 3600).toFixed(2)) : 0
              ),
            },
            {
              name: 'REM',
              type: 'bar',
              stack: 'sleep',
              color: '#c084fc',
              data: sleepTrendDays.map((d) =>
                d.remSleepSeconds ? Number((d.remSleepSeconds / 3600).toFixed(2)) : 0
              ),
            },
            {
              name: 'Leggero',
              type: 'bar',
              stack: 'sleep',
              color: '#38bdf8',
              data: sleepTrendDays.map((d) =>
                d.lightSleepSeconds ? Number((d.lightSleepSeconds / 3600).toFixed(2)) : 0
              ),
            },
          ]}
          unit="h"
          isMobile={isMobile}
          stats={[
            { label: 'Totale', value: formatSleep(sleepDay.sleepSeconds) },
            ...(sleepDay.sleepScore !== undefined
              ? [{ label: 'Score', value: `${sleepDay.sleepScore}`, unit: '/100' }]
              : []),
            { label: 'Profondo', value: formatSleep(sleepDay.deepSleepSeconds) },
            { label: 'REM', value: formatSleep(sleepDay.remSleepSeconds) },
            { label: 'Leggero', value: formatSleep(sleepDay.lightSleepSeconds) },
          ]}
        />
      )}

      {/* 4. HRV NOTTURNA (Trend Chart + Baseline + Stats) */}
      {hrvDay && (
        <HealthChartCard
          title="HRV Notturna"
          icon={<Sparkles className="h-4 w-4 text-emerald-400" />}
          fallbackDate={hrvCtx.isFallback ? formatShortChip(hrvDay.date) : undefined}
          xLabels={hrvTrendDays.map((d) => formatShortChip(d.date))}
          series={[
            {
              name: 'HRV',
              type: 'scatter',
              color: '#10b981',
              data: hrvTrendDays.map((d) => d.hrvLastNight ?? null),
            },
          ]}
          baselineRange={
            hrvDay.hrvBaselineLow && hrvDay.hrvBaselineHigh
              ? [hrvDay.hrvBaselineLow, hrvDay.hrvBaselineHigh]
              : undefined
          }
          unit="ms"
          isMobile={isMobile}
          stats={[
            {
              label: 'Notte',
              value: hrvDay.hrvLastNight ? `${hrvDay.hrvLastNight}` : '—',
              unit: 'ms',
            },
            {
              label: 'Media 7gg',
              value: hrvDay.hrvWeeklyAvg ? `${hrvDay.hrvWeeklyAvg}` : '—',
              unit: 'ms',
            },
            ...(hrvDay.hrvStatus ? [{ label: 'Stato', value: hrvDay.hrvStatus }] : []),
            ...(hrvDay.hrvBaselineLow && hrvDay.hrvBaselineHigh
              ? [
                  {
                    label: 'Baseline',
                    value: `${hrvDay.hrvBaselineLow}–${hrvDay.hrvBaselineHigh}`,
                    unit: 'ms',
                  },
                ]
              : []),
          ]}
        />
      )}

      {/* 5. STRESS, SpO2 & RESPIRAZIONE */}
      {stressDay && (
        <HealthChartCard
          title="Stress & Ossigenazione"
          icon={<Brain className="h-4 w-4 text-amber-400" />}
          fallbackDate={stressCtx.isFallback ? formatShortChip(stressDay.date) : undefined}
          xLabels={
            (stressDay.stressTimeline?.length ?? 0) > 0
              ? stressDay.stressTimeline!.map((p) => p.t)
              : stressTrendDays.map((d) => formatShortChip(d.date))
          }
          series={[
            {
              name: 'Stress',
              type: 'bar',
              color: '#f59e0b',
              data:
                (stressDay.stressTimeline?.length ?? 0) > 0
                  ? stressDay.stressTimeline!.map((p) => p.v)
                  : stressTrendDays.map((d) => d.stressAvg ?? null),
            },
          ]}
          yMin={0}
          yMax={100}
          unit=""
          isMobile={isMobile}
          stats={[
            { label: 'Stress medio', value: stressDay.stressAvg !== undefined ? `${stressDay.stressAvg}` : '—' },
            { label: 'Stress max', value: stressDay.stressMax !== undefined ? `${stressDay.stressMax}` : '—' },
            ...(stressDay.spo2Avg !== undefined
              ? [{ label: 'SpO2', value: `${stressDay.spo2Avg}`, unit: '%' }]
              : []),
            ...(stressDay.respirationAvg !== undefined
              ? [{ label: 'Respirazione', value: `${stressDay.respirationAvg}`, unit: 'rpm' }]
              : []),
          ]}
        />
      )}

      {/* 6. PASSI & CALORIE */}
      {stepsDay && (
        <HealthChartCard
          title="Passi & Calorie"
          icon={<Footprints className="h-4 w-4 text-emerald-400" />}
          fallbackDate={stepsCtx.isFallback ? formatShortChip(stepsDay.date) : undefined}
          xLabels={stepsTrendDays.map((d) => formatShortChip(d.date))}
          series={[
            {
              name: 'Passi',
              type: 'bar',
              color: '#007CC3',
              data: stepsTrendDays.map((d) => d.steps ?? null),
            },
          ]}
          unit="passi"
          isMobile={isMobile}
          stats={[
            {
              label: 'Passi',
              value: stepsDay.steps !== undefined ? stepsDay.steps.toLocaleString('it-IT') : '—',
            },
            {
              label: 'Obiettivo',
              value: (stepsDay.stepsGoal ?? 10000).toLocaleString('it-IT'),
            },
            ...(stepsDay.caloriesTotal !== undefined
              ? [{ label: 'Calorie tot.', value: `${stepsDay.caloriesTotal}`, unit: 'kcal' }]
              : []),
            ...(stepsDay.caloriesActive !== undefined
              ? [{ label: 'Calorie att.', value: `${stepsDay.caloriesActive}`, unit: 'kcal' }]
              : []),
          ]}
        />
      )}

      {/* 7. PESO CORPOREO */}
      {weightDay && (
        <HealthChartCard
          title="Peso Corporeo"
          icon={<Scale className="h-4 w-4 text-[#A0A5AA]" />}
          fallbackDate={weightCtx.isFallback ? formatShortChip(weightDay.date) : undefined}
          xLabels={weightTrendDays.map((d) => formatShortChip(d.date))}
          series={
            weightTrendDays.length >= 2
              ? [
                  {
                    name: 'Peso',
                    type: 'line',
                    color: '#e2e8f0',
                    fill: true,
                    data: weightTrendDays.map((d) => d.weightKg ?? null),
                  },
                ]
              : []
          }
          unit="kg"
          isMobile={isMobile}
          stats={[
            {
              label: 'Peso',
              value: weightDay.weightKg !== undefined ? weightDay.weightKg.toFixed(1) : '—',
              unit: 'kg',
            },
            ...(weightTrendDays.length >= 2
              ? [
                  {
                    label: 'Minimo',
                    value: Math.min(...weightTrendDays.map((d) => d.weightKg!)).toFixed(1),
                    unit: 'kg',
                  },
                  {
                    label: 'Massimo',
                    value: Math.max(...weightTrendDays.map((d) => d.weightKg!)).toFixed(1),
                    unit: 'kg',
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}

interface ChartSeriesInput {
  name: string;
  type: 'line' | 'bar' | 'scatter';
  color: string;
  fill?: boolean;
  stack?: string;
  data: (number | null)[];
}

const HealthChartCard = memo(function HealthChartCard({
  title,
  icon,
  fallbackDate,
  sourceBadge,
  xLabels,
  series,
  stats,
  unit,
  yMin,
  yMax,
  baselineRange,
  isMobile,
}: {
  title: string;
  icon: React.ReactNode;
  fallbackDate?: string;
  sourceBadge?: string;
  xLabels: string[];
  series: ChartSeriesInput[];
  stats: StatColumn[];
  unit: string;
  yMin?: number;
  yMax?: number;
  baselineRange?: [number, number];
  isMobile: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const isLight = useIsLightTheme();
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 100]);
  const zoomRangeRef = useRef(zoomRange);
  zoomRangeRef.current = zoomRange;
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const hasChart = xLabels.length >= 2 && series.length > 0 && series.some((s) => s.data.some((v) => v !== null));

  useEffect(() => {
    setZoomRange([0, 100]);
  }, [xLabels.length]);

  useEffect(() => {
    if (!hasChart || !containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    // 2-finger pinch-to-zoom on X-axis (time/days)
    const el = containerRef.current;
    let pinchState: {
      startDist: number;
      startRange: [number, number];
      anchorPct: number;
    } | null = null;
    let raf: number | null = null;

    const getRatio = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      const padL = isMobileRef.current ? 6 : 44;
      const padR = isMobileRef.current ? 6 : 14;
      const w = Math.max(20, rect.width - padL - padR);
      return Math.max(0, Math.min(1, (clientX - rect.left - padL) / w));
    };

    const commitZoom = (next: [number, number]) => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setZoomRange([Number(next[0].toFixed(1)), Number(next[1].toFixed(1))]);
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        const mid = (getRatio(e.touches[0].clientX) + getRatio(e.touches[1].clientX)) / 2;
        const cur = zoomRangeRef.current;
        pinchState = {
          startDist: Math.max(12, d),
          startRange: [cur[0], cur[1]],
          anchorPct: cur[0] + mid * (cur[1] - cur[0]),
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchState) {
        e.preventDefault();
        const d = Math.max(
          12,
          Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY
          )
        );
        const mid = (getRatio(e.touches[0].clientX) + getRatio(e.touches[1].clientX)) / 2;
        const scale = pinchState.startDist / d;
        const span = Math.max(10, Math.min(100, (pinchState.startRange[1] - pinchState.startRange[0]) * scale));
        let s = pinchState.anchorPct - mid * span;
        let en = s + span;
        if (s < 0) {
          s = 0;
          en = span;
        }
        if (en > 100) {
          en = 100;
          s = Math.max(0, 100 - span);
        }
        commitZoom([s, en]);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchState = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('resize', handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [hasChart]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !hasChart) return;

    const total = xLabels.length;
    const startIdx = Math.max(0, Math.floor((zoomRange[0] / 100) * (total - 1)));
    const endIdx = Math.min(total - 1, Math.ceil((zoomRange[1] / 100) * (total - 1)));

    const gridOption = isMobile
      ? { left: 6, right: 6, top: 10, bottom: 22 }
      : { left: 44, right: 14, top: 12, bottom: 24 };

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
            lineStyle: { color: '#007CC3', width: 1.2 },
          },
        },
        grid: gridOption,
        xAxis: {
          type: 'category',
          data: xLabels.slice(startIdx, endIdx + 1),
          axisLine: { lineStyle: { color: ct.axisLine } },
          axisLabel: { color: ct.axisLabel, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          min: yMin,
          max: yMax,
          scale: yMin === undefined,
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
        series: series.map((s, idx) => ({
          name: unit ? `${s.name} (${unit})` : s.name,
          type: s.type,
          stack: s.stack,
          barMaxWidth: 20,
          symbolSize: s.type === 'scatter' ? 7 : 4,
          showSymbol: s.type === 'scatter',
          smooth: 0.25,
          connectNulls: true,
          lineStyle: s.type === 'line' ? { width: 2, color: s.color } : undefined,
          itemStyle: {
            color: s.color,
            borderRadius: s.type === 'bar' && !s.stack ? [4, 4, 0, 0] : undefined,
          },
          areaStyle:
            s.type === 'line' && s.fill
              ? {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: `${s.color}42` },
                    { offset: 1, color: `${s.color}04` },
                  ]),
                }
              : undefined,
          markArea:
            idx === 0 && baselineRange
              ? {
                  silent: true,
                  itemStyle: { color: 'rgba(16, 185, 129, 0.12)' },
                  data: [[{ yAxis: baselineRange[0] }, { yAxis: baselineRange[1] }]],
                }
              : undefined,
          data: s.data.slice(startIdx, endIdx + 1),
        })),
      },
      true
    );
  }, [hasChart, xLabels, series, zoomRange, isMobile, yMin, yMax, unit, baselineRange, isLight]);

  const isZoomed = zoomRange[0] > 0.5 || zoomRange[1] < 99.5;
  const colCount = Math.min(5, Math.max(2, stats.length));

  return (
    <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] px-2.5 py-3.5 sm:mx-0 sm:rounded-xl sm:border sm:p-4">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-bold text-white">{title}</span>
          {fallbackDate && (
            <span className="rounded-full bg-[#262626] px-2 py-0.5 text-[10px] font-medium text-[#A0A5AA]">
              Ultimo: {fallbackDate}
            </span>
          )}
          {sourceBadge && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
              {sourceBadge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {series.length > 1 && (
            <div className="hidden items-center gap-2.5 text-[11px] text-[#A0A5AA] sm:flex">
              {series.map((s) => (
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
          {isZoomed && (
            <button
              onClick={() => setZoomRange([0, 100])}
              className="flex items-center gap-1 rounded-full bg-[#262626] px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-[#323232]"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {hasChart && <div ref={containerRef} className="h-44 w-full touch-pan-y sm:h-48" />}

      {/* All available values underneath in clean Strava columns */}
      <div
        className={`${hasChart ? 'mt-3 border-t border-white/[0.07] pt-3' : 'mt-2'} grid gap-2 px-1`}
        style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
      >
        {stats.map((st) => (
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
