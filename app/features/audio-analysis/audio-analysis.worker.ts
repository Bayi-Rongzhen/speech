import { analyzePcm } from './analyze';
import type { TranscriptWord } from '../../lib/schemas/audio';

type AnalyzeMessage = {
  type: 'analyze';
  requestId: string;
  samples: Float32Array;
  sampleRate: number;
  words: TranscriptWord[];
};

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data.type !== 'analyze') return;
  try {
    const result = analyzePcm(event.data.samples, event.data.sampleRate, event.data.words);
    self.postMessage({ type: 'result', requestId: event.data.requestId, result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : '声音分析失败',
    });
  }
};
