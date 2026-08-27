import type { AcousticAnalysis } from '../schemas/audio';
import type { AiCoachingResult, CoachingEvidence } from '../schemas/coaching';
import type { TopicSnapshot } from '../schemas/topic';

export function validateCoachingEvidence(
  result: AiCoachingResult,
  transcript: string,
  topic: TopicSnapshot,
  acoustic?: AcousticAnalysis,
) {
  const metricIds = new Set(acoustic?.metrics.map((metric) => metric.id) ?? []);
  const sourceIds = new Set(topic.sources.map((source) => source.id));
  const validate = (evidence: CoachingEvidence) => {
    if (evidence.type === 'transcript') {
      return evidence.start >= 0
        && evidence.end <= transcript.length
        && evidence.start < evidence.end
        && transcript.slice(evidence.start, evidence.end).trim() === evidence.quote.trim();
    }
    if (evidence.type === 'time') {
      return evidence.startSeconds >= 0
        && evidence.startSeconds < evidence.endSeconds
        && evidence.endSeconds <= (acoustic?.durationSeconds ?? 0) + 0.25;
    }
    if (evidence.type === 'metric') return metricIds.has(evidence.metricId);
    return sourceIds.has(evidence.sourceId);
  };
  const points = [...result.strengths, ...result.improvements];
  return points.every((point) => point.evidence.length > 0 && point.evidence.every(validate));
}
