import { z } from 'zod';
import { AcousticAnalysisSchema, TranscriptResultSchema } from './audio';
import { AiScoreRunSchema } from './coaching';
import { TopicSnapshotSchema } from './topic';

const ScoreDimensionSchema = z.object({
  key: z.enum(['content', 'structure', 'evidence', 'clarity', 'delivery', 'timing']),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(100),
  available: z.boolean(),
  summary: z.string(),
});

const FeedbackItemSchema = z.object({
  key: z.enum(['content', 'structure', 'evidence', 'clarity', 'delivery', 'timing']),
  title: z.string(),
  quote: z.string(),
  observation: z.string(),
  action: z.string(),
  drill: z.string(),
});

export const LocalScoreSchema = z.object({
  total: z.number().min(0).max(100),
  level: z.enum(['起步', '发展', '熟练', '出色']),
  confidence: z.enum(['数据较少', '参考性中等', '参考性较高']),
  rubricVersion: z.string(),
  dimensions: z.array(ScoreDimensionSchema).min(1),
  metrics: z.object({
    durationSeconds: z.number().nonnegative(),
    durationEstimated: z.boolean(),
    speechUnits: z.number().nonnegative(),
    pace: z.number().nullable(),
    fillerCount: z.number().nullable(),
    structureSignals: z.number().nonnegative(),
    evidenceSignals: z.number().nonnegative(),
    keywordCoverage: z.number().min(0).max(100),
  }),
  strengths: z.array(z.object({ title: z.string(), detail: z.string(), quote: z.string() })),
  feedback: z.array(FeedbackItemSchema),
  nextFocus: z.string(),
});

export const AttemptRecordV2Schema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  transcript: z.string().max(50000),
  transcriptSource: z.enum(['browser', 'manual', 'edited', 'local-whisper']),
  transcriptResult: TranscriptResultSchema.optional(),
  acousticAnalysis: AcousticAnalysisSchema.optional(),
  aiScore: AiScoreRunSchema.optional(),
  durationSeconds: z.number().nonnegative(),
  topicVersion: z.number().int().positive(),
  targetSeconds: z.number().positive(),
  audioStored: z.boolean(),
  isDemo: z.boolean().optional(),
  score: LocalScoreSchema,
});

export const TrainingRecordV2Schema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  topicTitle: z.string().min(1),
  topicSnapshot: TopicSnapshotSchema.optional(),
  audience: z.string().min(1),
  notes: z.string().max(50000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  attempts: z.array(AttemptRecordV2Schema).min(1),
  schemaVersion: z.literal(2),
});

export const DraftRecordSchema = z.object({
  id: z.string().min(1),
  topic: TopicSnapshotSchema,
  stage: z.enum(['prepare', 'speak', 'recorded', 'transcribing', 'reviewing']),
  notes: z.string().max(50000),
  transcript: z.string().max(50000),
  updatedAt: z.iso.datetime(),
});

export const ExportEnvelopeV2Schema = z.object({
  application: z.literal('讲清楚'),
  schemaVersion: z.literal(2),
  exportedAt: z.iso.datetime(),
  records: z.array(TrainingRecordV2Schema),
});

export type TrainingRecordV2 = z.infer<typeof TrainingRecordV2Schema>;
export type DraftRecord = z.infer<typeof DraftRecordSchema>;
export type ExportEnvelopeV2 = z.infer<typeof ExportEnvelopeV2Schema>;
