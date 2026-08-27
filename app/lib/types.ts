import type { AcousticAnalysis, TranscriptResult } from './schemas/audio';
import type { AiScoreRun } from './schemas/coaching';

export type Topic = {
  id: string;
  version: number;
  origin?: 'preset' | 'custom' | 'researched';
  category: string;
  title: string;
  audience: string;
  task: string;
  prepMinutes: number;
  speechSeconds: number;
  difficulty: '入门' | '进阶' | '挑战';
  sources: Array<{
    id?: string;
    kind?: 'simulated' | 'user' | 'web';
    status?: 'simulated' | 'user-provided' | 'retrieved' | 'limited';
    label: string;
    title: string;
    body: string;
    url?: string;
    publisher?: string;
    retrievedAt?: string;
    citedText?: string;
  }>;
  keywords: string[];
  keywordGroups?: string[][];
  createdAt?: string;
};

export type DimensionKey = 'content' | 'structure' | 'evidence' | 'clarity' | 'delivery' | 'timing';

export type ScoreDimension = {
  key: DimensionKey;
  label: string;
  score: number;
  weight: number;
  available: boolean;
  summary: string;
};

export type FeedbackItem = {
  key: DimensionKey;
  title: string;
  quote: string;
  observation: string;
  action: string;
  drill: string;
};

export type ScoreResult = {
  total: number;
  level: '起步' | '发展' | '熟练' | '出色';
  confidence: '数据较少' | '参考性中等' | '参考性较高';
  rubricVersion: string;
  dimensions: ScoreDimension[];
  metrics: {
    durationSeconds: number;
    durationEstimated: boolean;
    speechUnits: number;
    pace: number | null;
    fillerCount: number | null;
    structureSignals: number;
    evidenceSignals: number;
    keywordCoverage: number;
  };
  strengths: Array<{ title: string; detail: string; quote: string }>;
  feedback: FeedbackItem[];
  nextFocus: string;
};

export type AttemptRecord = {
  id: string;
  createdAt: string;
  transcript: string;
  transcriptSource: 'browser' | 'manual' | 'edited' | 'local-whisper';
  transcriptResult?: TranscriptResult;
  acousticAnalysis?: AcousticAnalysis;
  aiScore?: AiScoreRun;
  durationSeconds: number;
  topicVersion: number;
  targetSeconds: number;
  audioStored: boolean;
  isDemo?: boolean;
  score: ScoreResult;
};

export type TrainingRecord = {
  id: string;
  topicId: string;
  topicTitle: string;
  topicSnapshot?: Topic;
  audience: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  attempts: AttemptRecord[];
  schemaVersion: 1 | 2;
};
