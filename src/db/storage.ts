import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_SETTINGS,
  type ActivityDetail,
  type ActivitySummary,
  type DailyHealth,
  type UserSettings,
} from '../types/fitness';
import {
  enrichDailyHealthWithFusion,
  findDuplicateActivity,
  mergeActivityRecords,
  mergeDailyHealthRecord,
} from '../services/ecosystemMerge';

interface VeloPulseDB extends DBSchema {
  activities: {
    key: string;
    value: ActivitySummary;
    indexes: { 'by-start': string };
  };
  activityDetails: {
    key: string;
    value: ActivityDetail;
  };
  dailyHealth: {
    key: string;
    value: DailyHealth;
  };
  settings: {
    key: string;
    value: UserSettings;
  };
}

const DB_NAME = 'velopulse-local-db';
const DB_VERSION = 1;
const SETTINGS_KEY = 'user-settings';

let dbPromise: Promise<IDBPDatabase<VeloPulseDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<VeloPulseDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('activities')) {
          const store = db.createObjectStore('activities', { keyPath: 'id' });
          store.createIndex('by-start', 'startTime');
        }
        if (!db.objectStoreNames.contains('activityDetails')) {
          db.createObjectStore('activityDetails', { keyPath: 'activityId' });
        }
        if (!db.objectStoreNames.contains('dailyHealth')) {
          db.createObjectStore('dailyHealth', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

export async function getSettings(): Promise<UserSettings> {
  const db = await getDb();
  const saved = await db.get('settings', SETTINGS_KEY);
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const db = await getDb();
  await db.put('settings', settings, SETTINGS_KEY);
}

export async function getAllActivities(): Promise<ActivitySummary[]> {
  const db = await getDb();
  const list = await db.getAll('activities');
  return list.sort((a, b) => b.startTime.localeCompare(a.startTime));
}

export async function saveActivities(items: ActivitySummary[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('activities', 'readwrite');
  const existingList = await tx.store.getAll();
  for (const item of items) {
    const existing = findDuplicateActivity(item, existingList);
    if (existing) {
      const merged = mergeActivityRecords(existing, item);
      await tx.store.put(merged);
      const idx = existingList.findIndex((a) => a.id === existing.id);
      if (idx >= 0) existingList[idx] = merged;
    } else {
      await tx.store.put(item);
      existingList.push(item);
    }
  }
  await tx.done;
}

export async function getActivityDetail(activityId: string): Promise<ActivityDetail | undefined> {
  const db = await getDb();
  return db.get('activityDetails', activityId);
}

export async function getAllActivityDetails(): Promise<ActivityDetail[]> {
  const db = await getDb();
  return db.getAll('activityDetails');
}

export async function saveActivityDetail(detail: ActivityDetail): Promise<void> {
  const db = await getDb();
  await db.put('activityDetails', detail);
}

export async function getAllDailyHealth(): Promise<DailyHealth[]> {
  const db = await getDb();
  const list = await db.getAll('dailyHealth');
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveDailyHealth(records: DailyHealth[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('dailyHealth', 'readwrite');
  for (const rec of records) {
    const existing = await tx.store.get(rec.date);
    await tx.store.put(mergeDailyHealthRecord(existing, rec));
  }
  await tx.done;
}

/**
 * Recomputes cross-ecosystem derived metrics (such as estimated Body Battery
 * from non-Garmin sleep/HRV + workout load) across all stored health days.
 */
export async function recalculateHealthFusion(): Promise<void> {
  const db = await getDb();
  const [days, activities] = await Promise.all([
    db.getAll('dailyHealth'),
    db.getAll('activities'),
  ]);
  if (days.length === 0) return;
  const enriched = enrichDailyHealthWithFusion(days, activities);
  const tx = db.transaction('dailyHealth', 'readwrite');
  for (const day of enriched) {
    await tx.store.put(day);
  }
  await tx.done;
}

export async function clearDemoData(): Promise<void> {
  const db = await getDb();
  const allActs = await db.getAll('activities');
  const demoIds = allActs.filter((a) => a.source === 'demo').map((a) => a.id);
  if (demoIds.length > 0) {
    const tx = db.transaction(['activities', 'activityDetails'], 'readwrite');
    for (const id of demoIds) {
      await tx.objectStore('activities').delete(id);
      await tx.objectStore('activityDetails').delete(id);
    }
    await tx.done;
  }
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['activities', 'activityDetails', 'dailyHealth'], 'readwrite');
  await tx.objectStore('activities').clear();
  await tx.objectStore('activityDetails').clear();
  await tx.objectStore('dailyHealth').clear();
  await tx.done;
}

export async function exportFullBackup(): Promise<string> {
  const db = await getDb();
  const [activities, activityDetails, dailyHealth] = await Promise.all([
    db.getAll('activities'),
    db.getAll('activityDetails'),
    db.getAll('dailyHealth'),
  ]);
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      activities,
      activityDetails,
      dailyHealth,
    },
    null,
    2
  );
}

export async function importFullBackup(jsonStr: string): Promise<{
  activities: number;
  healthDays: number;
}> {
  const parsed = JSON.parse(jsonStr);
  const activities: ActivitySummary[] = Array.isArray(parsed.activities) ? parsed.activities : [];
  const details: ActivityDetail[] = Array.isArray(parsed.activityDetails)
    ? parsed.activityDetails
    : [];
  const health: DailyHealth[] = Array.isArray(parsed.dailyHealth) ? parsed.dailyHealth : [];

  await saveActivities(activities);
  for (const d of details) {
    await saveActivityDetail(d);
  }
  await saveDailyHealth(health);
  return { activities: activities.length, healthDays: health.length };
}
