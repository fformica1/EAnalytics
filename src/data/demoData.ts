import type {
  ActivityDetail,
  ActivityLap,
  ActivitySummary,
  DailyHealth,
  StreamPoint,
  TimelinePoint,
} from '../types/fitness';

function buildCyclingStream(): { streams: StreamPoint[]; laps: ActivityLap[] } {
  const totalPoints = 240;
  const streams: StreamPoint[] = [];
  const baseLat = 38.1929;
  const baseLon = 15.2474;

  let distKm = 0;
  let ele = 18;
  for (let i = 0; i < totalPoints; i++) {
    const t = i * 18; // ~72 min ride
    const progress = i / totalPoints;
    const angle = progress * Math.PI * 2;

    // Loop near Milazzo cape & Peloritani foothills
    const lat = baseLat + Math.sin(angle) * 0.042 + Math.sin(angle * 3) * 0.006;
    const lon = baseLon + (1 - Math.cos(angle)) * 0.045 + Math.cos(angle * 2) * 0.008;

    // Realistic climb in the middle, fast descent after 55%
    const climbWave =
      progress < 0.2
        ? 0.4
        : progress < 0.55
          ? Math.sin(((progress - 0.2) / 0.35) * Math.PI) * 8.5
          : progress < 0.78
            ? -Math.sin(((progress - 0.55) / 0.23) * Math.PI) * 9.5
            : 0.2;

    ele = Math.max(10, ele + climbWave * 1.15);
    const grade = Number((climbWave * 1.05).toFixed(1));

    const speedKmh = Math.max(
      14,
      Math.min(54, 29.5 - grade * 1.65 + Math.sin(i * 0.35) * 2.1)
    );
    distKm += (speedKmh / 3600) * 18;

    const hr = Math.round(
      Math.max(115, Math.min(181, 134 + Math.max(0, grade) * 4.1 + (speedKmh > 38 ? 6 : 0) + Math.sin(i * 0.2) * 4))
    );
    const cad = Math.round(
      Math.max(62, Math.min(102, 86 - Math.max(0, grade) * 1.6 + Math.cos(i * 0.4) * 3))
    );
    const pwr = Math.round(
      Math.max(95, Math.min(390, 175 + Math.max(-3, grade) * 18 + Math.sin(i * 0.5) * 22))
    );
    const temp = Number((19.5 - (ele - 18) * 0.006).toFixed(1));

    streams.push({
      t,
      d: Number(distKm.toFixed(3)),
      lat,
      lon,
      ele: Number(ele.toFixed(1)),
      spd: Number(speedKmh.toFixed(1)),
      hr,
      cad,
      pwr,
      temp,
      grade,
    });
  }

  // Generate 5 km laps
  const laps: ActivityLap[] = [];
  let lapStartIdx = 0;
  let lapNumber = 1;
  for (let i = 1; i < streams.length; i++) {
    const lapDistKm = streams[i].d - streams[lapStartIdx].d;
    if (lapDistKm >= 5 || i === streams.length - 1) {
      const slice = streams.slice(lapStartIdx, i + 1);
      const dur = slice[slice.length - 1].t - slice[0].t;
      const distM = (slice[slice.length - 1].d - slice[0].d) * 1000;
      const avgHr = Math.round(slice.reduce((s, p) => s + (p.hr ?? 0), 0) / slice.length);
      const maxHr = Math.max(...slice.map((p) => p.hr ?? 0));
      const avgCad = Math.round(slice.reduce((s, p) => s + (p.cad ?? 0), 0) / slice.length);
      const avgPwr = Math.round(slice.reduce((s, p) => s + (p.pwr ?? 0), 0) / slice.length);
      let gain = 0;
      for (let j = 1; j < slice.length; j++) {
        const diff = (slice[j].ele ?? 0) - (slice[j - 1].ele ?? 0);
        if (diff > 0) gain += diff;
      }
      laps.push({
        index: lapNumber++,
        startTimeSec: slice[0].t,
        durationSec: Math.max(1, dur),
        distanceMeters: distM,
        avgSpeedMps: distM / Math.max(1, dur),
        avgHr,
        maxHr,
        avgCadence: avgCad,
        avgPower: avgPwr,
        elevationGain: Math.round(gain),
      });
      lapStartIdx = i;
    }
  }

  return { streams, laps };
}

function buildRunStream(): { streams: StreamPoint[]; laps: ActivityLap[] } {
  const totalPoints = 150;
  const streams: StreamPoint[] = [];
  const baseLat = 38.211;
  const baseLon = 15.239;

  let distKm = 0;
  let ele = 8;
  for (let i = 0; i < totalPoints; i++) {
    const t = i * 20; // 50 min run
    const progress = i / totalPoints;
    const angle = progress * Math.PI * 2;
    const lat = baseLat + Math.sin(angle) * 0.015;
    const lon = baseLon + Math.cos(angle) * 0.018;
    const grade = Number((Math.sin(progress * Math.PI * 3) * 2.2).toFixed(1));
    ele = Math.max(4, ele + grade * 0.45);
    const speedKmh = Math.max(10.2, Math.min(14.5, 12.6 - grade * 0.38 + Math.sin(i * 0.25) * 0.5));
    distKm += (speedKmh / 3600) * 20;
    const hr = Math.round(145 + progress * 18 + Math.max(0, grade) * 2.5 + Math.sin(i * 0.3) * 3);
    const cad = Math.round(172 + Math.sin(i * 0.4) * 3);

    streams.push({
      t,
      d: Number(distKm.toFixed(3)),
      lat,
      lon,
      ele: Number(ele.toFixed(1)),
      spd: Number(speedKmh.toFixed(1)),
      hr,
      cad,
      grade,
    });
  }

  const laps: ActivityLap[] = [];
  let lapStartIdx = 0;
  let lapNumber = 1;
  for (let i = 1; i < streams.length; i++) {
    if (streams[i].d - streams[lapStartIdx].d >= 1 || i === streams.length - 1) {
      const slice = streams.slice(lapStartIdx, i + 1);
      const dur = slice[slice.length - 1].t - slice[0].t;
      const distM = (slice[slice.length - 1].d - slice[0].d) * 1000;
      laps.push({
        index: lapNumber++,
        startTimeSec: slice[0].t,
        durationSec: Math.max(1, dur),
        distanceMeters: distM,
        avgSpeedMps: distM / Math.max(1, dur),
        avgHr: Math.round(slice.reduce((s, p) => s + (p.hr ?? 0), 0) / slice.length),
        maxHr: Math.max(...slice.map((p) => p.hr ?? 0)),
        avgCadence: Math.round(slice.reduce((s, p) => s + (p.cad ?? 0), 0) / slice.length),
      });
      lapStartIdx = i;
    }
  }
  return { streams, laps };
}

function build24hTimelines(seed: number): {
  bb: TimelinePoint[];
  stress: TimelinePoint[];
  hr: TimelinePoint[];
} {
  const bb: TimelinePoint[] = [];
  const stress: TimelinePoint[] = [];
  const hr: TimelinePoint[] = [];
  let battery = 34 + (seed % 12);

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const isSleep = h < 7;
      const isWorkout = h === 16 || (h === 17 && m === 0);

      if (isSleep) {
        battery = Math.min(98, battery + 4.3);
      } else if (isWorkout) {
        battery = Math.max(15, battery - 7.2);
      } else {
        battery = Math.max(18, battery - 1.5);
      }

      const st = isSleep
        ? 11 + Math.round(Math.sin(h + seed) * 3)
        : isWorkout
          ? 76
          : Math.max(15, Math.min(82, 34 + Math.round(Math.sin(h * 0.7 + seed) * 18)));

      const heart = isSleep
        ? 49 + Math.round(Math.sin(h + seed) * 3)
        : isWorkout
          ? 148 + (m === 30 ? 12 : 0)
          : 64 + Math.round(Math.cos(h * 0.5 + seed) * 10);

      bb.push({ t: label, v: Math.round(battery) });
      stress.push({ t: label, v: st });
      hr.push({ t: label, v: heart });
    }
  }

  return { bb, stress, hr };
}

export function createDemoDataset(): {
  activities: ActivitySummary[];
  details: ActivityDetail[];
  health: DailyHealth[];
} {
  const ride = buildCyclingStream();
  const run = buildRunStream();

  const rideDist = ride.streams[ride.streams.length - 1].d * 1000;
  const rideDur = ride.streams[ride.streams.length - 1].t;
  const runDist = run.streams[run.streams.length - 1].d * 1000;
  const runDur = run.streams[run.streams.length - 1].t;

  const today = new Date();
  const isoDay = (offsetDays: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10);
  };

  const activities: ActivitySummary[] = [
    {
      id: 'demo-ride-1',
      source: 'demo',
      name: 'Milazzo & Capo — Fondo con Salita (Demo)',
      sport: 'cycling',
      startTime: `${isoDay(1)}T15:30:00`,
      distanceMeters: rideDist,
      durationSeconds: rideDur,
      movingDurationSeconds: rideDur - 24,
      elevationGainMeters: 432,
      elevationLossMeters: 428,
      avgSpeedMps: rideDist / rideDur,
      maxSpeedMps: 53.6 / 3.6,
      avgHr: 147,
      maxHr: 179,
      avgCadence: 83,
      maxCadence: 101,
      avgPower: 206,
      normalizedPower: 224,
      maxPower: 382,
      calories: 745,
      aerobicTe: 3.7,
      anaerobicTe: 1.5,
      locationName: 'Milazzo',
      hasStreams: true,
      hrZonesSeconds: [410, 1320, 1480, 890, 202],
      powerZonesSeconds: [620, 1180, 1250, 740, 390, 122],
      previewCoords: ride.streams
        .filter((_, idx) => idx % 5 === 0 && ride.streams[idx].lat && ride.streams[idx].lon)
        .map((p) => [p.lat!, p.lon!]),
    },
    {
      id: 'demo-run-2',
      source: 'demo',
      name: 'Lungomare Ponente — Progressivo 10K (Demo)',
      sport: 'running',
      startTime: `${isoDay(3)}T07:15:00`,
      distanceMeters: runDist,
      durationSeconds: runDur,
      movingDurationSeconds: runDur,
      elevationGainMeters: 46,
      elevationLossMeters: 44,
      avgSpeedMps: runDist / runDur,
      maxSpeedMps: 14.5 / 3.6,
      avgHr: 154,
      maxHr: 172,
      avgCadence: 173,
      maxCadence: 181,
      calories: 618,
      aerobicTe: 3.4,
      anaerobicTe: 0.8,
      locationName: 'Milazzo',
      hasStreams: true,
      hrZonesSeconds: [180, 740, 1280, 680, 100],
      previewCoords: run.streams
        .filter((_, idx) => idx % 4 === 0 && run.streams[idx].lat && run.streams[idx].lon)
        .map((p) => [p.lat!, p.lon!]),
    },
  ];

  const details: ActivityDetail[] = [
    { activityId: 'demo-ride-1', streams: ride.streams, laps: ride.laps },
    { activityId: 'demo-run-2', streams: run.streams, laps: run.laps },
  ];

  const health: DailyHealth[] = Array.from({ length: 14 }).map((_, i) => {
    const date = isoDay(i);
    const { bb, stress, hr } = build24hTimelines(i);
    const deep = 4500 + (i % 4) * 420;
    const rem = 5100 + ((i + 1) % 3) * 380;
    const light = 15200 + (i % 5) * 600;
    const awake = 650 + (i % 3) * 180;
    const totalSleep = deep + rem + light;
    const hrv = 58 + Math.round(Math.sin(i * 0.7) * 9);
    const rhr = 50 + (i % 4);
    const maxBb = Math.max(...bb.map((p) => p.v));
    const minBb = Math.min(...bb.map((p) => p.v));

    return {
      date,
      sleepSeconds: totalSleep,
      deepSleepSeconds: deep,
      lightSleepSeconds: light,
      remSleepSeconds: rem,
      awakeSleepSeconds: awake,
      sleepScore: 76 + ((i * 3) % 18),
      hrvLastNight: hrv,
      hrvWeeklyAvg: 59,
      hrvStatus: hrv >= 52 ? 'BALANCED' : 'LOW',
      hrvBaselineLow: 51,
      hrvBaselineHigh: 72,
      rhr,
      hrMin: rhr - 3,
      hrMax: i === 1 ? 179 : 138 + (i % 15),
      bodyBatteryCharged: maxBb - 32,
      bodyBatteryDrained: maxBb - minBb,
      bodyBatteryMax: maxBb,
      bodyBatteryMin: minBb,
      bodyBatteryCurrent: bb[bb.length - 1].v,
      bodyBatteryTimeline: bb,
      stressAvg: Math.round(stress.reduce((s, p) => s + p.v, 0) / stress.length),
      stressMax: Math.max(...stress.map((p) => p.v)),
      stressTimeline: stress,
      hrTimeline: hr,
      steps: 7800 + ((i * 1340) % 6200),
      stepsGoal: 10000,
      caloriesTotal: 2240 + (i === 1 ? 745 : 320),
      caloriesActive: i === 1 ? 820 : 410,
      spo2Avg: 97,
      respirationAvg: 14.2,
      weightKg: Number((72.4 - i * 0.03).toFixed(1)),
    };
  });

  return { activities, details, health };
}
