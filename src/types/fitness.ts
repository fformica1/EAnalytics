export type ActivitySource = 'garmin' | 'intervals' | 'strava' | 'fit' | 'gpx' | 'tcx' | 'demo';

export type SportType =
  | 'cycling'
  | 'running'
  | 'trail_running'
  | 'walking'
  | 'strength'
  | 'swimming'
  | 'other';

export interface ActivitySummary {
  id: string;
  source: ActivitySource;
  garminActivityId?: number;
  intervalsActivityId?: string;
  stravaActivityId?: number;
  name: string;
  sport: SportType;
  startTime: string; // ISO string
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  avgHr?: number;
  maxHr?: number;
  minHr?: number;
  avgCadence?: number;
  maxCadence?: number;
  minElevationMeters?: number;
  maxElevationMeters?: number;
  avgTempC?: number;
  minTempC?: number;
  maxTempC?: number;
  timeStandingSec?: number;
  standCount?: number;
  thresholdPowerWatts?: number;
  waterEstimatedMl?: number;
  vo2MaxValue?: number;
  steps?: number;
  poolLengthMeters?: number;
  activeLengths?: number;
  avgSwolf?: number;
  grit?: number;
  flow?: number;
  avgPower?: number;
  normalizedPower?: number;
  maxPower?: number;
  isEstimatedPower?: boolean;
  tss?: number;
  intensityFactor?: number;
  totalWorkKj?: number;
  lrBalanceLeftPct?: number;
  lrBalanceRightPct?: number;
  avgLeftTorqueEff?: number;
  avgRightTorqueEff?: number;
  avgLeftSmoothness?: number;
  avgRightSmoothness?: number;
  avgCombinedSmoothness?: number;
  avgLeftPco?: number;
  avgRightPco?: number;
  avgVerticalOscillationMm?: number;
  avgStanceTimeMs?: number;
  avgStanceTimeBalancePct?: number;
  avgStepLengthMm?: number;
  avgVerticalRatioPct?: number;
  extraFields?: { key: string; label: string; unit: string }[];
  calories?: number;
  bmrCalories?: number;
  trainingLoad?: number;
  totalStrokes?: number;
  avgRespiration?: number;
  maxRespiration?: number;
  minRespiration?: number;
  aerobicTe?: number;
  anaerobicTe?: number;
  locationName?: string;
  hasStreams: boolean;
  parserVersion?: number;
  hrZonesSeconds?: number[]; // [Z1, Z2, Z3, Z4, Z5]
  powerZonesSeconds?: number[]; // [Z1..Z6]
  previewCoords?: [number, number][]; // [lat, lon]
}

export interface StreamPoint {
  t: number; // elapsed seconds
  d: number; // cumulative distance in km
  lat?: number;
  lon?: number;
  ele?: number; // meters
  spd?: number; // km/h
  hr?: number; // bpm
  cad?: number; // rpm or spm
  pwr?: number; // watts (native or Connect IQ virtual power)
  vPwr?: number; // Connect IQ Virtual Power when dual-recorded with real power
  resp?: number; // breaths per minute
  temp?: number; // Celsius
  grade?: number; // %
  lrBal?: number; // Left % (0..100)
  lTe?: number; // Left Torque Effectiveness (%)
  rTe?: number; // Right Torque Effectiveness (%)
  lSm?: number; // Left Pedal Smoothness (%)
  rSm?: number; // Right Pedal Smoothness (%)
  vOsc?: number; // Vertical Oscillation (mm)
  gct?: number; // Ground Contact Time (ms)
  stepLen?: number; // Step Length (m)
  extra?: Record<string, number>; // Any extra Connect IQ / bike computer fields
}

export interface ActivityLap {
  index: number;
  startTimeSec: number;
  durationSec: number;
  distanceMeters: number;
  avgSpeedMps: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPower?: number;
  elevationGain?: number;
}

export interface ActivityDetail {
  activityId: string;
  streams: StreamPoint[];
  laps: ActivityLap[];
}

export interface TimelinePoint {
  t: string; // HH:mm
  v: number;
}

export interface DailyHealth {
  date: string; // YYYY-MM-DD
  sleepSeconds?: number;
  deepSleepSeconds?: number;
  lightSleepSeconds?: number;
  remSleepSeconds?: number;
  awakeSleepSeconds?: number;
  sleepScore?: number;
  hrvLastNight?: number;
  hrvWeeklyAvg?: number;
  hrvStatus?: string;
  hrvBaselineLow?: number;
  hrvBaselineHigh?: number;
  rhr?: number;
  hrMin?: number;
  hrMax?: number;
  bodyBatteryCharged?: number;
  bodyBatteryDrained?: number;
  bodyBatteryMax?: number;
  bodyBatteryMin?: number;
  bodyBatteryCurrent?: number;
  bodyBatteryTimeline?: TimelinePoint[];
  stressAvg?: number;
  stressMax?: number;
  stressTimeline?: TimelinePoint[];
  hrTimeline?: TimelinePoint[];
  steps?: number;
  stepsGoal?: number;
  caloriesTotal?: number;
  caloriesActive?: number;
  spo2Avg?: number;
  respirationAvg?: number;
  weightKg?: number;
  sources?: string[];
  bodyBatteryEstimated?: boolean;
}

export interface UserSettings {
  garminApiKey: string;
  proxyBaseUrl: string;
  theme?: 'dark' | 'light';
  intervalsApiKey?: string;
  intervalsAthleteId?: string;
  intervalsLastSyncAt?: string;
  stravaClientId?: string;
  stravaClientSecret?: string;
  stravaAccessToken?: string;
  stravaRefreshToken?: string;
  stravaExpiresAt?: number;
  stravaLastSyncAt?: string;
  maxHr: number;
  restingHr: number;
  ftpWatts: number;
  lastSyncAt?: string;
  athleteName?: string;
  athleteLocation?: string;
  athleteAvatarUrl?: string;
  profileSource?: 'garmin' | 'strava' | 'intervals';
}

export const DEFAULT_SETTINGS: UserSettings = {
  garminApiKey: '',
  proxyBaseUrl: '/api/garmin',
  theme: 'light',
  intervalsApiKey: '',
  intervalsAthleteId: '0',
  stravaClientId: '',
  stravaClientSecret: '',
  stravaAccessToken: '',
  stravaRefreshToken: '',
  maxHr: 190,
  restingHr: 52,
  ftpWatts: 240,
  athleteName: 'Atleta',
};
