import { TopicSnapshotSchema, type TopicSnapshot } from './schemas/topic';
import type { TrainingRecord } from './types';

export const HISTORY_STORAGE_KEY = 'jiangqingchu.history.v1';
export const GENERATED_TOPICS_STORAGE_KEY = 'jiangqingchu.generated-topics.v1';
const AUDIO_DB = 'jiangqingchu-audio-v1';
const AUDIO_STORE = 'recordings';
const MAX_GENERATED_TOPICS = 20;

export function loadGeneratedTopics(): TopicSnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GENERATED_TOPICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = TopicSnapshotSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function saveGeneratedTopics(topics: TopicSnapshot[]) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(GENERATED_TOPICS_STORAGE_KEY, JSON.stringify(topics.slice(0, MAX_GENERATED_TOPICS)));
    return true;
  } catch {
    return false;
  }
}

export function loadHistory(): TrainingRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TrainingRecord => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<TrainingRecord>;
      return typeof candidate.id === 'string'
        && typeof candidate.topicId === 'string'
        && typeof candidate.topicTitle === 'string'
        && typeof candidate.audience === 'string'
        && typeof candidate.notes === 'string'
        && typeof candidate.createdAt === 'string'
        && Number.isFinite(new Date(candidate.createdAt).getTime())
        && typeof candidate.updatedAt === 'string'
        && Number.isFinite(new Date(candidate.updatedAt).getTime())
        && (candidate.schemaVersion === 1 || candidate.schemaVersion === 2)
        && Array.isArray(candidate.attempts)
        && candidate.attempts.length > 0
        && candidate.attempts.every((attempt) => Boolean(
          attempt
          && typeof attempt.id === 'string'
          && typeof attempt.createdAt === 'string'
          && Number.isFinite(new Date(attempt.createdAt).getTime())
          && typeof attempt.transcript === 'string'
          && ['browser', 'manual', 'edited', 'local-whisper'].includes(attempt.transcriptSource)
          && typeof attempt.durationSeconds === 'number'
          && typeof attempt.topicVersion === 'number'
          && typeof attempt.targetSeconds === 'number'
          && typeof attempt.audioStored === 'boolean'
          && attempt.score
          && typeof attempt.score.total === 'number'
          && typeof attempt.score.level === 'string'
          && typeof attempt.score.confidence === 'string'
          && typeof attempt.score.rubricVersion === 'string'
          && Array.isArray(attempt.score.dimensions)
          && attempt.score.dimensions.length > 0
          && attempt.score.dimensions.every((dimension) => dimension
            && typeof dimension.key === 'string'
            && typeof dimension.score === 'number'
            && typeof dimension.weight === 'number'
            && typeof dimension.available === 'boolean')
          && attempt.score.metrics
          && typeof attempt.score.metrics.durationSeconds === 'number'
          && typeof attempt.score.metrics.durationEstimated === 'boolean'
          && typeof attempt.score.metrics.keywordCoverage === 'number'
          && Array.isArray(attempt.score.feedback)
          && Array.isArray(attempt.score.strengths),
        ));
    });
  } catch {
    return [];
  }
}

export function saveHistory(history: TrainingRecord[]) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

function openAudioDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(AUDIO_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUDIO_STORE)) request.result.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

export async function storeAudio(id: string, blob: Blob) {
  try {
    const db = await openAudioDb();
    if (!db) return false;
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(AUDIO_STORE, 'readwrite');
      tx.objectStore(AUDIO_STORE).put(blob, id);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    });
  } catch {
    return false;
  }
}

export async function getStoredAudio(id: string) {
  try {
    const db = await openAudioDb();
    if (!db) return null;
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(AUDIO_STORE, 'readonly');
      const request = tx.objectStore(AUDIO_STORE).get(id);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function deleteStoredAudio(id: string) {
  try {
    const db = await openAudioDb();
    if (!db) return false;
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(AUDIO_STORE, 'readwrite');
      tx.objectStore(AUDIO_STORE).delete(id);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    });
  } catch {
    return false;
  }
}

export async function clearLocalData() {
  if (typeof window === 'undefined') return false;
  const indexedDb = (window as Window & { indexedDB?: IDBFactory }).indexedDB;
  if (!indexedDb) {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    return true;
  }
  const audioCleared = await new Promise<boolean>((resolve) => {
    let settled = false;
    const request = indexedDb.deleteDatabase(AUDIO_DB);
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(false), 3500);
    request.onsuccess = () => finish(true);
    request.onerror = () => finish(false);
    request.onblocked = () => { /* wait briefly for other tabs to close their connection */ };
  });
  if (!audioCleared) return false;
  window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  return true;
}
