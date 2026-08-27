import type { AttemptRecord } from '../types';

export function attemptsComparable(first?: AttemptRecord, latest?: AttemptRecord) {
  if (!first || !latest) return false;
  const sameLocalBasis = first.score.rubricVersion === latest.score.rubricVersion
    && first.topicVersion === latest.topicVersion
    && first.targetSeconds === latest.targetSeconds
    && first.transcriptSource === latest.transcriptSource
    && first.score.metrics.durationEstimated === latest.score.metrics.durationEstimated;
  if (!sameLocalBasis) return false;
  if (first.transcriptResult || latest.transcriptResult) {
    if (first.transcriptResult?.modelId !== latest.transcriptResult?.modelId
      || first.transcriptResult?.backend !== latest.transcriptResult?.backend) return false;
  }
  if (first.acousticAnalysis || latest.acousticAnalysis) {
    if (first.acousticAnalysis?.schemaVersion !== latest.acousticAnalysis?.schemaVersion
      || first.acousticAnalysis?.quality !== latest.acousticAnalysis?.quality) return false;
  }
  if (first.aiScore || latest.aiScore) {
    if (first.aiScore?.status !== 'complete' || latest.aiScore?.status !== 'complete') return false;
    if (first.aiScore.scorer !== latest.aiScore.scorer
      || first.aiScore.model !== latest.aiScore.model
      || first.aiScore.promptVersion !== latest.aiScore.promptVersion
      || first.aiScore.rubricVersion !== latest.aiScore.rubricVersion) return false;
  }
  return true;
}
