import type { Topic } from '../types';
import type { TopicSnapshot } from '../schemas/topic';

export function toTopicSnapshot(topic: Topic): TopicSnapshot {
  const createdAt = topic.createdAt ?? new Date(0).toISOString();
  return {
    id: topic.id,
    version: topic.version,
    origin: topic.origin ?? 'preset',
    category: topic.category,
    title: topic.title,
    audience: topic.audience,
    task: topic.task,
    prepMinutes: topic.prepMinutes,
    speechSeconds: topic.speechSeconds,
    difficulty: topic.difficulty,
    sources: topic.sources.map((source, index) => ({
      id: source.id ?? `${topic.id}-source-${index + 1}`,
      kind: source.kind ?? 'simulated',
      status: source.status ?? 'simulated',
      label: source.label,
      title: source.title,
      body: source.body,
      url: source.url,
      publisher: source.publisher,
      retrievedAt: source.retrievedAt,
      citedText: source.citedText,
    })),
    keywordGroups: topic.keywordGroups ?? topic.keywords.map((keyword) => [keyword]),
    createdAt,
  };
}

export function fromTopicSnapshot(snapshot: TopicSnapshot): Topic {
  return {
    ...snapshot,
    keywords: snapshot.keywordGroups.map((group) => group[0]),
  };
}
