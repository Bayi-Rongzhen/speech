import { z } from 'zod';

const TranscriptEvidenceSchema = z.object({
  type: z.literal('transcript'),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().min(1).max(500),
});

const TimeEvidenceSchema = z.object({
  type: z.literal('time'),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
});

const MetricEvidenceSchema = z.object({
  type: z.literal('metric'),
  metricId: z.string().min(1),
});

const SourceEvidenceSchema = z.object({
  type: z.literal('source'),
  sourceId: z.string().min(1),
});

export const CoachingEvidenceSchema = z.discriminatedUnion('type', [
  TranscriptEvidenceSchema,
  TimeEvidenceSchema,
  MetricEvidenceSchema,
  SourceEvidenceSchema,
]);

export const SemanticDimensionKeySchema = z.enum([
  'argument',
  'structure',
  'evidence',
  'fidelity',
  'audience',
  'persuasion',
]);

export const SemanticDimensionSchema = z.object({
  key: SemanticDimensionKeySchema,
  label: z.string().min(1).max(40),
  score: z.number().int().min(0).max(100).nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1).max(500),
  unavailableReason: z.string().max(300).nullable(),
});

export const CoachingPointSchema = z.object({
  title: z.string().min(1).max(100),
  observation: z.string().min(1).max(700),
  action: z.string().min(1).max(700),
  drill: z.string().min(1).max(500),
  evidence: z.array(CoachingEvidenceSchema).min(1).max(6),
});

export const AiCoachingResultSchema = z.object({
  schemaVersion: z.literal(1),
  overallSummary: z.string().min(1).max(1000),
  dimensions: z.array(SemanticDimensionSchema).length(6),
  strengths: z.array(CoachingPointSchema).max(3),
  improvements: z.array(CoachingPointSchema).min(1).max(4),
  nextFocus: z.string().min(1).max(500),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(8),
});

export const AiScoreRunSchema = z.object({
  status: z.enum(['complete', 'failed']),
  scorer: z.enum(['claude', 'anthropic', 'deepseek', 'openai-compatible', 'anthropic-compatible']),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  rubricVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
  result: AiCoachingResultSchema.nullable(),
  errorCode: z.string().nullable(),
});

export type CoachingEvidence = z.infer<typeof CoachingEvidenceSchema>;
export type AiCoachingResult = z.infer<typeof AiCoachingResultSchema>;
export type AiScoreRun = z.infer<typeof AiScoreRunSchema>;
