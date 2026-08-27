import type { AcousticAnalysis, TranscriptWord } from '../../lib/schemas/audio';

export async function decodeAudio(blob: Blob) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) samples[index] += data[index] / buffer.numberOfChannels;
    }
    return { samples, sampleRate: buffer.sampleRate, durationSeconds: buffer.duration };
  } finally {
    await context.close();
  }
}

export async function resampleTo16Khz(samples: Float32Array, sampleRate: number) {
  if (sampleRate === 16000) return samples;
  const length = Math.ceil(samples.length * 16000 / sampleRate);
  const context = new OfflineAudioContext(1, length, 16000);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

export function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
  words: TranscriptWord[] = [],
  signal?: AbortSignal,
): Promise<AcousticAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audio-analysis.worker.ts', import.meta.url), { type: 'module' });
    const requestId = crypto.randomUUID();
    const cleanup = () => worker.terminate();
    const abort = () => {
      cleanup();
      reject(new DOMException('声音分析已取消', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      if (event.data.requestId !== requestId) return;
      cleanup();
      signal?.removeEventListener('abort', abort);
      if (event.data.type === 'result') resolve(event.data.result);
      else reject(new Error(event.data.message || '声音分析失败'));
    };
    worker.onerror = () => {
      cleanup();
      signal?.removeEventListener('abort', abort);
      reject(new Error('声音分析线程无法启动'));
    };
    worker.postMessage({ type: 'analyze', requestId, samples, sampleRate, words });
  });
}
