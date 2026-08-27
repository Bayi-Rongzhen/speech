import type { TranscriptResult } from '../../lib/schemas/audio';

export const LOCAL_TRANSCRIPTION_MODELS = {
  quality: 'onnx-community/whisper-small',
  compact: 'onnx-community/whisper-base',
} as const;

export type TranscriptionProgress = {
  phase: 'download' | 'load' | 'transcribe';
  percent: number | null;
  detail: string;
};

function selectBackend(): 'webgpu' | 'wasm' {
  return 'gpu' in navigator ? 'webgpu' : 'wasm';
}

export function transcribeLocally(
  samples: Float32Array,
  options: {
    modelId?: string;
    signal?: AbortSignal;
    onProgress?: (progress: TranscriptionProgress) => void;
  } = {},
): Promise<TranscriptResult> {
  const modelId = options.modelId ?? LOCAL_TRANSCRIPTION_MODELS.quality;
  const backend = selectBackend();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' });
    const requestId = crypto.randomUUID();
    const cleanup = () => worker.terminate();
    const abort = () => {
      cleanup();
      reject(new DOMException('本地转写已取消', 'AbortError'));
    };
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.type === 'progress') {
        const raw = event.data.progress ?? {};
        const status = String(raw.status ?? 'loading');
        options.onProgress?.({
          phase: status === 'transcribing' ? 'transcribe' : status === 'progress' || status === 'download' ? 'download' : 'load',
          percent: Number.isFinite(raw.progress) ? Math.round(raw.progress) : null,
          detail: status === 'transcribing' ? '正在本机识别语音' : String(raw.file ?? raw.name ?? '正在准备本地模型'),
        });
        return;
      }
      cleanup();
      options.signal?.removeEventListener('abort', abort);
      if (event.data.type === 'error') {
        reject(new Error(event.data.message || '本地转写失败'));
        return;
      }
      const output = event.data.output as { text?: string; chunks?: Array<{ text: string; timestamp: [number, number] }> };
      const rawText = String(output.text ?? '').trim();
      resolve({
        schemaVersion: 1,
        rawText,
        editedText: rawText,
        language: 'zh-CN',
        source: 'local-whisper',
        modelId,
        modelRevision: null,
        backend,
        words: (output.chunks ?? []).flatMap((chunk) => {
          const text = chunk.text.trim();
          if (!text || !Array.isArray(chunk.timestamp)) return [];
          return [{
            text,
            startSeconds: Number(chunk.timestamp[0]) || 0,
            endSeconds: Number(chunk.timestamp[1]) || Number(chunk.timestamp[0]) || 0,
            confidence: null,
          }];
        }),
        createdAt: new Date().toISOString(),
      });
    };
    worker.onerror = () => {
      cleanup();
      options.signal?.removeEventListener('abort', abort);
      reject(new Error('本地转写线程无法启动'));
    };
    worker.postMessage({ type: 'transcribe', requestId, samples, modelId, backend }, [samples.buffer]);
  });
}
