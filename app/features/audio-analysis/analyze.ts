import type { AcousticAnalysis, AcousticMetric, TranscriptWord } from '../../lib/schemas/audio';

const FRAME_SECONDS = 0.02;
const SILENCE_SECONDS = 0.35;

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function metric(
  id: string,
  label: string,
  value: number | null,
  unit: string,
  available: boolean,
  confidence: AcousticMetric['confidence'],
  limitation: string,
): AcousticMetric {
  return { id, label, value, unit, available, confidence, evidence: [], limitation };
}

function estimatePitch(frame: Float32Array, sampleRate: number) {
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / 70));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index < frame.length - lag; index += 1) {
      const a = frame[index];
      const b = frame[index + lag];
      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const normalized = correlation / Math.sqrt(Math.max(energyA * energyB, 1e-12));
    if (normalized > bestCorrelation) {
      bestCorrelation = normalized;
      bestLag = lag;
    }
  }
  return bestCorrelation >= 0.6 && bestLag ? sampleRate / bestLag : null;
}

export function analyzePcm(
  samples: Float32Array,
  sampleRate: number,
  words: TranscriptWord[] = [],
): AcousticAnalysis {
  const frameSize = Math.max(256, Math.round(sampleRate * FRAME_SECONDS));
  const rmsValues: number[] = [];
  const clippingFrames: number[] = [];
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const frame = samples.subarray(offset, Math.min(samples.length, offset + frameSize));
    let sum = 0;
    let clipped = 0;
    for (const value of frame) {
      sum += value * value;
      if (Math.abs(value) >= 0.985) clipped += 1;
    }
    rmsValues.push(Math.sqrt(sum / Math.max(frame.length, 1)));
    clippingFrames.push(clipped / Math.max(frame.length, 1));
  }

  const noiseFloor = percentile(rmsValues, 0.2);
  const speechPeak = percentile(rmsValues, 0.9);
  const threshold = Math.max(0.008, Math.min(0.06, noiseFloor * 2.8 + (speechPeak - noiseFloor) * 0.12));
  const voiced = rmsValues.map((value) => value >= threshold);
  const pauseRanges: Array<{ startSeconds: number; endSeconds: number }> = [];
  let silenceStart = -1;
  voiced.forEach((isVoiced, index) => {
    if (!isVoiced && silenceStart === -1) silenceStart = index;
    if ((isVoiced || index === voiced.length - 1) && silenceStart !== -1) {
      const endFrame = isVoiced ? index : index + 1;
      const startSeconds = silenceStart * FRAME_SECONDS;
      const endSeconds = Math.min(samples.length / sampleRate, endFrame * FRAME_SECONDS);
      if (endSeconds - startSeconds >= SILENCE_SECONDS && startSeconds > 0.08 && endSeconds < samples.length / sampleRate - 0.08) {
        pauseRanges.push({ startSeconds, endSeconds });
      }
      silenceStart = -1;
    }
  });

  const voicedCount = voiced.filter(Boolean).length;
  const voicedSeconds = voicedCount * FRAME_SECONDS;
  const durationSeconds = samples.length / sampleRate;
  const usable = durationSeconds >= 3 && voicedSeconds >= 1.5 && speechPeak >= 0.01;
  const quality = !usable ? 'insufficient' : noiseFloor > speechPeak * 0.55 ? 'limited' : 'usable';
  const voicedRms = rmsValues.filter((_, index) => voiced[index]);
  const dbValues = voicedRms.map((value) => 20 * Math.log10(Math.max(value, 1e-6)));
  const dynamicRange = percentile(dbValues, 0.9) - percentile(dbValues, 0.1);
  const clippingRatio = clippingFrames.reduce((sum, value) => sum + value, 0) / Math.max(clippingFrames.length, 1);

  const pitchValues: number[] = [];
  if (usable) {
    const pitchFrameSize = Math.max(1024, Math.round(sampleRate * 0.04));
    const pitchStep = Math.max(pitchFrameSize, Math.round(sampleRate * 0.08));
    for (let offset = 0; offset + pitchFrameSize <= samples.length; offset += pitchStep) {
      const rmsIndex = Math.min(rmsValues.length - 1, Math.floor((offset / sampleRate) / FRAME_SECONDS));
      if (!voiced[rmsIndex]) continue;
      const pitch = estimatePitch(samples.subarray(offset, offset + pitchFrameSize), sampleRate);
      if (pitch) pitchValues.push(pitch);
    }
  }

  const pauseDurations = pauseRanges.map((range) => range.endSeconds - range.startSeconds);
  const spokenWordCount = words.filter((word) => word.text.trim()).length;
  const articulationRate = spokenWordCount && voicedSeconds > 0 ? (spokenWordCount / voicedSeconds) * 60 : null;
  const warnings: string[] = [];
  if (!usable) warnings.push('录音过短、过轻或有效发声不足，部分声音指标不可用。');
  if (quality === 'limited') warnings.push('背景噪声接近说话音量，停顿和音量变化只能作有限参考。');
  if (clippingRatio > 0.01) warnings.push('录音存在削波，音量和音高分析可能失真。');

  const limitation = '受麦克风、房间噪声、压缩和个人声线影响，仅用于同设备训练参考。';
  const pitchAvailable = quality === 'usable' && pitchValues.length >= 6;
  const metrics = [
    metric('voiced-duration', '有效发声时长', usable ? voicedSeconds : null, '秒', usable, quality === 'usable' ? 'high' : 'low', limitation),
    metric('pause-count', '明显停顿次数', usable ? pauseRanges.length : null, '次', usable, quality === 'usable' ? 'high' : 'medium', limitation),
    metric('average-pause', '平均停顿', pauseDurations.length ? pauseDurations.reduce((sum, value) => sum + value, 0) / pauseDurations.length : null, '秒', usable && pauseDurations.length > 0, quality === 'usable' ? 'high' : 'medium', limitation),
    metric('longest-pause', '最长停顿', pauseDurations.length ? Math.max(...pauseDurations) : null, '秒', usable && pauseDurations.length > 0, quality === 'usable' ? 'high' : 'medium', limitation),
    metric('volume-dynamics', '音量动态范围', usable ? dynamicRange : null, 'dB', usable, quality === 'usable' ? 'medium' : 'low', limitation),
    metric('clipping-ratio', '削波比例', clippingRatio * 100, '%', durationSeconds > 0, 'high', limitation),
    metric('pitch-median', '音高中位数', pitchAvailable ? percentile(pitchValues, 0.5) : null, 'Hz', pitchAvailable, 'medium', limitation),
    metric('pitch-range', '音高变化范围', pitchAvailable ? percentile(pitchValues, 0.9) - percentile(pitchValues, 0.1) : null, 'Hz', pitchAvailable, 'medium', limitation),
    metric('articulation-rate', '发音段速度', articulationRate, '字词/分钟', articulationRate !== null, words.length >= 8 ? 'medium' : 'low', '依赖本地转写时间戳，转写错误会影响结果。'),
  ];

  return {
    schemaVersion: 1,
    durationSeconds,
    sampleRate,
    quality,
    metrics,
    pauseRanges,
    warnings,
    createdAt: new Date().toISOString(),
  };
}
