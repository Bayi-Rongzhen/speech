'use client';

import { useEffect, useMemo, useState } from 'react';
import { DIMENSION_META, RUBRIC_VERSION } from '../../../lib/scoring';
import { HISTORY_STORAGE_KEY, loadHistory, saveHistory } from '../../../lib/storage';
import type { DimensionKey, TrainingRecord } from '../../../lib/types';

const TREND_WINDOW = 12;
const FLAT_THRESHOLD = 4;

export type DimensionTrend = {
  key: DimensionKey;
  label: string;
  points: Array<{ createdAt: string; score: number }>;
  delta: number | null;
  trend: 'up' | 'down' | 'flat' | 'insufficient';
};

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

  const dimensionTrends = useMemo<DimensionTrend[]>(() => {
    const attempts = history
      .flatMap((record) => record.attempts)
      .filter((attempt) => attempt.score.rubricVersion === RUBRIC_VERSION)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return DIMENSION_META.map((meta) => {
      const points = attempts
        .flatMap((attempt) => {
          const dimension = attempt.score.dimensions.find((item) => item.key === meta.key);
          return dimension?.available ? [{ createdAt: attempt.createdAt, score: dimension.score }] : [];
        })
        .slice(-TREND_WINDOW);
      const delta = points.length >= 2 ? points.at(-1)!.score - points[0].score : null;
      const trend: DimensionTrend['trend'] = delta === null
        ? 'insufficient'
        : delta > FLAT_THRESHOLD ? 'up' : delta < -FLAT_THRESHOLD ? 'down' : 'flat';
      return { key: meta.key, label: meta.label, points, delta, trend };
    });
  }, [history]);

  return { history, historyReady, setHistory, commitHistory, averageScore, completeLoops, totalAttempts, dimensionTrends };
}
