import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCoachingEvidence } from './coaching.ts';
import type { AiCoachingResult } from '../schemas/coaching.ts';
import { toTopicSnapshot } from './topics.ts';
import { TOPICS } from '../topics.ts';

const baseResult: AiCoachingResult = {
  schemaVersion: 1,
  overallSummary: '总结',
  dimensions: ['argument', 'structure', 'evidence', 'fidelity', 'audience', 'persuasion'].map((key) => ({
    key: key as AiCoachingResult['dimensions'][number]['key'],
    label: key,
    score: 70,
    confidence: 'medium',
    summary: '可继续练习',
    unavailableReason: null,
  })),
  strengths: [],
  improvements: [{
    title: '明确结论',
    observation: '开头较慢',
    action: '先说结论',
    drill: '练习二十秒开头',
    evidence: [{ type: 'transcript', start: 0, end: 4, quote: '我的观点' }],
  }],
  nextFocus: '先说结论',
  limitations: ['只依据提供内容'],
};

test('语义反馈证据必须逐字对应讲稿', () => {
  const topic = toTopicSnapshot(TOPICS[0]);
  assert.equal(validateCoachingEvidence(baseResult, '我的观点是支持试点。', topic), true);
  const invalid = structuredClone(baseResult);
  invalid.improvements[0].evidence = [{ type: 'transcript', start: 0, end: 4, quote: '不同文字' }];
  assert.equal(validateCoachingEvidence(invalid, '我的观点是支持试点。', topic), false);
});
