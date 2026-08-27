import { z } from 'zod';

export const TranscriptWordSchema = z.object({
  text: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const TranscriptResultSchema = z.object({
  schemaVersion: z.literal(1),
  rawText: z.string().max(50000),
  editedText: z.string().max(50000),
  language: z.string().min(2).max(20),
  source: z.enum(['local-whisper', 'browser-draft', 'manual']),
  modelId: z.string().min(1).nullable(),
  modelRevision: z.string().nullable(),
  backend: z.enum(['webgpu', 'wasm', 'browser', 'manual']),
  words: z.array(TranscriptWordSchema).max(20000),
  createdAt: z.iso.datetime(),
});

export const TimeRangeSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
});

export const AcousticMetricSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.number().nullable(),
  unit: z.string().min(1),
  available: z.boolean(),
  confidence: z.enum(['low', 'medium', 'high']),
  evidence: z.array(TimeRangeSchema).max(50),
  limitation: z.string().max(600),
});

export const AcousticAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  durationSeconds: z.number().nonnegative(),
  sampleRate: z.number().positive(),
  quality: z.enum(['insufficient', 'limited', 'usable']),
  metrics: z.array(AcousticMetricSchema).max(30),
  pauseRanges: z.array(TimeRangeSchema).max(1000),
  warnings: z.array(z.string().max(400)).max(20),
  createdAt: z.iso.datetime(),
});

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;
export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;
export type AcousticMetric = z.infer<typeof AcousticMetricSchema>;
export type AcousticAnalysis = z.infer<typeof AcousticAnalysisSchema>;
