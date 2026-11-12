import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  HeartPulse,
  Loader2,
  MapPin,
  RefreshCw,
  Settings,
  TrendingUp,
} from 'lucide-react';
import {
  clearAllData,
  clearDemoData,
  getActivityDetail,
  getAllActivities,
  getAllDailyHealth,
  getSettings,
  recalculateHealthFusion,
  saveActivities,
  saveActivityDetail,
  saveDailyHealth,
  saveSettings,
} from './db/storage';
import { parseUploadedFiles } from './services/fitParser';
import { downloadAndParseGarminActivity, syncGarminAccount } from './services/garminSync';
import {
  downloadIntervalsActivityStreams,
  syncIntervalsAccount,
} from './services/intervalsSync';
import {
  downloadStravaActivityStreams,
  exchangeStravaCode,
  syncStravaAccount,
} from './services/stravaSync';
import {
  DEFAULT_SETTINGS,
  type ActivityDetail,
  type ActivitySummary,
  type DailyHealth,
  type UserSettings,
} from './types/fitness';
import { formatDuration } from './utils/formatters';
import { HealthHomeView } from './components/HealthHomeView';
import { ActivitiesListView } from './components/ActivitiesListView';
import { ProgressView } from './components/ProgressView';
import { ActivityDetailView } from './components/ActivityDetailView';
import { SettingsPage } from './components/SettingsPage';

type ProfileTab = 'activities' | 'progress' | 'health';

const PROFILE_RANK: Record<'garmin' | 'strava' | 'intervals', number> = {
  garmin: 3,
  strava: 2,
  intervals: 1,
};

function applyProfileWithPriority(
  settings: UserSettings,
  source: 'garmin' | 'strava' | 'intervals',
  profile?: { name?: string; avatarUrl?: string; location?: string }
): Partial<UserSettings> {
  if (!profile) return {};
  const currentRank = settings.profileSource ? PROFILE_RANK[settings.profileSource] : 0;
  const incomingRank = PROFILE_RANK[source];
  if (incomingRank < currentRank) return {};
  return {
    athleteName: profile.name ?? settings.athleteName,
    athleteAvatarUrl: profile.avatarUrl ?? settings.athleteAvatarUrl,
    athleteLocation: profile.location ?? settings.athleteLocation,
    profileSource: source,
  };
}

export function App() {
  const [activeTab, setActiveTab] = useState<ProfileTab>('activities');
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [healthDays, setHealthDays] = useState<DailyHealth[]>([]);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ActivityDetail | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const reloadFromDb = useCallback(async () => {
    const [acts, health, cfg] = await Promise.all([
      getAllActivities(),
      getAllDailyHealth(),
      getSettings(),
    ]);
    setActivities(acts);
    setHealthDays(health);
    setSettings(cfg);
    return { acts, health, cfg };
  }, []);

  useEffect(() => {
    const isLight = (settings.theme ?? 'light') === 'light';
    document.documentElement.classList.toggle('theme-light', isLight);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', isLight ? '#f3f5f8' : '#121212');
    }
  }, [settings.theme]);

  useEffect(() => {
    (async () => {
      try {
        const { acts, cfg } = await reloadFromDb();

        const params = new URLSearchParams(window.location.search);
        const stravaCode = params.get('code');
        if (stravaCode && cfg.stravaClientId?.trim() && cfg.stravaClientSecret?.trim()) {
          window.history.replaceState({}, '', window.location.pathname);
          setSyncing(true);
          try {
            const exchanged = await exchangeStravaCode(
              stravaCode,
              cfg.stravaClientId,
              cfg.stravaClientSecret
            );
            const profilePatch = applyProfileWithPriority(cfg, 'strava', {
              name: exchanged.athleteName,
              avatarUrl: exchanged.athleteAvatarUrl,
              location: exchanged.athleteLocation,
            });
            const nextCfg: UserSettings = {
              ...cfg,
              stravaAccessToken: exchanged.accessToken,
              stravaRefreshToken: exchanged.refreshToken,
              stravaExpiresAt: exchanged.expiresAt,
              ...profilePatch,
            };
            await saveSettings(nextCfg);
            setSettings(nextCfg);
            const stravaRes = await syncStravaAccount(nextCfg);
            if (stravaRes.activities.length > 0) await clearDemoData();
            await saveActivities(stravaRes.activities);
            for (const d of stravaRes.details) await saveActivityDetail(d);
            const finalCfg: UserSettings = {
              ...nextCfg,
              ...stravaRes.updatedTokenFields,
              stravaLastSyncAt: new Date().toISOString(),
            };
            await saveSettings(finalCfg);
            await recalculateHealthFusion();
            await reloadFromDb();
          } catch (err) {
            setSyncError(err instanceof Error ? err.message : 'Errore OAuth Strava');
          } finally {
            setSyncing(false);
          }
          return;
        }

        if (acts.some((a) => a.source === 'demo')) {
          if (!cfg.lastSyncAt && !cfg.intervalsLastSyncAt && acts.every((a) => a.source === 'demo')) {
            await clearAllData();
          } else {
            await clearDemoData();
          }
          await reloadFromDb();
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadFromDb]);

  const openActivity = async (activity: ActivitySummary) => {
    setSelectedActivityId(activity.id);
    const detail = await getActivityDetail(activity.id);
    setSelectedDetail(detail);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSyncGarmin = async (
    targetSettings: UserSettings,
    onProgress?: (msg: string) => void
  ) => {
    setSyncing(true);
    setSyncError(null);
    const report = (msg: string) => {
      onProgress?.(msg);
    };

    try {
      const existingActs = await getAllActivities();
      const syncedIds = new Set(
        existingActs
          .filter((a) => a.source !== 'demo' && a.hasStreams && (a.parserVersion ?? 1) >= 5)
          .map((a) => a.id)
      );

      const res = await syncGarminAccount(targetSettings, {
        days: syncedIds.size === 0 ? 30 : 14,
        syncedIds,
        onProgress: report,
      });

      if (res.activities.length > 0 || res.healthDays.length > 0) {
        await clearDemoData();
      }

      await saveActivities(res.activities);
      for (const detail of res.details) {
        await saveActivityDetail(detail);
      }
      await saveDailyHealth(res.healthDays);
      await recalculateHealthFusion();

      const updatedSettings: UserSettings = {
        ...targetSettings,
        lastSyncAt: new Date().toISOString(),
        ...applyProfileWithPriority(targetSettings, 'garmin', res.athleteProfile),
      };
      await saveSettings(updatedSettings);
      await reloadFromDb();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore sync Garmin';
      setSyncError(msg);
      throw err;
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncIntervals = async (
    targetSettings: UserSettings,
    onProgress?: (msg: string) => void
  ) => {
    setSyncing(true);
    setSyncError(null);
    const report = (msg: string) => {
      onProgress?.(msg);
    };

    try {
      const existingActs = await getAllActivities();
      const syncedIds = new Set(
        existingActs
          .filter((a) => a.source !== 'demo' && a.hasStreams && (a.parserVersion ?? 1) >= 5)
          .map((a) => a.id)
      );

      const res = await syncIntervalsAccount(targetSettings, {
        daysBack: syncedIds.size === 0 ? 180 : 30,
        syncedIds,
        onProgress: report,
      });

      if (res.activities.length > 0 || res.healthDays.length > 0) {
        await clearDemoData();
      }

      await saveActivities(res.activities);
      for (const detail of res.details) {
        await saveActivityDetail(detail);
      }
      await saveDailyHealth(res.healthDays);
      await recalculateHealthFusion();

      const updatedSettings: UserSettings = {
        ...targetSettings,
        intervalsLastSyncAt: new Date().toISOString(),
        ...applyProfileWithPriority(targetSettings, 'intervals', res.athleteProfile),
      };
      await saveSettings(updatedSettings);
      await reloadFromDb();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore sync Intervals.icu';
      setSyncError(msg);
      throw err;
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncStrava = async (
    targetSettings: UserSettings,
    onProgress?: (msg: string) => void
  ) => {
    setSyncing(true);
    setSyncError(null);
    const report = (msg: string) => {
      onProgress?.(msg);
    };

    try {
      const existingActs = await getAllActivities();
      const syncedIds = new Set(
        existingActs
          .filter((a) => a.source !== 'demo' && a.hasStreams && (a.parserVersion ?? 1) >= 5)
          .map((a) => a.id)
      );

      const res = await syncStravaAccount(targetSettings, {
        syncedIds,
        onProgress: report,
      });

      if (res.activities.length > 0) {
        await clearDemoData();
      }

      await saveActivities(res.activities);
      for (const detail of res.details) {
        await saveActivityDetail(detail);
      }
      await recalculateHealthFusion();

      const updatedSettings: UserSettings = {
        ...targetSettings,
        ...res.updatedTokenFields,
        stravaLastSyncAt: new Date().toISOString(),
        ...applyProfileWithPriority(targetSettings, 'strava', res.athleteProfile),
      };
      await saveSettings(updatedSettings);
      await reloadFromDb();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore sync Strava';
      setSyncError(msg);
      throw err;
    } finally {
      setSyncing(false);
    }
  };

  const handleGlobalRefresh = async () => {
    const hasGarmin = Boolean(settings.garminApiKey.trim());
    const hasStrava = Boolean(
      settings.stravaAccessToken?.trim() || settings.stravaRefreshToken?.trim()
    );
    const hasIntervals = Boolean(settings.intervalsApiKey?.trim());
    if (!hasGarmin && !hasStrava && !hasIntervals) {
      setSettingsOpen(true);
      return;
    }
    let current = settings;
    if (hasGarmin) {
      await handleSyncGarmin(current).catch(() => {});
      current = await getSettings();
    }
    if (hasStrava) {
      await handleSyncStrava(current).catch(() => {});
      current = await getSettings();
    }
    if (hasIntervals) {
      await handleSyncIntervals(current).catch(() => {});
    }
  };

  const handleDownloadGarminFit = async (activity: ActivitySummary) => {
    if (!activity.garminActivityId) return;
    const parsed = await downloadAndParseGarminActivity(
      settings,
      activity.garminActivityId,
      activity
    );
    await saveActivities([parsed.summary]);
    await saveActivityDetail(parsed.detail);
    await recalculateHealthFusion();
    await reloadFromDb();
    setSelectedDetail(parsed.detail);
  };

  const handleDownloadStravaStreams = async (activity: ActivitySummary) => {
    if (!activity.stravaActivityId) return;
    const parsed = await downloadStravaActivityStreams(
      settings,
      activity.stravaActivityId,
      activity
    );
    await saveActivities([parsed.summary]);
    await saveActivityDetail(parsed.detail);
    await recalculateHealthFusion();
    await reloadFromDb();
    setSelectedDetail(parsed.detail);
  };

  const handleDownloadIntervalsStreams = async (activity: ActivitySummary) => {
    if (!activity.intervalsActivityId) return;
    const parsed = await downloadIntervalsActivityStreams(
      settings,
      activity.intervalsActivityId,
      activity
    );
    await saveActivities([parsed.summary]);
    await saveActivityDetail(parsed.detail);
    await recalculateHealthFusion();
    await reloadFromDb();
    setSelectedDetail(parsed.detail);
  };

  const handleImportFiles = async (files: FileList) => {
    const res = await parseUploadedFiles(files, {
      maxHr: settings.maxHr,
      ftpWatts: settings.ftpWatts,
    });
    if (res.parsed.length > 0) {
      await saveActivities(res.parsed.map((p) => p.summary));
      for (const p of res.parsed) {
        await saveActivityDetail(p.detail);
      }
      await recalculateHealthFusion();
      await reloadFromDb();
    }
    return { count: res.parsed.length, errors: res.errors };
  };

  // Profile Header Summary Stats (Current Week + Latest Health)
  const profileSummary = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);

    let weekDist = 0;
    let weekTime = 0;
    let weekEle = 0;
    let weekCount = 0;

    for (const a of activities) {
      const t = new Date(a.startTime.includes(' ') ? a.startTime.replace(' ', 'T') : a.startTime);
      if (!Number.isNaN(t.getTime()) && t >= weekStart) {
        weekDist += a.distanceMeters;
        weekTime += a.movingDurationSeconds || a.durationSeconds;
        weekEle += a.elevationGainMeters || 0;
        weekCount += 1;
      }
    }

    const latestHealth = healthDays[0];
    const displayName = settings.athleteName?.trim() || 'Atleta';
    const initials = displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');

    return {
      displayName,
      initials: initials || 'A',
      location:
        settings.athleteLocation?.trim() ||
        activities.find((a) => a.locationName)?.locationName,
      weekDistKm: (weekDist / 1000).toFixed(1),
      weekTime: formatDuration(weekTime),
      weekEleM: Math.round(weekEle),
      weekCount,
      latestHealth,
    };
  }, [activities, healthDays, settings]);

  const selectedActivity = activities.find((a) => a.id === selectedActivityId) ?? null;
  const isDetailView = selectedActivity !== null;
  const isSubPage = isDetailView || settingsOpen;

  return (
    <div className="min-h-screen bg-[#121212] text-[#F5F5F5]">
      {/* Fixed-Height Unified Top Bar across ALL screens */}
      <header className="sticky top-0 z-[700] h-14 border-b border-white/[0.08] bg-[#161616]/95 backdrop-blur-lg">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-3 sm:px-4">
          {isSubPage ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                onClick={() => {
                  if (settingsOpen) setSettingsOpen(false);
                  else setSelectedActivityId(null);
                }}
                aria-label="Torna indietro"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#A0A5AA] transition hover:bg-white/[0.06] hover:text-white"
              >
                <ArrowLeft className="h-[18px] w-[18px]" />
              </button>
              <span className="truncate text-sm font-bold tracking-tight text-white sm:text-base">
                {settingsOpen ? 'Impostazioni' : selectedActivity?.name ?? 'Dettagli'}
              </span>
            </div>
          ) : (
            <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">
              MetricLab
            </span>
          )}

          {!isSubPage && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => void handleGlobalRefresh()}
                disabled={syncing}
                aria-label="Sincronizza"
                title="Sincronizza dati"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A0A5AA] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-[18px] w-[18px] ${syncing ? 'animate-spin text-[#007CC3]' : ''}`}
                />
              </button>

              <button
                onClick={() => setSettingsOpen(true)}
                aria-label="Impostazioni"
                title="Impostazioni"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#A0A5AA] transition hover:bg-white/[0.06] hover:text-white"
              >
                <Settings className="h-[18px] w-[18px]" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main
        className={`mx-auto max-w-6xl px-3 sm:px-4 ${
          isSubPage ? 'pt-0 sm:pt-4' : 'pt-4'
        }`}
      >
        {!isSubPage && (
          <>
            {syncError && (
              <div className="mb-4 flex items-center justify-between rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
                <span>{syncError}</span>
                <button
                  onClick={() => setSyncError(null)}
                  className="ml-3 text-rose-300 underline"
                >
                  Chiudi
                </button>
              </div>
            )}

            {/* STRAVA-STYLE PROFILE HEADER */}
            <section className="-mx-3 mb-4 border-y border-white/[0.08] bg-[#1E1E1E] px-4 pt-4 sm:mx-0 sm:rounded-xl sm:border sm:px-6 sm:pt-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Identity */}
                <div className="flex items-center gap-3.5">
                  {settings.athleteAvatarUrl ? (
                    <img
                      src={settings.athleteAvatarUrl}
                      alt={profileSummary.displayName}
                      className="h-14 w-14 rounded-full border-2 border-[#007CC3] object-cover sm:h-16 sm:w-16"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[#007CC3] bg-[#2A2A2A] text-lg font-bold text-white sm:h-16 sm:w-16">
                      {profileSummary.initials}
                    </div>
                  )}

                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-bold tracking-tight text-white sm:text-xl">
                      {profileSummary.displayName}
                    </h1>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-[#A0A5AA]">
                      {profileSummary.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-[#007CC3]" />
                          {profileSummary.location}
                        </span>
                      )}
                      <span>{activities.length} attività registrate</span>
                    </div>
                  </div>
                </div>

                {/* Principal Weekly & Physiology Summary Strip */}
                <div className="grid grid-cols-4 gap-3 border-t border-white/[0.07] pt-3 sm:border-t-0 sm:pt-0">
                  <div>
                    <div className="text-[11px] font-medium text-[#A0A5AA]">Settimana</div>
                    <div className="text-base font-bold tabular-nums text-white">
                      {profileSummary.weekDistKm}
                      <span className="ml-0.5 text-[11px] font-medium text-[#A0A5AA]">km</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-[#A0A5AA]">Tempo</div>
                    <div className="text-base font-bold tabular-nums text-white">
                      {profileSummary.weekTime}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-[#A0A5AA]">D+ Sett.</div>
                    <div className="text-base font-bold tabular-nums text-white">
                      {profileSummary.weekEleM}
                      <span className="ml-0.5 text-[11px] font-medium text-[#A0A5AA]">m</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-[#A0A5AA]">
                      {profileSummary.latestHealth?.hrvLastNight ? 'HRV' : 'FC Riposo'}
                    </div>
                    <div className="text-base font-bold tabular-nums text-white">
                      {profileSummary.latestHealth?.hrvLastNight
                        ? `${profileSummary.latestHealth.hrvLastNight} ms`
                        : profileSummary.latestHealth?.rhr
                          ? `${profileSummary.latestHealth.rhr} bpm`
                          : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Strava-style Segmented Tabs inside Profile (Attività | Progressi | Health) */}
              <div className="mt-4 grid grid-cols-3 border-t border-white/[0.08]">
                <ProfileTabButton
                  active={activeTab === 'activities'}
                  onClick={() => setActiveTab('activities')}
                  icon={<Activity className="h-4 w-4" />}
                  label="Attività"
                />
                <ProfileTabButton
                  active={activeTab === 'progress'}
                  onClick={() => setActiveTab('progress')}
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Progressi"
                />
                <ProfileTabButton
                  active={activeTab === 'health'}
                  onClick={() => setActiveTab('health')}
                  icon={<HeartPulse className="h-4 w-4" />}
                  label="Health"
                />
              </div>
            </section>
          </>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#007CC3]" />
          </div>
        ) : settingsOpen ? (
          <SettingsPage
            settings={settings}
            onSaveSettings={async (next) => {
              await saveSettings(next);
              setSettings(next);
            }}
            onSyncGarmin={async (next, onProgress) => {
              await handleSyncGarmin(next, onProgress);
            }}
            onSyncStrava={async (next, onProgress) => {
              await handleSyncStrava(next, onProgress);
            }}
            onSyncIntervals={async (next, onProgress) => {
              await handleSyncIntervals(next, onProgress);
            }}
            onImportFiles={handleImportFiles}
          />
        ) : isDetailView && selectedActivity ? (
          <ActivityDetailView
            activity={selectedActivity}
            detail={selectedDetail}
            onDownloadGarminFit={handleDownloadGarminFit}
            onDownloadIntervalsStreams={handleDownloadIntervalsStreams}
            onDownloadStravaStreams={handleDownloadStravaStreams}
          />
        ) : activeTab === 'activities' ? (
          <ActivitiesListView
            activities={activities}
            onSelectActivity={openActivity}
            onOpenImport={() => setSettingsOpen(true)}
          />
        ) : activeTab === 'progress' ? (
          <ProgressView
            activities={activities}
            healthDays={healthDays}
            onSelectActivity={openActivity}
          />
        ) : (
          <HealthHomeView healthDays={healthDays} />
        )}
      </main>
    </div>
  );
}

function ProfileTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition sm:text-sm ${
        active ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
      {active && (
        <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[#007CC3]" />
      )}
    </button>
  );
}

export default App;
