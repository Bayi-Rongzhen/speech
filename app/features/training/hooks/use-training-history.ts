'use client';

import { useEffect, useMemo, useState } from 'react';
import { HISTORY_STORAGE_KEY, loadHistory, saveHistory } from '../../../lib/storage';
import type { TrainingRecord } from '../../../lib/types';

export function useTrainingHistory(onSaveFailed: () => void) {
  const [history, setHistory] = useState<TrainingRecord[]>([]);
  const [historyReady, setHistoryReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHistory(loadHistory());
      setHistoryReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const syncOtherTab = (event: StorageEvent) => {
      if (event.key === HISTORY_STORAGE_KEY) setHistory(loadHistory());
    };
    window.addEventListener('storage', syncOtherTab);
    return () => window.removeEventListener('storage', syncOtherTab);
  }, []);

  const commitHistory = (next: TrainingRecord[]) => {
    setHistory(next);
    const saved = saveHistory(next);
    if (!saved) onSaveFailed();
    return saved;
  };

  const latestScores = useMemo(() => history.map((record) => record.attempts.at(-1)?.score).filter(Boolean), [history]);
  const averageScore = latestScores.length
    ? Math.round(latestScores.reduce((sum, score) => sum + (score?.total ?? 0), 0) / latestScores.length)
    : 0;
  const completeLoops = history.filter((record) => record.attempts.length > 1).length;
  const totalAttempts = useMemo(() => history.reduce((sum, item) => sum + item.attempts.length, 0), [history]);

  return { history, historyReady, setHistory, commitHistory, averageScore, completeLoops, totalAttempts };
}
