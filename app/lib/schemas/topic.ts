import { z } from 'zod';

export const SourceKindSchema = z.enum(['simulated', 'user', 'web']);
export const SourceStatusSchema = z.enum(['simulated', 'user-provided', 'retrieved', 'limited']);

export const SourceRecordSchema = z.object({
  id: z.string().min(1),
  kind: SourceKindSchema,
  status: SourceStatusSchema,
  label: z.string().min(1).max(80),
  title: z.string().min(1).max(240),
  body: z.string().min(1).max(8000),
  url: z.url().optional(),
  publisher: z.string().max(200).optional(),
  retrievedAt: z.iso.datetime().optional(),
  citedText: z.string().max(4000).optional(),
});

export const TopicSnapshotSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  origin: z.enum(['preset', 'custom', 'researched']),
  category: z.string().min(1).max(80),
  title: z.string().min(1).max(240),
  audience: z.string().min(1).max(240),
  task: z.string().min(1).max(600),
  prepMinutes: z.number().int().min(1).max(60),
  speechSeconds: z.number().int().min(30).max(1800),
  difficulty: z.enum(['入门', '进阶', '挑战']),
  sources: z.array(SourceRecordSchema).max(12),
  keywordGroups: z.array(z.array(z.string().min(1).max(80)).min(1).max(12)).min(1).max(24),
  createdAt: z.iso.datetime(),
});

export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type TopicSnapshot = z.infer<typeof TopicSnapshotSchema>;
