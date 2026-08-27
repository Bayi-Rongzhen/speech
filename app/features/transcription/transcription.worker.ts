import { env, pipeline } from '@huggingface/transformers';

type LoadMessage = {
  type: 'transcribe';
  requestId: string;
  samples: Float32Array;
  modelId: string;
  backend: 'webgpu' | 'wasm';
};

type Transcriber = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>;

const transcribers = new Map<string, Promise<Transcriber>>();
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

function getTranscriber(modelId: string, backend: 'webgpu' | 'wasm', requestId: string) {
  const key = `${modelId}:${backend}`;
  let current = transcribers.get(key);
  if (!current) {
    current = pipeline('automatic-speech-recognition', modelId, {
      device: backend === 'webgpu' ? 'webgpu' : 'wasm',
      dtype: backend === 'webgpu' ? 'q4' : 'q8',
      progress_callback: (progress) => self.postMessage({ type: 'progress', requestId, progress }),
    });
    transcribers.set(key, current);
  }
  return current;
}

self.onmessage = async (event: MessageEvent<LoadMessage>) => {
  if (event.data.type !== 'transcribe') return;
  const { requestId, samples, modelId, backend } = event.data;
  try {
    const transcriber = await getTranscriber(modelId, backend, requestId);
    self.postMessage({ type: 'progress', requestId, progress: { status: 'transcribing', progress: 100 } });
    const output = await transcriber(samples, {
      language: 'chinese',
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ type: 'result', requestId, output, modelId, backend });
  } catch (error) {
    transcribers.delete(`${modelId}:${backend}`);
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : '本地转写失败',
    });
  }
};
