'use client';

/* eslint-disable react-hooks/refs -- Media and object-URL refs are read only from user event handlers and lifecycle callbacks. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countSpeechUnits, estimateDuration, scoreSpeech } from './lib/scoring';
import { clearLocalData, deleteStoredAudio, getStoredAudio, HISTORY_STORAGE_KEY, loadHistory, saveHistory, storeAudio } from './lib/storage';
import { TOPICS } from './lib/topics';
import type { AttemptRecord, DimensionKey, Topic, TrainingRecord } from './lib/types';

type Screen = 'home' | 'topics' | 'progress' | 'prepare' | 'speak' | 'report' | 'compare';
type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped' | 'manual' | 'error';

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

const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createPrepDeadline = (minutes: number) => Date.now() + minutes * 60 * 1000;
const monotonicNow = () => performance.now();

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

const formatDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
};

const attemptsComparable = (first: AttemptRecord | undefined, latest: AttemptRecord | undefined) => Boolean(
  first && latest
  && first.score.rubricVersion === latest.score.rubricVersion
  && first.topicVersion === latest.topicVersion
  && first.targetSeconds === latest.targetSeconds
  && first.transcriptSource === latest.transcriptSource
  && first.score.metrics.durationEstimated === latest.score.metrics.durationEstimated,
);

const getRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
};

const sampleTranscript = (topic: Topic) => `各位${topic.audience}的老师和代表，关于“${topic.title}”，我的建议是不要简单地全面允许或全面禁止，而是先设定清楚的规则，再进行一段时间的试点。首先，${topic.sources[0].body} 这意味着我们确实面对一个需要解决的现实问题，但单一数字还不能直接替我们作决定。其次，${topic.sources[1].body} 从这份资料可以看到，方案真正的价值不只是短期便利，而是能否改善长期结果。同时，我们也不能回避反方最强的担忧：${topic.sources[2].body} 因此，我建议把试点范围、评估指标和退出条件同时写进方案。第一，明确哪些场景可以使用，哪些场景必须保留原有方式；第二，在八到十二周后，根据实际效果、使用体验和潜在风险进行复盘；第三，为特殊需求保留清楚、方便的例外。总之，我支持的是一个可以验证、可以调整、也可以停止的方案。这样既不回避变化，也不会让所有人一次性承担未经验证的风险。`;

const dimensionTone: Record<DimensionKey, string> = {
  content: 'forest', structure: 'orange', evidence: 'lime', clarity: 'blue', delivery: 'rose', timing: 'sand',
};

function AppHeader({ screen, onNavigate }: { screen: Screen; onNavigate: (next: Screen) => void }) {
  const practiceActive = screen === 'home' || ['prepare', 'speak', 'report', 'compare'].includes(screen);
  return (
    <header className="app-header">
      <button className="brand-button" type="button" onClick={() => onNavigate('home')} aria-label="返回讲清楚首页">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span>讲清楚</span>
      </button>
      <nav className="app-nav" aria-label="主导航">
        <button className={practiceActive ? 'active' : ''} aria-current={practiceActive ? 'page' : undefined} onClick={() => onNavigate('home')}>练习</button>
        <button className={screen === 'progress' ? 'active' : ''} aria-current={screen === 'progress' ? 'page' : undefined} onClick={() => onNavigate('progress')}>成长</button>
        <button className={screen === 'topics' ? 'active' : ''} aria-current={screen === 'topics' ? 'page' : undefined} onClick={() => onNavigate('topics')}>题库</button>
      </nav>
      <button className="profile" type="button" onClick={() => onNavigate('progress')} aria-label="查看本地训练记录">本地</button>
    </header>
  );
}

function TrainingStepper({ current }: { current: number }) {
  return (
    <ol className="stepper" aria-label={`训练第 ${current} 步，共 4 步`}>
      {['限时学习', '完成演说', '查看反馈', '同题重讲'].map((label, index) => (
        <li className={index + 1 < current ? 'complete' : index + 1 === current ? 'current' : ''} aria-current={index + 1 === current ? 'step' : undefined} key={label}>
          <span>{index + 1 < current ? '✓' : index + 1}</span><b>{label}</b>
        </li>
      ))}
    </ol>
  );
}

function Notices({ error, info, onDismiss }: { error: string; info: string; onDismiss: () => void }) {
  return (
    <>
      {error && <div className="notice error" role="alert">{error}</div>}
      {info && <div className="notice info" role="status"><span>{info}</span><button type="button" onClick={onDismiss} aria-label="关闭提示">×</button></div>}
    </>
  );
}

export default function SpeechCoach() {
  const [screen, setScreen] = useState<Screen>('home');
  const [topicIndex, setTopicIndex] = useState(0);
  const topic = TOPICS[topicIndex];
  const [history, setHistory] = useState<TrainingRecord[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [trainingId, setTrainingId] = useState('');
  const [notes, setNotes] = useState('');
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [prepEndsAt, setPrepEndsAt] = useState<number | null>(null);
  const [prepRemaining, setPrepRemaining] = useState(topic.prepMinutes * 60);
  const [prepExpired, setPrepExpired] = useState(false);
  const [recorderStatus, setRecorderStatus] = useState<RecorderStatus>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [transcriptSource, setTranscriptSource] = useState<AttemptRecord['transcriptSource']>('manual');
  const [autoTranscript, setAutoTranscript] = useState(false);
  const [saveRecordingLocally, setSaveRecordingLocally] = useState(true);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [transcriptionInterrupted, setTranscriptionInterrupted] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackId, setPlaybackId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [storageMessage, setStorageMessage] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
  const playbackUrlRef = useRef<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const initialScreenRef = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHistory(loadHistory());
      setHistoryReady(true);
      setRecognitionSupported(Boolean(getRecognitionConstructor()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (initialScreenRef.current) {
      initialScreenRef.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [screen]);

  useEffect(() => {
    const syncOtherTab = (event: StorageEvent) => {
      if (event.key === HISTORY_STORAGE_KEY) setHistory(loadHistory());
    };
    window.addEventListener('storage', syncOtherTab);
    return () => window.removeEventListener('storage', syncOtherTab);
  }, []);

  useEffect(() => {
    if (screen !== 'prepare' || !prepEndsAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((prepEndsAt - Date.now()) / 1000));
      setPrepRemaining(remaining);
      if (remaining === 0) setPrepExpired(true);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [screen, prepEndsAt]);

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
        setStorageMessage('页面进入后台，麦克风授权请求已取消。');
      }
      if (document.visibilityState !== 'hidden' || !recordingActiveRef.current) return;
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;
      discardOnStopRef.current = false;
      setStorageMessage('页面进入后台，录音已自动结束并保留；返回后请检查录音和讲稿。');
      recorder.stop();
    };
    document.addEventListener('visibilitychange', stopWhenBackgrounded);
    return () => document.removeEventListener('visibilitychange', stopWhenBackgrounded);
  }, []);

  useEffect(() => () => {
    permissionRequestRef.current += 1;
    recognitionGenerationRef.current += 1;
    discardOnStopRef.current = true;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recognitionRef.current?.abort();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
  }, []);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const commitHistory = (next: TrainingRecord[]) => {
    setHistory(next);
    const saved = saveHistory(next);
    if (!saved) setStorageMessage('浏览器未能保存记录，请先复制讲稿或检查可用空间。');
    return saved;
  };

  const replaceAudioUrl = (next: string | null) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = next;
    setAudioUrl(next);
  };

  const replacePlaybackUrl = (next: string | null) => {
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    playbackUrlRef.current = next;
    setPlaybackUrl(next);
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

  const resetAttemptInput = () => {
    releaseRecorder(true);
    replaceAudioUrl(null);
    setAudioBlob(null);
    setTranscript('');
    setInterimTranscript('');
    setTranscriptSource('manual');
    setRecordSeconds(0);
    setRecorderStatus('idle');
    setErrorMessage('');
    setTranscriptionInterrupted(false);
    finalTranscriptRef.current = '';
    chunksRef.current = [];
  };

  const goTo = (next: Screen) => {
    const recorderBusy = recordingActiveRef.current || recorderStatus === 'requesting';
    const leavingDraft = ['prepare', 'speak'].includes(screen) && next !== screen && (recorderBusy || Boolean(notes.trim()) || Boolean(transcript.trim()));
    if (leavingDraft && !window.confirm('退出当前训练？尚未生成反馈的录音或讲稿会丢失。')) return;
    if (recorderBusy) releaseRecorder(true);
    setScreen(next);
    setErrorMessage('');
    scrollTop();
  };

  const startTraining = (index = topicIndex) => {
    resetAttemptInput();
    const nextTopic = TOPICS[index];
    setTopicIndex(index);
    setTrainingId(createId());
    setNotes('');
    setAttempts([]);
    setDemoMode(false);
    setPrepExpired(false);
    setPrepRemaining(nextTopic.prepMinutes * 60);
    setPrepEndsAt(createPrepDeadline(nextTopic.prepMinutes));
    setScreen('prepare');
    scrollTop();
  };

  const enterSpeaking = () => {
    setPrepEndsAt(null);
    resetAttemptInput();
    setScreen('speak');
    scrollTop();
  };

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
        setStorageMessage('自动转写已停止，录音仍在继续。结束后可以手动补充讲稿。');
        setTranscriptionInterrupted(true);
      }
    };
    recognition.onend = () => {
      if (generation !== recognitionGenerationRef.current) return;
      setInterimTranscript('');
      const recorder = mediaRecorderRef.current;
      if (recordingActiveRef.current && recorder?.state === 'recording') {
        setTranscriptionInterrupted(true);
        setStorageMessage('浏览器自动转写已中断，录音仍在继续；结束后请检查讲稿是否完整。');
      }
    };
    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setStorageMessage('自动转写未能启动，录音仍在继续。');
    }
  };

  const startRecording = async () => {
    if (recorderStatus === 'requesting' || recordingActiveRef.current) return;
    setErrorMessage('');
    setStorageMessage('');
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
        setErrorMessage('录音设备发生了中断。已有讲稿不会丢失，你可以重新录制或直接使用手动稿。');
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
          setErrorMessage('这段录音太短或没有收到声音，请重新录制；也可以使用手动讲稿继续。');
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
          setErrorMessage('麦克风连接已经中断。请检查设备后重新录制，已有讲稿不会丢失。');
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
        if (elapsed >= topic.speechSeconds + 60 && recorder.state !== 'inactive') recorder.stop();
      }, 250);
    } catch (error) {
      if (requestToken !== permissionRequestRef.current) return;
      permissionPendingRef.current = false;
      stopTracks();
      setRecorderStatus('error');
      const name = error instanceof DOMException ? error.name : '';
      setErrorMessage(name === 'NotAllowedError'
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
    setErrorMessage('');
    setTranscriptSource('manual');
  };

  const loadExample = () => {
    const example = sampleTranscript(topic);
    setTranscript(example);
    finalTranscriptRef.current = example;
    setTranscriptSource('manual');
    setDemoMode(true);
    if (!recordSeconds) setRecordSeconds(estimateDuration(example));
    setStorageMessage('已填入示例讲稿，方便你先体验完整反馈流程。');
  };

  const analyze = async () => {
    const clean = transcript.trim();
    const speechUnits = countSpeechUnits(clean);
    const distinctUnits = new Set(clean.replace(/\s|[，。！？!?；;、“”‘’：:（）()《》]/g, '').split('')).size;
    if (speechUnits < 40 || distinctUnits < 12) {
      setErrorMessage('有效讲稿内容还太少。请补充至少 40 个有意义的字词，让系统有足够依据分析。');
      return;
    }
    if (!recordSeconds && !demoMode && recorderStatus !== 'manual') {
      setErrorMessage('请先完成录音，或者明确选择“文本演练”后再生成反馈。');
      return;
    }
    setIsAnalyzing(true);
    setErrorMessage('');
    const durationEstimated = !audioBlob || recordSeconds < 10;
    const duration = durationEstimated ? estimateDuration(clean) : recordSeconds;
    const score = scoreSpeech(clean, duration, durationEstimated, topic, transcriptSource);
    const attemptId = createId();
    const attempt: AttemptRecord = {
      id: attemptId,
      createdAt: new Date().toISOString(),
      transcript: clean,
      transcriptSource,
      durationSeconds: duration,
      topicVersion: topic.version,
      targetSeconds: topic.speechSeconds,
      audioStored: false,
      isDemo: demoMode,
      score,
    };
    let audioStored = false;
    if (!demoMode && saveRecordingLocally && audioBlob) {
      audioStored = await storeAudio(attemptId, audioBlob);
      attempt.audioStored = audioStored;
      if (!audioStored) setStorageMessage('反馈已生成，但本地录音没有保存成功；讲稿与评分仍可保存。');
    }
    const nextAttempts = [...attempts, attempt];
    setAttempts(nextAttempts);
    if (demoMode) {
      setIsAnalyzing(false);
      setScreen('report');
      scrollTop();
      return;
    }
    const now = new Date().toISOString();
    const currentRecord: TrainingRecord = {
      id: trainingId || createId(),
      topicId: topic.id,
      topicTitle: topic.title,
      audience: topic.audience,
      notes,
      createdAt: history.find((item) => item.id === trainingId)?.createdAt ?? now,
      updatedAt: now,
      attempts: nextAttempts,
      schemaVersion: 1,
    };
    const freshestHistory = loadHistory();
    const nextHistory = [currentRecord, ...freshestHistory.filter((item) => item.id !== currentRecord.id)];
    const historySaved = commitHistory(nextHistory);
    if (!historySaved && audioStored) {
      await deleteStoredAudio(attemptId);
      attempt.audioStored = false;
    }
    setTrainingId(currentRecord.id);
    setIsAnalyzing(false);
    setScreen(nextAttempts.length > 1 ? 'compare' : 'report');
    scrollTop();
  };

  const repeatSpeech = () => {
    resetAttemptInput();
    setScreen('speak');
    scrollTop();
  };

  const openRecord = (record: TrainingRecord) => {
    const index = TOPICS.findIndex((item) => item.id === record.topicId);
    setTopicIndex(index >= 0 ? index : 0);
    setTrainingId(record.id);
    setNotes(record.notes);
    setAttempts(record.attempts);
    replaceAudioUrl(null);
    replacePlaybackUrl(null);
    setPlaybackId(null);
    setAudioBlob(null);
    setScreen(record.attempts.length > 1 ? 'compare' : 'report');
    scrollTop();
  };

  const loadPlayback = async (id: string) => {
    replacePlaybackUrl(null);
    const blob = await getStoredAudio(id);
    if (!blob) {
      setStorageMessage('没有找到这段本地录音，文本与评分记录仍然保留。');
      setPlaybackId(null);
      return;
    }
    setPlaybackId(id);
    replacePlaybackUrl(URL.createObjectURL(blob));
  };

  const deleteRecord = async (record: TrainingRecord) => {
    if (!window.confirm('永久删除这次训练的讲稿、评分和本地录音？')) return;
    const storedAttempts = record.attempts.filter((attempt) => attempt.audioStored);
    const results = await Promise.all(storedAttempts.map((attempt) => deleteStoredAudio(attempt.id)));
    if (results.some((result) => !result)) {
      setStorageMessage('部分本地录音未能删除。请关闭其他打开本页面的标签后重试。');
      return;
    }
    if (record.attempts.some((attempt) => attempt.id === playbackId)) {
      replacePlaybackUrl(null);
      setPlaybackId(null);
    }
    const freshestHistory = loadHistory();
    commitHistory(freshestHistory.filter((item) => item.id !== record.id));
  };

  const clearEverything = async () => {
    if (!window.confirm('永久清除这台设备上的全部训练记录和录音？此操作无法撤销。')) return;
    const cleared = await clearLocalData();
    if (!cleared) {
      setStorageMessage('本地录音库正被其他标签页占用。请关闭其他页面后重试清除。');
      return;
    }
    replaceAudioUrl(null);
    replacePlaybackUrl(null);
    setPlaybackId(null);
    setHistory([]);
    setAttempts([]);
    setStorageMessage('这台设备上的训练数据已经全部清除。');
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records: history }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `讲清楚-训练记录-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const latestScores = useMemo(() => history.map((record) => record.attempts.at(-1)?.score).filter(Boolean), [history]);
  const averageScore = latestScores.length
    ? Math.round(latestScores.reduce((sum, score) => sum + (score?.total ?? 0), 0) / latestScores.length)
    : 0;
  const completeLoops = history.filter((record) => record.attempts.length > 1).length;

  const renderHome = () => {
    const current = TOPICS[topicIndex];
    return (
      <>
        <section className="home-hero">
          <div className="hero-copy">
            <p className="eyebrow"><span /> 今日练习 · 约 20 分钟</p>
            <h1>把陌生问题，<br />讲成自己的答案。</h1>
            <p className="lede">限时读资料、组织观点、开口讲出来。先看三条反馈，第二遍只练最重要的一条。</p>
            <button className="primary-action" type="button" onClick={() => startTraining()}>
              开始今日训练 <span aria-hidden="true">→</span>
            </button>
            <p className="privacy-note"><span aria-hidden="true">●</span> 无需登录 · 反馈依据文字稿 · 数据默认仅存本机</p>
          </div>
          <article className="challenge-card" aria-label="今日训练题目">
            <div className="card-topline">
              <span className="topic-label">今日题目</span>
              <button className="shuffle" type="button" onClick={() => setTopicIndex((topicIndex + 1) % TOPICS.length)}>换一题 ↻</button>
            </div>
            <h2>{current.title}</h2>
            <p className="audience">面向：{current.audience}</p>
            <div className="challenge-meta">
              <div><strong>{current.prepMinutes}</strong><span>分钟准备</span></div>
              <div><strong>{current.speechSeconds / 60}</strong><span>分钟演说</span></div>
              <div><strong>{current.sources.length}</strong><span>份模拟资料</span></div>
            </div>
            <div className="difficulty"><span>难度</span><i className="filled" /><i className={current.difficulty !== '入门' ? 'filled' : ''} /><i className={current.difficulty === '挑战' ? 'filled' : ''} /><em>{current.difficulty}</em></div>
          </article>
        </section>

        <section className="progress-strip" aria-label="训练进度">
          <div className="week-copy">
            <span className="section-kicker">你的节奏</span>
            <strong>{historyReady ? `${history.length} 次训练记录` : '正在读取本地记录'}</strong>
            <p>{completeLoops ? `已完成 ${completeLoops} 次同题重讲。` : '完成第一次重讲，就能看到前后变化。'}</p>
          </div>
          <div className="mini-stats">
            <div><strong>{completeLoops}</strong><span>完整闭环</span></div>
            <div><strong>{averageScore || '—'}</strong><span>近期参考分</span></div>
            <div><strong>{history.reduce((sum, item) => sum + item.attempts.length, 0)}</strong><span>累计开口</span></div>
          </div>
          <button className="text-action" type="button" onClick={() => goTo(history.length ? 'progress' : 'topics')}>{history.length ? '查看成长记录' : '浏览全部题目'} <span>→</span></button>
        </section>

        <section className="how-section">
          <div className="section-heading"><span>训练方法</span><h2>你得到的不只是一张分数表</h2><p>一次有效训练，必须在反馈之后再讲一遍。</p></div>
          <div className="method-grid">
            {[
              ['01', '限时学习', '从三张资料卡里，找到结论、数字和真正的分歧。'],
              ['02', '脱稿表达', '面向明确听众，用三分钟把观点和依据讲完整。'],
              ['03', '有据反馈', '建议尽量对应讲稿片段、可观察指标和一个具体动作。'],
              ['04', '立即重讲', '看完三条建议，只练最重要的一条，再比较前后变化。'],
            ].map(([number, title, body]) => <article className="method-card" key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}
          </div>
        </section>
      </>
    );
  };

  const renderTopics = () => (
    <section className="page-section topics-page">
      <div className="section-heading wide"><span>模拟题库 · 6 题</span><h1>今天想练哪一种表达？</h1><p>每道题都包含明确听众、任务和三张模拟资料卡，方便稳定比较两次表现。</p></div>
      <div className="topic-grid">
        {TOPICS.map((item, index) => (
          <article className="topic-card" key={item.id}>
            <div className="topic-card-top"><span>{item.category}</span><em>{item.difficulty}</em></div>
            <h2>{item.title}</h2>
            <p>面向：{item.audience}</p>
            <div className="topic-card-meta"><span>{item.prepMinutes} 分钟准备</span><span>3 分钟演说</span></div>
            <button type="button" onClick={() => startTraining(index)}>选择这道题 <span>→</span></button>
          </article>
        ))}
      </div>
      <div className="simulation-note"><strong>为什么使用模拟资料？</strong><p>首版只评价题内关键点覆盖，不判断陈述真假，也不声称完成开放网络事实核查。这样能减少无依据的判断。</p></div>
    </section>
  );

  const renderPrepare = () => (
    <section className="training-page">
      <TrainingStepper current={1} />
      <div className="training-heading">
        <div><span className="section-kicker">第 1 步 · 限时学习</span><h1>{topic.title}</h1><p><strong>你的听众：</strong>{topic.audience}　·　<strong>你的任务：</strong>{topic.task}</p></div>
        <div className={`timer-card ${prepExpired ? 'expired' : ''}`} aria-label={`准备时间剩余 ${formatTime(prepRemaining)}`}>
          <span>{prepExpired ? '准备时间到' : '准备剩余'}</span><time>{formatTime(prepRemaining)}</time><small>{prepExpired ? '整理一句结论，随时进入演说' : '你可以提前结束准备'}</small>
        </div>
      </div>
      <div className={`mobile-prep-timer ${prepExpired ? 'expired' : ''}`} aria-hidden="true"><span>{prepExpired ? '时间到' : '准备'}</span><time>{formatTime(prepRemaining)}</time></div>
      <div className="prepare-grid">
        <div className="source-column">
          <div className="column-title"><h2>模拟资料</h2><span>仅用于本次训练</span></div>
          {topic.sources.map((source, index) => (
            <article className="source-card" key={source.title}>
              <div><span>资料 {index + 1}</span><em>{source.label}</em></div><h3>{source.title}</h3><p>{source.body}</p>
            </article>
          ))}
        </div>
        <aside className="notes-panel">
          <div className="column-title"><h2>我的提纲</h2><span>{notes.length} 字</span></div>
          <p className="coach-tip"><span>提示</span>先确定结论，再找两条依据。只记关键词，不必写完整讲稿。</p>
          <label className="visually-hidden" htmlFor="notes">演说提纲</label>
          <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={'一句结论：\n\n依据 1：\n\n依据 2：\n\n需要回应的风险：\n\n最后一句：'} />
          <button className="primary-action full" type="button" onClick={enterSpeaking}>我准备好了，进入演说 <span>→</span></button>
          <button className="quiet-action" type="button" onClick={() => goTo('topics')}>返回题库</button>
        </aside>
      </div>
    </section>
  );

  const renderSpeak = () => {
    const active = recorderStatus === 'recording' || recorderStatus === 'paused';
    const finished = recorderStatus === 'stopped' || recorderStatus === 'manual' || recorderStatus === 'error';
    return (
      <section className="training-page speak-page">
        <TrainingStepper current={attempts.length ? 4 : 2} />
        <div className="speaking-head">
          <div><span className="section-kicker">{attempts.length ? '第 4 步 · 带着反馈重讲' : '第 2 步 · 完成演说'}</span><h1>{attempts.length ? '第二遍，只改最重要的一处。' : '看着听众说，不必一字不差。'}</h1><p>{topic.title}</p></div>
          <div className="target-badge"><span>建议时长</span><strong>{formatTime(topic.speechSeconds)}</strong></div>
        </div>
        <Notices error={errorMessage} info={storageMessage} onDismiss={() => setStorageMessage('')} />
        <div className="speak-grid">
          <article className={`recorder-panel ${active ? 'is-recording' : ''}`}>
            <div className="recorder-status" aria-live="polite">
              <span className="record-dot" />
              {recorderStatus === 'requesting' ? '正在请求麦克风权限'
                : recorderStatus === 'recording' ? '正在录音'
                  : recorderStatus === 'paused' ? '录音已暂停'
                    : recorderStatus === 'stopped' ? '录音已完成'
                      : recorderStatus === 'manual' ? '文本演练模式'
                        : recorderStatus === 'error' ? '录音不可用'
                          : '准备录音'}
            </div>
            <div className="record-clock">{formatTime(recordSeconds)}</div>
            <div className="wave" aria-hidden="true">{Array.from({ length: 29 }).map((_, index) => <i key={index} style={{ '--bar': `${18 + ((index * 17) % 46)}px`, '--delay': `${(index % 9) * -0.11}s` } as React.CSSProperties} />)}</div>
            {!active && recorderStatus !== 'stopped' && (
              <>
                <p className="record-intro"><strong>训练反馈依据文字稿。</strong>录音用于回听；如果不启用自动转写，录完后需要手动补充讲稿。点击后才会请求麦克风权限。</p>
                <label className={`transcript-toggle ${!recognitionSupported ? 'disabled' : ''}`}>
                  <input type="checkbox" checked={autoTranscript} disabled={!recognitionSupported} onChange={(event) => setAutoTranscript(event.target.checked)} />
                  <span><b>同时尝试浏览器自动转写</b><small>{recognitionSupported ? '可能由浏览器服务商在线处理语音；默认关闭' : '当前浏览器不支持，可在录音后手动输入'}</small></span>
                </label>
                <label className="save-toggle">
                  <input type="checkbox" checked={saveRecordingLocally} onChange={(event) => setSaveRecordingLocally(event.target.checked)} />
                  <span>生成反馈后，把录音保存在这台设备</span>
                </label>
                <button className="record-button" type="button" onClick={startRecording} disabled={recorderStatus === 'requesting'}><span aria-hidden="true">●</span>{recorderStatus === 'requesting' ? '正在连接麦克风…' : '开始演说'}</button>
                <button className="quiet-action" type="button" onClick={chooseManualMode}>文本演练（不录音，只评价讲稿）</button>
              </>
            )}
            {active && (
              <div className="record-controls">
                <button type="button" onClick={recorderStatus === 'paused' ? resumeRecording : pauseRecording}>{recorderStatus === 'paused' ? '继续录音' : '暂停'}</button>
                <button className="stop" type="button" onClick={finishRecording}>完成演说</button>
              </div>
            )}
            {recorderStatus === 'stopped' && audioUrl && <audio className="audio-player" aria-label={`${attempts.length ? '第二遍' : '第一遍'}录音回听`} controls src={audioUrl}>你的浏览器不支持音频播放。</audio>}
            {finished && recorderStatus !== 'manual' && <button className="quiet-action" type="button" onClick={resetAttemptInput}>删除并重新录制</button>}
          </article>
          <aside className="prompt-panel">
            <div><span className="section-kicker">你的听众</span><strong>{topic.audience}</strong></div>
            <div><span className="section-kicker">你的任务</span><p>{topic.task}</p></div>
            <div className="note-reminder"><span className="section-kicker">提纲</span><p>{notes.trim() || '你没有记录提纲。开头先说结论，再给两条依据。'}</p></div>
            {attempts[0]?.score.feedback?.[0] && <div className="focus-reminder"><span>本遍只练这一件事</span><strong>{attempts[0].score.feedback[0].title}</strong><p>{attempts[0].score.feedback[0].drill}</p></div>}
          </aside>
        </div>

        {(finished || transcript || interimTranscript) && (
          <section className="transcript-editor">
            <div className="column-title"><div><h2>{transcript ? '确认讲稿' : '补充讲稿并分析'}</h2><p>{transcript ? '自动转写可能有误，请在生成反馈前校正。' : '当前没有可用转写，请根据刚才的表达补充主要内容。'}</p></div><span>{transcriptSource === 'browser' ? '浏览器转写' : transcriptSource === 'edited' ? '已人工修订' : recorderStatus === 'manual' ? '文本演练' : '手动输入'}</span></div>
            {recorderStatus === 'stopped' && !transcript && <div className="transcript-required"><strong>录音已经完成，但反馈还需要文字稿。</strong><span>请补充主要内容并分析，或者删除这段录音后重新开始。</span></div>}
            {transcriptionInterrupted && <div className="transcript-required warning"><strong>自动转写可能不完整。</strong><span>录音过程中转写曾中断，请先对照回听并补齐后半段。</span></div>}
            {interimTranscript && <p className="interim">正在识别：{interimTranscript}</p>}
            <label className="visually-hidden" htmlFor="transcript">演说讲稿</label>
            <textarea id="transcript" value={transcript} onChange={(event) => { const next = event.target.value; setTranscript(next); finalTranscriptRef.current = next; setTranscriptSource((current) => current === 'browser' || current === 'edited' ? 'edited' : 'manual'); if (demoMode) setDemoMode(false); }} placeholder="在这里粘贴或输入你刚才的演说内容。讲稿不会上传到本站服务器。" />
            <div className="editor-actions"><button className="quiet-action inline" type="button" onClick={loadExample}>预览示例反馈（不计入记录）</button><button className="primary-action compact" type="button" onClick={analyze} disabled={isAnalyzing}>{isAnalyzing ? '正在分析…' : attempts.length ? '生成前后对比' : '生成训练反馈'} <span>→</span></button></div>
          </section>
        )}
      </section>
    );
  };

  const renderReport = () => {
    const attempt = attempts.at(-1);
    if (!attempt) return null;
    const { score } = attempt;
    return (
      <section className="training-page report-page">
        <TrainingStepper current={3} />
        <Notices error={errorMessage} info={storageMessage} onDismiss={() => setStorageMessage('')} />
        <div className="report-hero">
          <div className="score-ring" style={{ '--score': `${score.total * 3.6}deg` } as React.CSSProperties}><div><strong>{score.total}</strong><span>规则量表估算</span></div></div>
          <div className="report-summary"><span className="section-kicker">第 3 步 · 查看反馈</span><h1>{attempt.isDemo ? '这是一份示例反馈。' : '这次，你已经讲清了什么？'}</h1><p>整体处于“{score.level}”阶段。本次主要依据关键点、结构信号、资料线索和文本长度；不会判断事实真假，也没有分析音量、语调或眼神。无法判断的维度会从总分计算中排除。</p><div className="confidence-row"><span>{score.confidence}</span><span>{score.rubricVersion}</span><span>{attempt.transcriptSource === 'browser' ? '浏览器转写' : attempt.transcriptSource === 'edited' ? '人工修订稿' : '手动讲稿'}</span></div></div>
        </div>

        <div className="report-layout">
          <section className="dimension-card">
            <div className="column-title"><h2>本次可评维度</h2><span>缺少数据时不打分</span></div>
            {score.dimensions.map((dimension) => <div className={`dimension-row ${dimension.available ? '' : 'unavailable'}`} key={dimension.key}><div><strong>{dimension.label}</strong><span>{dimension.weight}%</span></div><i><b className={dimensionTone[dimension.key]} style={{ width: dimension.available ? `${dimension.score}%` : '0%' }} /></i><em>{dimension.available ? dimension.score : '—'}</em><p>{dimension.summary}</p></div>)}
          </section>
          <aside className="metric-card">
            <div className="column-title"><h2>文本与时长指标</h2><span>{score.metrics.durationEstimated ? '没有有效录音时长' : '时长来自本次录音'}</span></div>
            <div className="metrics-grid">
              <div><strong>{score.metrics.durationEstimated ? '—' : formatTime(score.metrics.durationSeconds)}</strong><span>{score.metrics.durationEstimated ? '未记录实际时长' : '演说时长'}</span></div>
              <div><strong>{score.metrics.pace ?? '—'}</strong><span>{score.metrics.pace === null ? '语速无法判断' : '字词／分钟'}</span></div>
              <div><strong>{score.metrics.fillerCount ?? '—'}</strong><span>{score.metrics.fillerCount === null ? '口头禅无法判断' : '转写中的口头禅'}</span></div>
              <div><strong>{score.metrics.keywordCoverage}%</strong><span>题内关键点覆盖</span></div>
            </div>
            {audioUrl ? <audio className="audio-player" aria-label={`${attempts.length > 1 ? '第二遍' : '第一遍'}录音`} controls src={audioUrl} />
              : attempt.audioStored && (playbackId === attempt.id && playbackUrl
                ? <audio className="audio-player" aria-label="本次训练录音" controls src={playbackUrl} />
                : <button className="quiet-action bordered" type="button" onClick={() => loadPlayback(attempt.id)}>加载本地录音</button>)}
          </aside>
        </div>

        {score.strengths.length > 0 && <section className="strength-section"><div className="section-heading left"><span>相对较完整的部分</span><h2>这两处可以继续保留</h2></div><div className="strength-grid">{score.strengths.map((strength) => <article key={strength.title}><span>✓</span><h3>{strength.title}</h3><p>{strength.detail}</p><blockquote>“{strength.quote}”</blockquote></article>)}</div></section>}

        <section className="feedback-section"><div className="section-heading left"><span>先改这 3 处</span><h2>下一遍，动作要足够具体</h2><p>反馈按内容、结构和表达的训练价值排序。</p></div><div className="feedback-grid">{score.feedback.map((item, index) => <article className="feedback-card" key={item.title}><div className="feedback-number">0{index + 1}</div><h3>{item.title}</h3><dl><dt>你当时说</dt><dd className="quote">“{item.quote}”</dd><dt>听众可能会困惑</dt><dd>{item.observation}</dd><dt>可以这样改</dt><dd>{item.action}</dd></dl><div className="micro-drill"><span>练习 30 秒</span><p>{item.drill}</p></div></article>)}</div></section>

        {attempt.isDemo ? <div className="retry-banner"><div><span className="section-kicker">示例预览完成</span><h2>现在，用你自己的表达试一次。</h2><p>示例稿没有进入历史，也不会影响成长数据。</p></div><button className="primary-action light" type="button" onClick={() => startTraining(topicIndex)}>开始真实训练 <span>→</span></button></div>
          : <><div className="retry-banner"><div><span className="section-kicker">现在是进步真正发生的地方</span><h2>看完三条，这一遍只练第一条。</h2><p>题目和资料不变，聚焦最重要的训练动作。</p></div><button className="primary-action light" type="button" onClick={repeatSpeech}>开始第二遍 <span>→</span></button></div><div className="center-actions"><button className="quiet-action" type="button" onClick={() => goTo('home')}>暂时完成，保存记录</button></div></>}
      </section>
    );
  };

  const renderCompare = () => {
    const first = attempts[0];
    const latest = attempts.at(-1);
    if (!first || !latest) return null;
    const sameRubric = first.score.rubricVersion === latest.score.rubricVersion;
    const sameTopicVersion = first.topicVersion === latest.topicVersion && first.targetSeconds === latest.targetSeconds;
    const sameInputBasis = first.transcriptSource === latest.transcriptSource
      && first.score.metrics.durationEstimated === latest.score.metrics.durationEstimated;
    const comparable = sameRubric && sameTopicVersion && sameInputBasis;
    const delta = latest.score.total - first.score.total;
    const comparableDimensions = sameRubric && sameTopicVersion ? latest.score.dimensions.filter((dimension) => {
      const before = first.score.dimensions.find((item) => item.key === dimension.key);
      return dimension.available && before?.available;
    }) : [];
    return (
      <section className="training-page compare-page">
        <TrainingStepper current={4} />
        <Notices error={errorMessage} info={storageMessage} onDismiss={() => setStorageMessage('')} />
        <div className="compare-hero"><span className="celebration-mark" aria-hidden="true">↗</span><div><span className="section-kicker">训练闭环完成</span><h1>{comparable && delta > 0 ? '第二遍，更清楚了。' : comparable ? '你找到了下一步。' : '两遍的数据基础不同。'}</h1><p>{comparable ? delta > 0 ? `规则量表估算提高 ${delta} 分，更重要的是你把反馈真正用进了表达。` : '分数没有明显上升也没关系，下面的维度变化会告诉你下一次只练什么。' : '一遍使用了浏览器转写，另一遍经过手动输入或修订，因此变化只作提示，不能直接归因于演说提升。'}</p></div><div className={`delta-score ${comparable && delta >= 0 ? 'positive' : ''}`}><span>总分变化</span><strong>{comparable ? `${delta > 0 ? '+' : ''}${delta}` : '—'}</strong><small>{first.score.total} → {latest.score.total}</small></div></div>
        {!comparable && <div className="compare-warning" role="note">第一遍：{first.transcriptSource === 'browser' ? '浏览器转写' : first.transcriptSource === 'edited' ? '人工修订稿' : '手动讲稿'}；第二遍：{latest.transcriptSource === 'browser' ? '浏览器转写' : latest.transcriptSource === 'edited' ? '人工修订稿' : '手动讲稿'}。以下只比较两遍都能观察到的维度。</div>}
        <section className="compare-card"><div className="column-title"><h2>可比维度变化</h2><span>{sameRubric && sameTopicVersion ? '相同题目 · 同量表' : '题目或量表版本不同，不比较总分'}</span></div>{comparableDimensions.map((dimension) => { const before = first.score.dimensions.find((item) => item.key === dimension.key)?.score ?? 0; const change = dimension.score - before; return <div className="compare-row" aria-label={`${dimension.label}从 ${before} 分变为 ${dimension.score} 分，变化 ${change > 0 ? '增加' : change < 0 ? '减少' : '不变'} ${Math.abs(change)} 分`} key={dimension.key}><strong>{dimension.label}</strong><div className="double-bar"><i><b style={{ width: `${before}%` }} /></i><i><b className="after" style={{ width: `${dimension.score}%` }} /></i></div><span>{before} → {dimension.score}</span><em className={change > 0 ? 'up' : change < 0 ? 'down' : ''}>{change > 0 ? '+' : ''}{change}</em></div>;})}<div className="compare-legend"><span><i />第一遍</span><span><i className="after" />第二遍</span></div></section>
        <div className="change-grid"><article><span>语速</span><strong>{first.score.metrics.pace ?? '—'} → {latest.score.metrics.pace ?? '—'}</strong><p>{first.score.metrics.pace === null || latest.score.metrics.pace === null ? '转写基础不同，无法比较' : '字词／分钟'}</p></article><article><span>口头禅</span><strong>{first.score.metrics.fillerCount ?? '—'} → {latest.score.metrics.fillerCount ?? '—'}</strong><p>{first.score.metrics.fillerCount !== null && latest.score.metrics.fillerCount !== null ? latest.score.metrics.fillerCount < first.score.metrics.fillerCount ? '减少了，很好' : '下一次可继续关注' : '当前数据无法判断'}</p></article><article><span>关键点覆盖</span><strong>{first.score.metrics.keywordCoverage}% → {latest.score.metrics.keywordCoverage}%</strong><p>相对本题资料</p></article><article><span>实际时长</span><strong>{first.score.metrics.durationEstimated ? '—' : formatTime(first.score.metrics.durationSeconds)} → {latest.score.metrics.durationEstimated ? '—' : formatTime(latest.score.metrics.durationSeconds)}</strong><p>目标 {formatTime(topic.speechSeconds)}</p></article></div>
        <section className="next-focus"><span className="section-kicker">下次只练一件事</span><h2>{latest.score.feedback[0]?.title}</h2><p>{latest.score.nextFocus}</p></section>
        <div className="completion-actions"><button className="primary-action" type="button" onClick={() => goTo('topics')}>再选一个题目 <span>→</span></button><button className="quiet-action bordered" type="button" onClick={() => goTo('progress')}>查看成长记录</button></div>
      </section>
    );
  };

  const renderProgress = () => (
    <section className="page-section progress-page">
      <Notices error={errorMessage} info={storageMessage} onDismiss={() => setStorageMessage('')} />
      <div className="section-heading wide"><span>仅保存在当前浏览器</span><h1>成长不是一个分数，<br />而是一连串可见的变化。</h1><p>跨题目的估算只作参考；同题、同量表、同输入方式的两次表现最值得比较。</p></div>
      <div className="dashboard-stats"><article><span>训练记录</span><strong>{history.length}</strong><p>每个题目算一次</p></article><article><span>完整闭环</span><strong>{completeLoops}</strong><p>完成反馈后重讲</p></article><article><span>累计开口</span><strong>{history.reduce((sum, item) => sum + item.attempts.length, 0)}</strong><p>所有录音或手动稿</p></article><article><span>近期参考分</span><strong>{averageScore || '—'}</strong><p>不同题目不作排名</p></article></div>
      <div className="history-heading"><div><span className="section-kicker">本机记录</span><h2>训练历史</h2></div><div><button type="button" onClick={exportData} disabled={!history.length}>导出文本与评分</button><button className="danger-link" type="button" onClick={clearEverything} disabled={!history.length}>清除全部</button></div></div>
      {history.length ? <div className="history-list">{history.map((record) => { const first = record.attempts[0]; const latest = record.attempts.at(-1); const comparable = attemptsComparable(first, latest); const delta = first && latest ? latest.score.total - first.score.total : 0; return <article key={record.id}><button className="history-main" type="button" onClick={() => openRecord(record)}><div className="history-date"><span>{formatDate(record.updatedAt)}</span><em>{record.attempts.length > 1 ? '已重讲' : '待重讲'}</em></div><h3>{record.topicTitle}</h3><p>面向：{record.audience}</p><div className="history-scores"><strong>{latest?.score.total ?? '—'}</strong><span>最近量表估算</span>{record.attempts.length > 1 && <em className={comparable && delta >= 0 ? 'up' : ''}>{comparable ? `${delta > 0 ? '+' : ''}${delta}` : '不可直比'}</em>}</div></button><button className="delete-record" type="button" onClick={() => deleteRecord(record)} aria-label={`删除训练：${record.topicTitle}`}>删除</button></article>;})}</div> : <div className="empty-state"><span aria-hidden="true">◌</span><h2>还没有训练记录</h2><p>完成一次演说后，讲稿、反馈和量表估算会保存在这台设备。</p><button className="primary-action" type="button" onClick={() => goTo('topics')}>选择第一道题 <span>→</span></button></div>}
      <div className="privacy-panel"><div><span className="section-kicker">本地优先</span><h2>默认只存当前浏览器，随时可以删除。</h2></div><ul><li>本站无需登录，不会把录音或讲稿上传到应用服务器。</li><li>文本与评分保存在浏览器本地；只有开启保存选项时，录音才会写入本地录音库。</li><li>如果主动开启浏览器自动转写，语音可能由浏览器服务商在线处理。</li><li>共享设备上的其他使用者可能看到本地记录，请按需要导出或清除。</li></ul></div>
    </section>
  );

  return (
    <div className="app-shell">
      <AppHeader screen={screen} onNavigate={goTo} />
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {screen === 'home' && renderHome()}
        {screen === 'topics' && renderTopics()}
        {screen === 'progress' && renderProgress()}
        {screen === 'prepare' && renderPrepare()}
        {screen === 'speak' && renderSpeak()}
        {screen === 'report' && renderReport()}
        {screen === 'compare' && renderCompare()}
      </main>
      <footer className="site-footer"><div className="brand-small"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><strong>讲清楚</strong></div><p>把刚学会的，讲成别人听得懂的。</p><span>训练反馈仅供个人练习参考</span></footer>
    </div>
  );
}
