'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptRecord } from '../../../lib/types';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped' | 'manual' | 'error';

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative; length: number };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };
type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => RecognitionInstance;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

const getRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
};

const monotonicNow = () => performance.now();

type UseRecorderOptions = {
  targetSeconds: number;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

export function useRecorder({ targetSeconds, onError, onInfo }: UseRecorderOptions) {
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [transcriptSource, setTranscriptSource] = useState<AttemptRecord['transcriptSource']>('manual');
  const [autoTranscript, setAutoTranscript] = useState(false);
  const [saveRecordingLocally, setSaveRecordingLocally] = useState(true);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [transcriptionInterrupted, setTranscriptionInterrupted] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');
  const recordStartRef = useRef(0);
  const pauseStartRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingActiveRef = useRef(false);
  const discardOnStopRef = useRef(false);
  const permissionRequestRef = useRef(0);
  const permissionPendingRef = useRef(false);
  const recognitionGenerationRef = useRef(0);
  const recorderFailedRef = useRef(false);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecognitionSupported(Boolean(getRecognitionConstructor()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const replaceAudioUrl = (next: string | null) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = next;
    setAudioUrl(next);
  };

  const stopTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const stopRecognition = (abort = false) => {
    const recognition = recognitionRef.current;
    if (abort) recognitionGenerationRef.current += 1;
    try {
      if (abort) recognition?.abort();
      else recognition?.stop();
    } catch { /* recognition may already be stopped */ }
    recognitionRef.current = null;
    setInterimTranscript('');
  };

  const clearRecordTimer = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
  };

  const releaseRecorder = useCallback((discard = false) => {
    permissionRequestRef.current += 1;
    permissionPendingRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      discardOnStopRef.current = discard;
      try { recorder.stop(); } catch { /* recorder already stopped */ }
    }
    recordingActiveRef.current = false;
    clearRecordTimer();
    stopTracks();
    stopRecognition(true);
  }, []);

  const reset = () => {
    releaseRecorder(true);
    replaceAudioUrl(null);
    setAudioBlob(null);
    setTranscript('');
    setInterimTranscript('');
    setTranscriptSource('manual');
    setRecordSeconds(0);
    setRecorderStatus('idle');
    setTranscriptionInterrupted(false);
    finalTranscriptRef.current = '';
    chunksRef.current = [];
  };

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!recordingActiveRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    const stopWhenBackgrounded = () => {
      if (document.visibilityState === 'hidden' && permissionPendingRef.current) {
        permissionRequestRef.current += 1;
        permissionPendingRef.current = false;
        setRecorderStatus('idle');
        onInfo('页面进入后台，麦克风授权请求已取消。');
      }
      if (document.visibilityState !== 'hidden' || !recordingActiveRef.current) return;
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;
      discardOnStopRef.current = false;
      onInfo('页面进入后台，录音已自动结束并保留；返回后请检查录音和讲稿。');
      recorder.stop();
    };
    document.addEventListener('visibilitychange', stopWhenBackgrounded);
    return () => document.removeEventListener('visibilitychange', stopWhenBackgrounded);
  }, [onInfo]);

  useEffect(() => () => {
    permissionRequestRef.current += 1;
    recognitionGenerationRef.current += 1;
    discardOnStopRef.current = true;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recognitionRef.current?.abort();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const startRecognition = () => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition || !autoTranscript) return;
    const generation = recognitionGenerationRef.current + 1;
    recognitionGenerationRef.current = generation;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';
    finalTranscriptRef.current = transcript;
    recognition.onresult = (event) => {
      if (generation !== recognitionGenerationRef.current) return;
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interimChunk += result[0].transcript;
      }
      if (finalChunk) {
        finalTranscriptRef.current = `${finalTranscriptRef.current}${finalChunk}`;
        setTranscript(finalTranscriptRef.current);
        setTranscriptSource('browser');
      }
      setInterimTranscript(interimChunk);
    };
    recognition.onerror = (event) => {
      if (generation !== recognitionGenerationRef.current) return;
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        onInfo('自动转写已停止，录音仍在继续。结束后可以手动补充讲稿。');
        setTranscriptionInterrupted(true);
      }
    };
    recognition.onend = () => {
      if (generation !== recognitionGenerationRef.current) return;
      setInterimTranscript('');
      const recorder = mediaRecorderRef.current;
      if (recordingActiveRef.current && recorder?.state === 'recording') {
        setTranscriptionInterrupted(true);
        onInfo('浏览器自动转写已中断，录音仍在继续；结束后请检查讲稿是否完整。');
      }
    };
    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      onInfo('自动转写未能启动，录音仍在继续。');
    }
  };

  const startRecording = async () => {
    if (recorderStatus === 'requesting' || recordingActiveRef.current) return;
    onError('');
    onInfo('');
    setRecorderStatus('requesting');
    const requestToken = permissionRequestRef.current + 1;
    permissionRequestRef.current = requestToken;
    permissionPendingRef.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('unsupported');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (requestToken !== permissionRequestRef.current) {
        permissionPendingRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      permissionPendingRef.current = false;
      mediaStreamRef.current = stream;
      const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      discardOnStopRef.current = false;
      recorderFailedRef.current = false;
      chunksRef.current = [];
      replaceAudioUrl(null);
      setAudioBlob(null);
      setRecordSeconds(0);
      pausedTotalRef.current = 0;
      pauseStartRef.current = 0;
      finalTranscriptRef.current = transcript;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        recorderFailedRef.current = true;
        setRecorderStatus('error');
        onError('录音设备发生了中断。已有讲稿不会丢失，你可以重新录制或直接使用手动稿。');
        recordingActiveRef.current = false;
        clearRecordTimer();
        stopRecognition(true);
        stopTracks();
      };
      recorder.onstop = () => {
        const discard = discardOnStopRef.current;
        discardOnStopRef.current = false;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (discard) {
          chunksRef.current = [];
        } else if (recorderFailedRef.current) {
          chunksRef.current = [];
        } else if (blob.size > 1000) {
          setAudioBlob(blob);
          const nextUrl = URL.createObjectURL(blob);
          replaceAudioUrl(nextUrl);
          setRecorderStatus('stopped');
        } else {
          setRecorderStatus('error');
          onError('这段录音太短或没有收到声音，请重新录制；也可以使用手动讲稿继续。');
        }
        recordingActiveRef.current = false;
        clearRecordTimer();
        stopTracks();
        stopRecognition(false);
      };
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          if (!recordingActiveRef.current || discardOnStopRef.current) return;
          recorderFailedRef.current = true;
          onError('麦克风连接已经中断。请检查设备后重新录制，已有讲稿不会丢失。');
          setRecorderStatus('error');
          stopRecognition(true);
          if (recorder.state !== 'inactive') recorder.stop();
        };
      }
      recorder.start(800);
      recordStartRef.current = monotonicNow();
      recordingActiveRef.current = true;
      setRecorderStatus('recording');
      startRecognition();
      recordTimerRef.current = setInterval(() => {
        const now = monotonicNow();
        const currentPause = pauseStartRef.current ? now - pauseStartRef.current : 0;
        const elapsed = Math.max(0, Math.floor((now - recordStartRef.current - pausedTotalRef.current - currentPause) / 1000));
        setRecordSeconds(elapsed);
        if (elapsed >= targetSeconds + 60 && recorder.state !== 'inactive') recorder.stop();
      }, 250);
    } catch (error) {
      if (requestToken !== permissionRequestRef.current) return;
      permissionPendingRef.current = false;
      stopTracks();
      setRecorderStatus('error');
      const name = error instanceof DOMException ? error.name : '';
      onError(name === 'NotAllowedError'
        ? '麦克风权限没有开启。你可以在浏览器地址栏旁重新授权，或者使用手动讲稿继续。'
        : '暂时无法使用麦克风。请检查设备是否被其他应用占用，或者使用手动讲稿继续。');
    }
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    stopRecognition(true);
    pauseStartRef.current = monotonicNow();
    setRecorderStatus('paused');
  };

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    pausedTotalRef.current += monotonicNow() - pauseStartRef.current;
    pauseStartRef.current = 0;
    setRecorderStatus('recording');
    startRecognition();
  };

  const finishRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (pauseStartRef.current) {
      pausedTotalRef.current += monotonicNow() - pauseStartRef.current;
      pauseStartRef.current = 0;
    }
    discardOnStopRef.current = false;
    recorder.stop();
  };

  const chooseManualMode = () => {
    releaseRecorder(true);
    setRecorderStatus('manual');
    setTranscriptSource('manual');
  };

  const isBusy = () => recordingActiveRef.current || recorderStatus === 'requesting';

  return {
    recorderStatus,
    recordSeconds,
    setRecordSeconds,
    transcript,
    setTranscript,
    interimTranscript,
    transcriptSource,
    setTranscriptSource,
    autoTranscript,
    setAutoTranscript,
    saveRecordingLocally,
    setSaveRecordingLocally,
    recognitionSupported,
    transcriptionInterrupted,
    audioBlob,
    setAudioBlob,
    audioUrl,
    finalTranscriptRef,
    recordingActiveRef,
    startRecording,
    pauseRecording,
    resumeRecording,
    finishRecording,
    chooseManualMode,
    releaseRecorder,
    reset,
    isBusy,
    replaceAudioUrl,
  };
}
