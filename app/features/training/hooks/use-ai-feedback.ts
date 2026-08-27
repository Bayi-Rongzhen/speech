'use client';

import { useEffect, useState } from 'react';
import { clearSessionProvider, loadSessionProvider } from '../../ai-provider/provider-session';
import { toTopicSnapshot } from '../../../lib/domain/topics';
import { AiScoreRunSchema, type AiScoreRun } from '../../../lib/schemas/coaching';
import type { ProviderConnection } from '../../../lib/schemas/ai-provider';
import type { AttemptRecord, Topic } from '../../../lib/types';

export function useAiFeedback() {
  const [provider, setProvider] = useState<ProviderConnection | null>(null);
  const [consent, setConsent] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setProvider(loadSessionProvider()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const clearProvider = () => {
    clearSessionProvider();
    setProvider(null);
  };

  const requestFeedback = async (attempt: AttemptRecord, topic: Topic, onSuccess: (aiScore: AiScoreRun) => void) => {
    if (!attempt || !consent || !provider || analyzing) return;
    setAnalyzing(true);
    setError('');
    try {
      const response = await fetch('/api/coach/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          provider,
          transcript: attempt.transcript,
          topic: toTopicSnapshot(topic),
          acoustic: attempt.acousticAnalysis,
        }),
      });
      const data = await response.json() as unknown;
      if (!response.ok) {
        const message = typeof data === 'object' && data && 'error' in data
          ? String((data as { error?: { message?: string } }).error?.message ?? 'AI 深度反馈暂时无法完成。')
          : 'AI 深度反馈暂时无法完成。';
        throw new Error(message);
      }
      onSuccess(AiScoreRunSchema.parse(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 深度反馈暂时无法完成。');
    } finally {
      setAnalyzing(false);
    }
  };

  return { provider, setProvider, consent, setConsent, analyzing, error, setError, requestFeedback, clearProvider };
}
