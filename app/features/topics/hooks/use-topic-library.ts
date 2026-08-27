'use client';

import { useEffect, useState } from 'react';
import { fromTopicSnapshot } from '../../../lib/domain/topics';
import { TopicSnapshotSchema } from '../../../lib/schemas/topic';
import { loadGeneratedTopics, saveGeneratedTopics } from '../../../lib/storage';
import { TOPIC_CATEGORIES, TOPICS } from '../../../lib/topics';
import type { Topic } from '../../../lib/types';

function leastUsedCategory(topics: Topic[]) {
  const counts = new Map(TOPIC_CATEGORIES.map((category) => [category, 0]));
  for (const topic of topics) counts.set(topic.category, (counts.get(topic.category) ?? 0) + 1);
  const minCount = Math.min(...counts.values());
  const candidates = TOPIC_CATEGORIES.filter((category) => (counts.get(category) ?? 0) === minCount);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function useTopicLibrary() {
  const [generatedTopics, setGeneratedTopics] = useState<Topic[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGeneratedTopics(loadGeneratedTopics().map(fromTopicSnapshot));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const generateTopic = async (focusHint?: string) => {
    setBusy(true);
    setError('');
    try {
      const known = [...TOPICS, ...generatedTopics];
      const response = await fetch('/api/topics/surprise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          excludeTitles: known.map((topic) => topic.title).slice(-40),
          categoryHint: leastUsedCategory(known),
          focusHint,
        }),
      });
      const data = await response.json() as { topic?: unknown; error?: string };
      if (!response.ok || !data.topic) throw new Error(data.error || '暂时无法生成新题目。');
      const snapshot = TopicSnapshotSchema.parse(data.topic);
      const nextSnapshots = [snapshot, ...loadGeneratedTopics()];
      saveGeneratedTopics(nextSnapshots);
      setGeneratedTopics(nextSnapshots.map(fromTopicSnapshot));
      return fromTopicSnapshot(snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法生成新题目。');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const removeTopic = (id: string) => {
    const next = loadGeneratedTopics().filter((topic) => topic.id !== id);
    saveGeneratedTopics(next);
    setGeneratedTopics(next.map(fromTopicSnapshot));
  };

  return { generatedTopics, busy, error, generateTopic, removeTopic };
}
