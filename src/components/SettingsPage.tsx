import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Link2,
  Loader2,
  Moon,
  RefreshCw,
  Sun,
  Unlink,
} from 'lucide-react';
import type { UserSettings } from '../types/fitness';
import { buildStravaAuthUrl } from '../services/stravaSync';

interface SettingsPageProps {
  settings: UserSettings;
  onSaveSettings: (next: UserSettings) => Promise<void>;
  onSyncGarmin: (nextSettings: UserSettings, onProgress: (m: string) => void) => Promise<void>;
  onSyncStrava: (nextSettings: UserSettings, onProgress: (m: string) => void) => Promise<void>;
  onSyncIntervals: (nextSettings: UserSettings, onProgress: (m: string) => void) => Promise<void>;
  onImportFiles: (files: FileList) => Promise<{ count: number; errors: string[] }>;
}

export function SettingsPage({
  settings,
  onSaveSettings,
  onSyncGarmin,
  onSyncStrava,
  onSyncIntervals,
  onImportFiles,
}: SettingsPageProps) {
  const [form, setForm] = useState<UserSettings>(settings);
  const [showGarminKey, setShowGarminKey] = useState(false);
  const [showStravaSecret, setShowStravaSecret] = useState(false);
  const [showIntervalsKey, setShowIntervalsKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleGarminSync = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg('Salvataggio chiave e sincronizzazione Garmin...');
    try {
      await onSaveSettings(form);
      await onSyncGarmin(form, (m) => setStatusMsg(m));
      setStatusMsg('Sincronizzazione Garmin completata.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore durante la sincronizzazione Garmin');
      setStatusMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const handleStravaAuthorize = async () => {
    const clientId = form.stravaClientId?.trim();
    if (!clientId || !form.stravaClientSecret?.trim()) {
      setErrorMsg('Inserisci Client ID e Client Secret di Strava per accedere con OAuth.');
      return;
    }
    setErrorMsg(null);
    await onSaveSettings(form);
    window.location.href = buildStravaAuthUrl(clientId);
  };

  const handleStravaSync = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg('Sincronizzazione Strava in corso...');
    try {
      await onSaveSettings(form);
      await onSyncStrava(form, (m) => setStatusMsg(m));
      setStatusMsg('Sincronizzazione Strava completata.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore durante la sincronizzazione Strava');
      setStatusMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectStrava = async () => {
    const next: UserSettings = {
      ...form,
      stravaAccessToken: '',
      stravaRefreshToken: '',
      stravaExpiresAt: undefined,
    };
    setForm(next);
    await onSaveSettings(next);
    setStatusMsg('Strava scollegato.');
  };

  const stravaConnected = Boolean(
    form.stravaAccessToken?.trim() || form.stravaRefreshToken?.trim()
  );

  const handleIntervalsSync = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg('Salvataggio chiave e sincronizzazione Intervals.icu...');
    try {
      await onSaveSettings(form);
      await onSyncIntervals(form, (m) => setStatusMsg(m));
      setStatusMsg('Sincronizzazione multi-ecosistema (Intervals.icu) completata.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Errore durante la sincronizzazione Intervals.icu'
      );
      setStatusMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(`Analisi di ${files.length} file...`);
    try {
      const res = await onImportFiles(files);
      setStatusMsg(`Importate ${res.count} attività nel database locale.`);
      if (res.errors.length > 0) {
        setErrorMsg(res.errors.join(' | '));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Errore importazione file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 pt-3 pb-12 sm:pt-0">
      {statusMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-[#007CC3]/35 bg-[#007CC3]/10 px-3.5 py-2 text-xs text-sky-200">
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#007CC3]" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#007CC3]" />
          )}
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300">
          {errorMsg}
        </div>
      )}

      {/* 1. ASPETTO */}
      <section className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[#A0A5AA]">
            Tema app
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-[#121212] p-0.5">
            {(
              [
                { id: 'dark', label: 'Scuro', icon: Moon },
                { id: 'light', label: 'Chiaro', icon: Sun },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = (form.theme ?? 'light') === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    const next = { ...form, theme: id };
                    setForm(next);
                    void onSaveSettings(next);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? 'bg-[#007CC3] text-white'
                      : 'text-[#A0A5AA] hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. COLLEGAMENTI APP */}
      <section className="-mx-3 space-y-4 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#A0A5AA]">
          <Link2 className="h-3.5 w-3.5 text-[#007CC3]" />
          Collegamenti App
        </h2>

        {/* Garmin Connect */}
        <div className="space-y-2.5 border-b border-white/[0.06] pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <KeyRound className="h-3.5 w-3.5 text-[#007CC3]" />
              Garmin Connect
            </div>
            {form.garminApiKey.trim() && (
              <span className="text-[11px] font-medium text-[#38BDF8]">Attivo</span>
            )}
          </div>
          <p className="text-[11px] text-[#8E9299]">
            Attività (.FIT) e metriche salute H24 tramite Personal API Key.
          </p>

          <div className="relative">
            <input
              type={showGarminKey ? 'text' : 'password'}
              value={form.garminApiKey}
              onChange={(e) => setForm({ ...form, garminApiKey: e.target.value })}
              placeholder="Garmin Personal API Key..."
              className="w-full rounded-lg border border-white/[0.08] bg-[#121212] py-2 pl-3 pr-9 font-mono text-xs text-white placeholder:text-[#5C6168] focus:border-[#007CC3] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowGarminKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8E9299] hover:text-white"
            >
              {showGarminKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={handleGarminSync}
              disabled={busy || !form.garminApiKey.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-[#007CC3] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#0065A0] disabled:opacity-45"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sincronizza Garmin
            </button>
            {form.lastSyncAt && (
              <span className="text-[11px] text-[#6B7078]">
                {new Date(form.lastSyncAt).toLocaleString('it-IT')}
              </span>
            )}
          </div>
        </div>

        {/* Strava */}
        <div className="space-y-2.5 border-b border-white/[0.06] pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <KeyRound className="h-3.5 w-3.5 text-[#FC4C02]" />
              Strava
            </div>
            {stravaConnected && (
              <span className="text-[11px] font-medium text-[#38BDF8]">Attivo</span>
            )}
          </div>
          <p className="text-[11px] text-[#8E9299]">
            Accedi con Client ID/Secret Strava oppure incolla un Access Token diretto.
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={form.stravaClientId ?? ''}
              onChange={(e) => setForm({ ...form, stravaClientId: e.target.value })}
              placeholder="Client ID Strava..."
              className="w-full rounded-lg border border-white/[0.08] bg-[#121212] px-3 py-2 font-mono text-xs text-white placeholder:text-[#5C6168] focus:border-[#007CC3] focus:outline-none"
            />
            <div className="relative">
              <input
                type={showStravaSecret ? 'text' : 'password'}
                value={form.stravaClientSecret ?? ''}
                onChange={(e) => setForm({ ...form, stravaClientSecret: e.target.value })}
                placeholder="Client Secret Strava..."
                className="w-full rounded-lg border border-white/[0.08] bg-[#121212] py-2 pl-3 pr-9 font-mono text-xs text-white placeholder:text-[#5C6168] focus:border-[#007CC3] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowStravaSecret((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8E9299] hover:text-white"
              >
                {showStravaSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <input
            type="password"
            value={form.stravaAccessToken ?? ''}
            onChange={(e) => setForm({ ...form, stravaAccessToken: e.target.value })}
            placeholder="Oppure Access Token diretto Strava..."
            className="w-full rounded-lg border border-white/[0.08] bg-[#121212] px-3 py-2 font-mono text-xs text-white placeholder:text-[#5C6168] focus:border-[#007CC3] focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleStravaAuthorize}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-[#007CC3] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#0065A0] disabled:opacity-45"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Accedi con Strava
              </button>

              {stravaConnected && (
                <>
                  <button
                    type="button"
                    onClick={handleStravaSync}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-[#262626] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#323232] disabled:opacity-45"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Sincronizza
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectStrava}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg bg-[#262626] px-2.5 py-2 text-xs text-[#A0A5AA] hover:text-rose-300"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    Scollega
                  </button>
                </>
              )}
            </div>
            {form.stravaLastSyncAt && (
              <span className="text-[11px] text-[#6B7078]">
                {new Date(form.stravaLastSyncAt).toLocaleString('it-IT')}
              </span>
            )}
          </div>
        </div>

        {/* Intervals.icu */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <KeyRound className="h-3.5 w-3.5 text-[#38BDF8]" />
              Intervals.icu
            </div>
            {form.intervalsApiKey?.trim() && (
              <span className="text-[11px] font-medium text-[#38BDF8]">Attivo</span>
            )}
          </div>
          <p className="text-[11px] text-[#8E9299]">
            Ponte gratuito per unire band/orologi, Health Connect, Apple Salute e altri servizi.
          </p>

          <div className="relative">
            <input
              type={showIntervalsKey ? 'text' : 'password'}
              value={form.intervalsApiKey ?? ''}
              onChange={(e) => setForm({ ...form, intervalsApiKey: e.target.value })}
              placeholder="Intervals.icu API Key..."
              className="w-full rounded-lg border border-white/[0.08] bg-[#121212] py-2 pl-3 pr-9 font-mono text-xs text-white placeholder:text-[#5C6168] focus:border-[#007CC3] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowIntervalsKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8E9299] hover:text-white"
            >
              {showIntervalsKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={handleIntervalsSync}
              disabled={busy || !(form.intervalsApiKey ?? '').trim()}
              className="flex items-center gap-1.5 rounded-lg bg-[#007CC3] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#0065A0] disabled:opacity-45"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sincronizza Intervals
            </button>
            {form.intervalsLastSyncAt && (
              <span className="text-[11px] text-[#6B7078]">
                {new Date(form.intervalsLastSyncAt).toLocaleString('it-IT')}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* 3. IMPORTA FILE (.FIT / .GPX / .ZIP) */}
      <section className="-mx-3 border-y border-white/[0.08] bg-[#1E1E1E] p-4 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#A0A5AA]">
          Importa File (.FIT / .GPX / .ZIP)
        </h2>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 flex cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-dashed border-white/15 bg-[#121212] px-4 py-4 text-center transition hover:border-[#007CC3]/70"
        >
          <FileUp className="h-4 w-4 text-[#007CC3]" />
          <span className="text-xs font-medium text-[#D4D6D9]">
            Trascina qui o seleziona file da importare
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".fit,.gpx,.zip"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </section>
    </div>
  );
}
