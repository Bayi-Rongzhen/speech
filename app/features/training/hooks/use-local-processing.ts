'use client';

import { useEffect, useRef, useState } from 'react';
import { analyzeAudio, decodeAudio, resampleTo16Khz } from '../../audio-analysis/client';
import { LOCAL_TRANSCRIPTION_MODELS, transcribeLocally, type TranscriptionProgress } from '../../transcription/client';
import type { AttemptRecord } from '../../../lib/types';

type Insights = Pick<AttemptRecord, 'transcriptResult' | 'acousticAnalysis'>;

type UseLocalProcessingOptions = {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

export function useLocalProcessing({ onTranscript, onError, onInfo }: UseLocalProcessingOptions) {
  const [enabled, setEnabled] = useState(true);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const process = async (audioBlob: Blob | null) => {
    if (!audioBlob) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    onError('');
    setProgress({ phase: 'load', percent: null, detail: '正在解码本机录音' });
    try {
      const decoded = await decodeAudio(audioBlob);
      const transcriptionSamples = await resampleTo16Khz(decoded.samples, decoded.sampleRate);
      const transcriptResult = await transcribeLocally(transcriptionSamples, {
        modelId: LOCAL_TRANSCRIPTION_MODELS.quality,
        signal: controller.signal,
        onProgress: setProgress,
      });
      onTranscript(transcriptResult.editedText);
      const acoustic = await analyzeAudio(decoded.samples, decoded.sampleRate, transcriptResult.words, controller.signal);
      setInsights({ transcriptResult, acousticAnalysis: acoustic });
      setProgress(null);
      onInfo('录音已在本机完成转写和声音分析；原始音频没有上传。');
    } catch (error) {
      setProgress(null);
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onError('本地高质量转写未能完成。你可以改用轻量模型重试，或直接手动补充讲稿。');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    setInsights(null);
  };

  return { enabled, setEnabled, progress, insights, process, cancel, reset };
}
