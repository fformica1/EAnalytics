import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Loader2,
  MapPin,
} from 'lucide-react';
import type { ActivityDetail, ActivitySummary } from '../types/fitness';
import {
  formatDateTime,
  formatDuration,
  formatDurationHMS,
  formatPrimarySpeedOrPace,
  isRunningLike,
  sportLabel,
} from '../utils/formatters';
import { ActivityMap } from './ActivityMap';
import { ActivityCharts } from './ActivityCharts';

interface ActivityDetailViewProps {
  activity: ActivitySummary;
  detail?: ActivityDetail;
  onDownloadGarminFit?: (activity: ActivitySummary) => Promise<void>;
  onDownloadIntervalsStreams?: (activity: ActivitySummary) => Promise<void>;
  onDownloadStravaStreams?: (activity: ActivitySummary) => Promise<void>;
}

const HR_ZONE_LABELS = [
  { zone: 'Z1', name: 'Recupero', color: '#94a3b8' },
  { zone: 'Z2', name: 'Aerobico', color: '#38bdf8' },
  { zone: 'Z3', name: 'Tempo', color: '#10b981' },
  { zone: 'Z4', name: 'Soglia', color: '#ff6b2c' },
  { zone: 'Z5', name: 'Massimale', color: '#f43f5e' },
];

const PWR_ZONE_LABELS = [
  { zone: 'Z1', name: 'Recupero', color: '#94a3b8' },
  { zone: 'Z2', name: 'Resistenza', color: '#38bdf8' },
  { zone: 'Z3', name: 'Tempo', color: '#10b981' },
  { zone: 'Z4', name: 'Soglia FTP', color: '#f59e0b' },
  { zone: 'Z5', name: 'VO2Max', color: '#ff6b2c' },
  { zone: 'Z6', name: 'Anaerobico', color: '#f43f5e' },
];

export function ActivityDetailView({
  activity,
  detail,
  onDownloadGarminFit,
  onDownloadIntervalsStreams,
  onDownloadStravaStreams,
}: ActivityDetailViewProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedLapIndex, setSelectedLapIndex] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const autoTriedRef = useRef<string | null>(null);

  const streams = detail?.streams ?? [];
  const laps = detail?.laps ?? [];
  const running = isRunningLike(activity.sport);

  const handleHoverIndex = useCallback((idx: number | null) => {
    setHoverIndex(idx);
  }, []);

  const selectedLap = useMemo(
    () => laps.find((l) => l.index === selectedLapIndex) ?? null,
    [laps, selectedLapIndex]
  );

  const highlightRange: [number, number] | null = selectedLap
    ? [selectedLap.startTimeSec, selectedLap.startTimeSec + selectedLap.durationSec]
    : null;

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setDownloadErr(null);
    try {
      if (activity.garminActivityId && onDownloadGarminFit) {
        await onDownloadGarminFit(activity);
      } else if (activity.intervalsActivityId && onDownloadIntervalsStreams) {
        await onDownloadIntervalsStreams(activity);
      } else if (activity.stravaActivityId && onDownloadStravaStreams) {
        await onDownloadStravaStreams(activity);
      }
    } catch (err) {
      setDownloadErr(err instanceof Error ? err.message : 'Errore scaricamento traccia');
    } finally {
      setDownloading(false);
    }
  }, [activity, onDownloadGarminFit, onDownloadIntervalsStreams, onDownloadStravaStreams]);

  // Auto-download or upgrade old cached activities (< parserVersion 6)
  useEffect(() => {
    const needsFetch = streams.length === 0 || (activity.parserVersion ?? 1) < 6;
    const canFetch =
      (activity.garminActivityId && onDownloadGarminFit) ||
      (activity.intervalsActivityId && onDownloadIntervalsStreams && streams.length === 0) ||
      (activity.stravaActivityId && onDownloadStravaStreams && streams.length === 0);
    if (needsFetch && canFetch && autoTriedRef.current !== activity.id) {
      autoTriedRef.current = activity.id;
      void handleDownload();
    }
  }, [
    activity.id,
    activity.garminActivityId,
    activity.intervalsActivityId,
    activity.stravaActivityId,
    activity.parserVersion,
    streams.length,
    onDownloadGarminFit,
    onDownloadIntervalsStreams,
    onDownloadStravaStreams,
    handleDownload,
  ]);

  const totalHrZoneSec = (activity.hrZonesSeconds ?? []).reduce((a, b) => a + b, 0);
  const totalPwrZoneSec = (activity.powerZonesSeconds ?? []).reduce((a, b) => a + b, 0);

  const maxLapSpeed = useMemo(
    () => Math.max(...laps.map((l) => l.avgSpeedMps || 0), 0.1),
    [laps]
  );

  const summaryStats = useMemo(() => {
    const items: { label: string; value: string; unit?: string; sub?: string }[] = [];
    const movingSec = activity.movingDurationSeconds || activity.durationSeconds;
    const isSwim = activity.sport === 'swimming';
    const isStrengthOrIndoor =
      activity.sport === 'strength' ||
      (activity.sport === 'other' && activity.distanceMeters < 100);

    if (!isStrengthOrIndoor) {
      if (isSwim) {
        items.push({
          label: 'Distanza',
          value: `${Math.round(activity.distanceMeters)}`,
          unit: 'm',
        });
      } else {
        items.push({
          label: 'Distanza',
          value: (activity.distanceMeters / 1000).toFixed(2),
          unit: 'km',
        });
      }
    }

    items.push({
      label: isStrengthOrIndoor ? 'Durata' : 'Tempo mov.',
      value: formatDuration(movingSec),
      sub:
        !isStrengthOrIndoor && activity.durationSeconds > movingSec + 5
          ? `Tot ${formatDuration(activity.durationSeconds)}`
          : undefined,
    });

    if (!isStrengthOrIndoor && activity.avgSpeedMps > 0.1) {
      const primarySpeedOrPace = formatPrimarySpeedOrPace(activity.avgSpeedMps, activity.sport);
      const paceUnit = isSwim ? '/100m' : running ? '/km' : 'km/h';
      items.push({
        label: isSwim || running ? 'Passo medio' : 'Vel. media',
        value: primarySpeedOrPace
          .replace(' km/h', '')
          .replace(' /100m', '')
          .replace(' /km', ''),
        unit: paceUnit,
        sub:
          activity.maxSpeedMps > 0
            ? `${isSwim || running ? 'Best' : 'Max'} ${formatPrimarySpeedOrPace(activity.maxSpeedMps, activity.sport)}`
            : undefined,
      });
    }

    if (!isStrengthOrIndoor && !isSwim && (activity.elevationGainMeters > 0 || activity.sport === 'cycling' || activity.sport === 'trail_running')) {
      items.push({
        label: 'Dislivello D+',
        value: `${Math.round(activity.elevationGainMeters)}`,
        unit: 'm',
        sub:
          activity.elevationLossMeters > 0
            ? `D- ${Math.round(activity.elevationLossMeters)} m`
            : undefined,
      });

      if (activity.elevationGainMeters > 30 && movingSec > 300) {
        const vam = Math.round(activity.elevationGainMeters / (movingSec / 3600));
        items.push({
          label: 'VAM media',
          value: `${vam}`,
          unit: 'm/h',
        });
      }
    }

    if (activity.avgHr) {
      items.push({
        label: 'FC Media',
        value: `${activity.avgHr}`,
        unit: 'bpm',
        sub: activity.maxHr ? `Max ${activity.maxHr} bpm` : undefined,
      });
    }

    if (activity.avgPower) {
      items.push({
        label: activity.isEstimatedPower ? 'Potenza stimata' : 'Potenza',
        value: `${activity.avgPower}`,
        unit: 'W',
        sub: activity.normalizedPower
          ? `NP ${activity.normalizedPower} W${activity.maxPower ? ` • Max ${activity.maxPower} W` : ''}`
          : activity.maxPower
            ? `Max ${activity.maxPower} W`
            : undefined,
      });
    }

    if (activity.tss || activity.intensityFactor || activity.totalWorkKj) {
      if (activity.totalWorkKj) {
        items.push({ label: 'Lavoro', value: `${activity.totalWorkKj}`, unit: 'kJ' });
      }
      if (activity.tss) {
        items.push({
          label: 'TSS',
          value: `${Math.round(activity.tss)}`,
          sub: activity.intensityFactor ? `IF ${activity.intensityFactor.toFixed(2)}` : undefined,
        });
      }
    }

    if (activity.lrBalanceLeftPct !== undefined && activity.lrBalanceRightPct !== undefined) {
      items.push({
        label: 'Bilanc. Sx/Dx',
        value: `${Math.round(activity.lrBalanceLeftPct)}/${Math.round(activity.lrBalanceRightPct)}`,
        unit: '%',
      });
    }

    if (activity.avgLeftTorqueEff !== undefined || activity.avgRightTorqueEff !== undefined) {
      items.push({
        label: 'Efficienza coppia',
        value: `${activity.avgLeftTorqueEff ?? '—'}/${activity.avgRightTorqueEff ?? '—'}`,
        unit: '%',
      });
    }

    if (activity.avgLeftSmoothness !== undefined || activity.avgRightSmoothness !== undefined) {
      items.push({
        label: 'Fluidità pedalata',
        value: `${activity.avgLeftSmoothness ?? '—'}/${activity.avgRightSmoothness ?? '—'}`,
        unit: '%',
      });
    }

    if (activity.avgLeftPco !== undefined || activity.avgRightPco !== undefined) {
      items.push({
        label: 'PCO Sx/Dx',
        value: `${activity.avgLeftPco ?? '—'}/${activity.avgRightPco ?? '—'}`,
        unit: 'mm',
      });
    }

    if (activity.avgVerticalOscillationMm !== undefined) {
      items.push({
        label: 'Oscill. verticale',
        value: activity.avgVerticalOscillationMm.toFixed(1),
        unit: 'mm',
        sub: activity.avgVerticalRatioPct ? `Rapp. ${activity.avgVerticalRatioPct}%` : undefined,
      });
    }

    if (activity.avgStanceTimeMs !== undefined) {
      items.push({
        label: 'Contatto suolo',
        value: `${activity.avgStanceTimeMs}`,
        unit: 'ms',
        sub: activity.avgStanceTimeBalancePct
          ? `Bil. ${activity.avgStanceTimeBalancePct}%`
          : undefined,
      });
    }

    if (activity.avgStepLengthMm !== undefined) {
      items.push({
        label: 'Lunghezza passo',
        value: (activity.avgStepLengthMm / 1000).toFixed(2),
        unit: 'm',
      });
    }

    if (activity.avgCadence) {
      items.push({
        label: 'Cadenza media',
        value: `${activity.avgCadence}`,
        unit: running ? 'spm' : 'rpm',
        sub: activity.maxCadence
          ? `Max ${activity.maxCadence} ${running ? 'spm' : 'rpm'}`
          : undefined,
      });
    }

    if (activity.avgRespiration) {
      items.push({
        label: 'Respirazione',
        value: activity.avgRespiration.toFixed(1),
        unit: 'brpm',
        sub: activity.maxRespiration ? `Max ${activity.maxRespiration.toFixed(1)}` : undefined,
      });
    }

    if (activity.calories) {
      items.push({
        label: 'Calorie',
        value: `${activity.calories}`,
        unit: 'kcal',
        sub: activity.bmrCalories
          ? `Attive ${Math.max(0, activity.calories - activity.bmrCalories)} kcal`
          : undefined,
      });
    }

    if (activity.trainingLoad) {
      items.push({
        label: 'Training Load',
        value: `${Math.round(activity.trainingLoad)}`,
      });
    }

    if (activity.aerobicTe !== undefined) {
      items.push({
        label: 'Garmin TE',
        value: `${activity.aerobicTe} / ${activity.anaerobicTe ?? '0.0'}`,
        sub: 'Aerob. / Anaer.',
      });
    }

    if (activity.totalStrokes) {
      items.push({
        label:
          activity.sport === 'swimming'
            ? 'Bracciate'
            : running
              ? 'Passi'
              : 'Colpi pedale',
        value: activity.totalStrokes.toLocaleString('it-IT'),
      });
    }

    return items;
  }, [activity, running]);

  const formattedDate = useMemo(() => {
    const normalized = activity.startTime.includes(' ')
      ? activity.startTime.replace(' ', 'T')
      : activity.startTime;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return formatDateTime(activity.startTime);
    const dayStr = d.toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timeStr = d.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${dayStr.charAt(0).toUpperCase() + dayStr.slice(1)} alle ${timeStr}`;
  }, [activity.startTime]);

  const hasGpsTrace = useMemo(
    () => streams.some((p) => p.lat !== undefined && p.lon !== undefined),
    [streams]
  );

  const completeStatsGroups = useMemo(() => {
    const groups: { title: string; rows: { label: string; value: string }[] }[] = [];
    const movingSec = activity.movingDurationSeconds || activity.durationSeconds;
    const totalSec = activity.durationSeconds || movingSec;
    const stoppedSec = Math.max(0, totalSec - movingSec);
    const isSwim = activity.sport === 'swimming';
    const isStrengthOrIndoor =
      activity.sport === 'strength' ||
      (activity.sport === 'other' && activity.distanceMeters < 100);

    const generalRows: { label: string; value: string }[] = [];
    if (!isStrengthOrIndoor) {
      generalRows.push({
        label: 'Distanza',
        value: isSwim
          ? `${Math.round(activity.distanceMeters)} m`
          : `${(activity.distanceMeters / 1000).toFixed(2)} km`,
      });
    }
    generalRows.push({ label: 'Tempo in movimento', value: formatDurationHMS(movingSec) });
    if (totalSec > movingSec + 2) {
      generalRows.push({ label: 'Tempo trascorso', value: formatDurationHMS(totalSec) });
      generalRows.push({ label: 'Tempo fermo', value: formatDurationHMS(stoppedSec) });
    }
    if (!isStrengthOrIndoor && activity.avgSpeedMps > 0.1) {
      generalRows.push({
        label: isSwim || running ? 'Passo medio (mov.)' : 'Vel. media (mov.)',
        value: formatPrimarySpeedOrPace(activity.avgSpeedMps, activity.sport),
      });
      if (totalSec > movingSec + 5 && activity.distanceMeters > 0) {
        generalRows.push({
          label: isSwim || running ? 'Passo medio totale' : 'Vel. media totale',
          value: formatPrimarySpeedOrPace(activity.distanceMeters / totalSec, activity.sport),
        });
      }
      if (activity.maxSpeedMps > 0) {
        generalRows.push({
          label: isSwim || running ? 'Passo migliore' : 'Vel. massima',
          value: formatPrimarySpeedOrPace(activity.maxSpeedMps, activity.sport),
        });
      }
    }
    groups.push({ title: 'Tempi & Andatura', rows: generalRows });

    if (activity.avgHr || activity.maxHr || activity.minHr) {
      const hrRows: { label: string; value: string }[] = [];
      if (activity.avgHr) hrRows.push({ label: 'FC Media', value: `${activity.avgHr} bpm` });
      if (activity.maxHr) hrRows.push({ label: 'FC Massima', value: `${activity.maxHr} bpm` });
      if (activity.minHr) hrRows.push({ label: 'FC Minima', value: `${activity.minHr} bpm` });
      groups.push({ title: 'Frequenza Cardiaca', rows: hrRows });
    }

    if (
      activity.avgPower ||
      activity.normalizedPower ||
      activity.maxPower ||
      activity.tss ||
      activity.totalWorkKj
    ) {
      const pwrRows: { label: string; value: string }[] = [];
      if (activity.avgPower) {
        pwrRows.push({
          label: activity.isEstimatedPower ? 'Potenza stimata media' : 'Potenza media',
          value: `${activity.avgPower} W`,
        });
      }
      if (activity.normalizedPower) {
        pwrRows.push({ label: 'Normalized Power (NP)', value: `${activity.normalizedPower} W` });
      }
      if (activity.maxPower) {
        pwrRows.push({ label: 'Potenza massima', value: `${activity.maxPower} W` });
      }
      if (activity.normalizedPower && activity.avgPower && activity.avgPower > 0) {
        pwrRows.push({
          label: 'Variability Index (VI)',
          value: (activity.normalizedPower / activity.avgPower).toFixed(2),
        });
      }
      if (activity.intensityFactor) {
        pwrRows.push({ label: 'Intensity Factor (IF)', value: activity.intensityFactor.toFixed(2) });
      }
      if (activity.tss) {
        pwrRows.push({ label: 'TSS', value: `${Math.round(activity.tss)}` });
      }
      if (activity.totalWorkKj) {
        pwrRows.push({ label: 'Lavoro totale', value: `${activity.totalWorkKj} kJ` });
      }
      if (activity.thresholdPowerWatts) {
        pwrRows.push({ label: 'FTP rilevata', value: `${activity.thresholdPowerWatts} W` });
      }
      groups.push({ title: 'Potenza & Intensità', rows: pwrRows });
    }

    const dynRows: { label: string; value: string }[] = [];
    const cadUnit = running ? 'spm' : 'rpm';
    if (activity.avgCadence) dynRows.push({ label: 'Cadenza media', value: `${activity.avgCadence} ${cadUnit}` });
    if (activity.maxCadence) dynRows.push({ label: 'Cadenza massima', value: `${activity.maxCadence} ${cadUnit}` });
    if (activity.lrBalanceLeftPct !== undefined && activity.lrBalanceRightPct !== undefined) {
      dynRows.push({
        label: 'Bilanciamento Sx / Dx',
        value: `${activity.lrBalanceLeftPct.toFixed(1)}% / ${activity.lrBalanceRightPct.toFixed(1)}%`,
      });
    }
    if (activity.avgLeftTorqueEff !== undefined || activity.avgRightTorqueEff !== undefined) {
      dynRows.push({
        label: 'Efficienza coppia Sx / Dx',
        value: `${activity.avgLeftTorqueEff ?? '—'}% / ${activity.avgRightTorqueEff ?? '—'}%`,
      });
    }
    if (activity.avgLeftSmoothness !== undefined || activity.avgRightSmoothness !== undefined) {
      dynRows.push({
        label: 'Fluidità pedalata Sx / Dx',
        value: `${activity.avgLeftSmoothness ?? '—'}% / ${activity.avgRightSmoothness ?? '—'}%`,
      });
    }
    if (activity.avgCombinedSmoothness !== undefined) {
      dynRows.push({ label: 'Fluidità combinata', value: `${activity.avgCombinedSmoothness}%` });
    }
    if (activity.avgLeftPco !== undefined || activity.avgRightPco !== undefined) {
      dynRows.push({
        label: 'PCO (Centro Pressione) Sx / Dx',
        value: `${activity.avgLeftPco ?? '—'} / ${activity.avgRightPco ?? '—'} mm`,
      });
    }
    if (activity.timeStandingSec !== undefined && activity.timeStandingSec > 0) {
      dynRows.push({ label: 'Tempo fuori sella', value: formatDurationHMS(activity.timeStandingSec) });
    }
    if (activity.standCount !== undefined && activity.standCount > 0) {
      dynRows.push({ label: 'Alzate sui pedali', value: `${activity.standCount}` });
    }
    if (activity.avgVerticalOscillationMm !== undefined) {
      dynRows.push({ label: 'Oscillazione verticale', value: `${activity.avgVerticalOscillationMm.toFixed(1)} mm` });
    }
    if (activity.avgVerticalRatioPct !== undefined) {
      dynRows.push({ label: 'Rapporto verticale', value: `${activity.avgVerticalRatioPct}%` });
    }
    if (activity.avgStanceTimeMs !== undefined) {
      dynRows.push({ label: 'Tempo contatto suolo', value: `${activity.avgStanceTimeMs} ms` });
    }
    if (activity.avgStanceTimeBalancePct !== undefined) {
      dynRows.push({
        label: 'Bilanc. contatto Sx / Dx',
        value: `${activity.avgStanceTimeBalancePct}% / ${(100 - activity.avgStanceTimeBalancePct).toFixed(1)}%`,
      });
    }
    if (activity.avgStepLengthMm !== undefined) {
      dynRows.push({ label: 'Lunghezza passo media', value: `${(activity.avgStepLengthMm / 1000).toFixed(2)} m` });
    }
    if (activity.poolLengthMeters !== undefined) {
      dynRows.push({ label: 'Lunghezza vasca', value: `${activity.poolLengthMeters} m` });
    }
    if (activity.activeLengths !== undefined) {
      dynRows.push({ label: 'Vasche attive', value: `${activity.activeLengths}` });
    }
    if (activity.avgSwolf !== undefined) {
      dynRows.push({ label: 'SWOLF medio', value: `${activity.avgSwolf}` });
    }
    if (activity.totalStrokes) {
      dynRows.push({
        label: isSwim ? 'Bracciate totali' : running ? 'Passi stimati' : 'Colpi di pedale',
        value: activity.totalStrokes.toLocaleString('it-IT'),
      });
    }
    if (dynRows.length > 0) groups.push({ title: 'Dinamiche & Tecnica', rows: dynRows });

    const envRows: { label: string; value: string }[] = [];
    if (!isSwim && !isStrengthOrIndoor) {
      if (activity.elevationGainMeters > 0) {
        envRows.push({ label: 'Ascesa totale (D+)', value: `${Math.round(activity.elevationGainMeters)} m` });
      }
      if (activity.elevationLossMeters > 0) {
        envRows.push({ label: 'Discesa totale (D-)', value: `${Math.round(activity.elevationLossMeters)} m` });
      }
      if (activity.minElevationMeters !== undefined) {
        envRows.push({ label: 'Quota minima', value: `${activity.minElevationMeters} m` });
      }
      if (activity.maxElevationMeters !== undefined) {
        envRows.push({ label: 'Quota massima', value: `${activity.maxElevationMeters} m` });
      }
      if (activity.elevationGainMeters > 30 && movingSec > 300) {
        envRows.push({
          label: 'VAM media',
          value: `${Math.round(activity.elevationGainMeters / (movingSec / 3600))} m/h`,
        });
      }
    }
    if (activity.avgTempC !== undefined) envRows.push({ label: 'Temperatura media', value: `${activity.avgTempC} °C` });
    if (activity.minTempC !== undefined) envRows.push({ label: 'Temperatura minima', value: `${activity.minTempC} °C` });
    if (activity.maxTempC !== undefined) envRows.push({ label: 'Temperatura massima', value: `${activity.maxTempC} °C` });
    if (activity.avgRespiration !== undefined) {
      envRows.push({ label: 'Respirazione media', value: `${activity.avgRespiration} brpm` });
    }
    if (activity.minRespiration !== undefined) {
      envRows.push({ label: 'Respirazione minima', value: `${activity.minRespiration} brpm` });
    }
    if (activity.maxRespiration !== undefined) {
      envRows.push({ label: 'Respirazione massima', value: `${activity.maxRespiration} brpm` });
    }
    if (activity.grit !== undefined) envRows.push({ label: 'Garmin Grit', value: `${activity.grit}` });
    if (activity.flow !== undefined) envRows.push({ label: 'Garmin Flow', value: `${activity.flow}` });
    if (envRows.length > 0) groups.push({ title: 'Altitudine & Ambiente', rows: envRows });

    const energyRows: { label: string; value: string }[] = [];
    if (activity.calories) energyRows.push({ label: 'Calorie totali', value: `${activity.calories} kcal` });
    if (activity.calories && activity.bmrCalories) {
      energyRows.push({
        label: 'Calorie attive',
        value: `${Math.max(0, activity.calories - activity.bmrCalories)} kcal`,
      });
      energyRows.push({ label: 'Calorie a riposo (BMR)', value: `${activity.bmrCalories} kcal` });
    }
    if (activity.trainingLoad !== undefined) {
      energyRows.push({ label: 'Training Load', value: `${Math.round(activity.trainingLoad)}` });
    }
    if (activity.aerobicTe !== undefined) {
      energyRows.push({ label: 'Training Effect Aerobico', value: `${activity.aerobicTe}` });
    }
    if (activity.anaerobicTe !== undefined) {
      energyRows.push({ label: 'Training Effect Anaerobico', value: `${activity.anaerobicTe}` });
    }
    if (activity.vo2MaxValue !== undefined) {
      energyRows.push({ label: 'VO2Max rilevato', value: `${activity.vo2MaxValue} ml/kg/min` });
    }
    if (activity.waterEstimatedMl !== undefined) {
      energyRows.push({ label: 'Perdita sudore stimata', value: `${activity.waterEstimatedMl} ml` });
    }
    if (activity.steps !== undefined && activity.steps > 0) {
      energyRows.push({ label: 'Passi', value: activity.steps.toLocaleString('it-IT') });
    }
    if (energyRows.length > 0) groups.push({ title: 'Energia & Carico Garmin', rows: energyRows });

    if (activity.extraFields && activity.extraFields.length > 0 && streams.length > 0) {
      const iqRows: { label: string; value: string }[] = [];
      for (const ef of activity.extraFields) {
        const vals = streams
          .map((p) => p.extra?.[ef.key])
          .filter((v): v is number => v !== undefined && Number.isFinite(v));
        if (vals.length === 0) continue;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const max = Math.max(...vals);
        const unit = ef.unit ? ` ${ef.unit}` : '';
        iqRows.push({
          label: ef.label,
          value: `${avg.toFixed(1)}${unit} (max ${max.toFixed(1)}${unit})`,
        });
      }
      if (iqRows.length > 0) groups.push({ title: 'Campi Connect IQ', rows: iqRows });
    }

    return groups;
  }, [activity, running, streams]);

  return (
    <div className="pb-10 lg:grid lg:grid-cols-12 lg:items-stretch lg:gap-4">
      {/* Mobile: Sticky Large Strava-Style Map Hero | Desktop: Left Map Column (Row 2, equal height) */}
      {hasGpsTrace && (
        <div className="sticky top-14 z-0 -mx-3 sm:mx-0 lg:static lg:z-auto lg:order-2 lg:col-span-6 lg:h-full">
          <ActivityMap
            streams={streams}
            sport={activity.sport}
            hoverIndex={hoverIndex}
            highlightRange={highlightRange}
            heroSheet
          />
        </div>
      )}

      {/* Mobile: Sliding Sheet | Desktop: lg:contents places Title full-width (order-1), Stats right (order-3), Charts below (order-4) */}
      <div
        className={
          hasGpsTrace
            ? 'relative z-10 -mx-3 -mt-6 space-y-3 rounded-t-3xl border-t border-white/[0.1] bg-[#121212] px-3 pt-2.5 shadow-[0_-12px_36px_rgba(0,0,0,0.75)] sm:mx-0 sm:space-y-4 sm:px-0 sm:pt-3 lg:contents'
            : 'space-y-3 pt-3 sm:space-y-4 sm:pt-0 lg:contents'
        }
      >
        {hasGpsTrace && <div className="mx-auto h-1 w-10 rounded-full bg-white/20 lg:hidden" />}

        {/* Desktop Row 1 Full Width: Activity Title, Date, Time & Location */}
        <div className="space-y-3 lg:order-1 lg:col-span-12">
          <div className="-mx-3 border-b border-white/[0.08] bg-[#1E1E1E] px-4 py-3.5 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  {activity.name}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#A0A5AA]">
                  <span className="font-semibold text-[#D4D6D9]">
                    {sportLabel(activity.sport)}
                  </span>
                  <span>·</span>
                  <span>{formattedDate}</span>
                  {activity.locationName && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-[#D4D6D9]">
                        <MapPin className="h-3.5 w-3.5 text-[#007CC3]" />
                        {activity.locationName}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {!activity.hasStreams && activity.garminActivityId && onDownloadGarminFit && (
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#007CC3] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0065A0] disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {downloading ? 'Scarico...' : 'Scarica .FIT'}
                </button>
              )}
            </div>
          </div>

          {downloading && (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#1E1E1E] px-4 py-2.5 text-xs text-white">
              <Loader2 className="h-4 w-4 animate-spin text-[#007CC3]" />
              <span>Scaricamento e decodifica dati grezzi .FIT...</span>
            </div>
          )}

          {downloadErr && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300">
              {downloadErr}
            </div>
          )}
        </div>

        {/* Desktop Row 2 Right Column (equal height with Map): Summary Stats */}
        <div
          className={`-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5 lg:order-3 lg:h-full ${
            hasGpsTrace ? 'lg:col-span-6' : 'lg:col-span-12'
          }`}
        >
          <div className="grid grid-cols-3 gap-x-4 gap-y-4">
            {summaryStats.map((st) => (
              <StravaHeroStat
                key={st.label}
                label={st.label}
                value={st.value}
                unit={st.unit}
                sub={st.sub}
              />
            ))}
          </div>
        </div>

        {/* Synchronized Full-Width Individual Metric Charts */}
        <div className="lg:order-4 lg:col-span-12">
          <ActivityCharts
            activity={activity}
            streams={streams}
            laps={laps}
            onHoverIndex={handleHoverIndex}
          />
        </div>

        {/* Zones & Strava Splits */}
        <div className="grid grid-cols-1 gap-3 lg:order-5 lg:col-span-12 lg:grid-cols-12 lg:gap-4">
        {(totalHrZoneSec > 0 || totalPwrZoneSec > 0) && (
          <div className="-mx-3 space-y-5 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border lg:col-span-5">
            {totalHrZoneSec > 0 && activity.hrZonesSeconds && (
              <div>
                <h3 className="mb-3 text-sm font-bold text-white">
                  Zone Frequenza Cardiaca
                </h3>
                <div className="space-y-2.5">
                  {activity.hrZonesSeconds.map((sec, idx) => {
                    const pct = Math.round((sec / totalHrZoneSec) * 100);
                    const meta = HR_ZONE_LABELS[idx];

  return (
                      <div key={meta.zone} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-6 rounded px-1 py-0.5 text-center text-[10px] font-bold text-[#121212]"
                              style={{ backgroundColor: meta.color }}
                            >
                              {meta.zone}
                            </span>
                            <span className="font-medium text-[#E5E5E5]">{meta.name}</span>
                          </div>
                          <span className="text-xs font-semibold tabular-nums text-white">
                            {formatDuration(sec)}{' '}
                            <span className="text-[#A0A5AA]">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#121212]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: meta.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {totalPwrZoneSec > 0 && activity.powerZonesSeconds && (
              <div className="border-t border-white/[0.07] pt-4">
                <h3 className="mb-3 text-sm font-bold text-white">
                  {activity.isEstimatedPower ? 'Zone Potenza Stimata' : 'Zone Potenza'}
                </h3>
                <div className="space-y-2.5">
                  {activity.powerZonesSeconds.map((sec, idx) => {
                    const pct = Math.round((sec / totalPwrZoneSec) * 100);
                    const meta = PWR_ZONE_LABELS[idx];

  return (
                      <div key={meta.zone} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-6 rounded px-1 py-0.5 text-center text-[10px] font-bold text-[#121212]"
                              style={{ backgroundColor: meta.color }}
                            >
                              {meta.zone}
                            </span>
                            <span className="font-medium text-[#E5E5E5]">{meta.name}</span>
                          </div>
                          <span className="text-xs font-semibold tabular-nums text-white">
                            {formatDuration(sec)}{' '}
                            <span className="text-[#A0A5AA]">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#121212]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: meta.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Strava-style Splits Table */}
        {laps.length > 0 && (
          <div
            className={`-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border ${
              totalHrZoneSec > 0 || totalPwrZoneSec > 0 ? 'lg:col-span-7' : 'lg:col-span-12'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Parziali ({laps.length})
                </h3>
                <p className="text-[11px] text-[#A0A5AA]">
                  Tocca un parziale per evidenziarlo sulla mappa
                </p>
              </div>
              {selectedLapIndex !== null && (
                <button
                  onClick={() => setSelectedLapIndex(null)}
                  className="rounded-full bg-[#262626] px-3 py-1 text-xs font-semibold text-white hover:bg-[#323232]"
                >
                  Mostra tutto
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[11px] font-medium text-[#A0A5AA]">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-3">Dist</th>
                    <th className="py-2 pr-3">Tempo</th>
                    <th className="py-2 pr-3">{running ? 'Passo' : 'Velocità'}</th>
                    <th className="py-2 pr-3">FC</th>
                    <th className="py-2 pr-3">D+</th>
                    <th className="py-2">Pot / Cad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {laps.map((lap) => {
                    const active = selectedLapIndex === lap.index;
                    const barPct = Math.max(
                      12,
                      Math.min(100, Math.round((lap.avgSpeedMps / maxLapSpeed) * 100))
                    );

  return (
                      <tr
                        key={lap.index}
                        onClick={() =>
                          setSelectedLapIndex((prev) =>
                            prev === lap.index ? null : lap.index
                          )
                        }
                        className={`cursor-pointer transition ${
                          active
                            ? 'bg-[#007CC3]/15 text-white'
                            : 'text-white hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2.5 pr-2 font-semibold tabular-nums text-[#A0A5AA]">
                          {lap.index}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-white">
                          {(lap.distanceMeters / 1000).toFixed(2)} km
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-white">
                          {formatDurationHMS(lap.durationSec)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold tabular-nums text-white">
                            {formatPrimarySpeedOrPace(lap.avgSpeedMps, activity.sport)}
                          </div>
                          <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-[#121212]">
                            <div
                              className="h-full rounded-full bg-[#007CC3]"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-white">
                          {lap.avgHr ? `${lap.avgHr}` : '—'}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-white">
                          {lap.elevationGain !== undefined ? `+${lap.elevationGain}m` : '—'}
                        </td>
                        <td className="py-2.5 tabular-nums text-white">
                          {lap.avgPower
                            ? `${lap.avgPower} W`
                            : lap.avgCadence
                              ? `${lap.avgCadence} ${running ? 'spm' : 'rpm'}`
                              : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
        {/* Complete Garmin Statistics Card */}
        <div className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5 lg:order-6 lg:col-span-12">
          <h3 className="mb-4 text-sm font-bold text-white">Statistiche Complete</h3>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {completeStatsGroups.map((group) => (
              <div key={group.title} className="space-y-2">
                <div className="border-b border-white/[0.07] pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#007CC3]">
                  {group.title}
                </div>
                <div className="space-y-1.5">
                  {group.rows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="text-[#A0A5AA]">{row.label}</span>
                      <span className="font-semibold tabular-nums text-white">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StravaHeroStat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {

  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] font-medium text-[#A0A5AA]">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1 tabular-nums">
        <span className="text-xl font-bold tracking-tight text-white sm:text-2xl">
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-[#A0A5AA]">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-[#8E9299]">{sub}</div>}
    </div>
  );
}
