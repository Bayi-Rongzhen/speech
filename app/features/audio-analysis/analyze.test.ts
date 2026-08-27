import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePcm } from './analyze.ts';

function makeSignal(seconds: number, sampleRate = 16000) {
  const samples = new Float32Array(seconds * sampleRate);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const speaking = (time >= 0.2 && time < 1.2) || (time >= 1.8 && time < 2.8);
    samples[index] = speaking ? Math.sin(2 * Math.PI * 180 * time) * 0.18 : 0;
  }
  return samples;
}

test('声音分析识别中间明显停顿', () => {
  const result = analyzePcm(makeSignal(3), 16000);
  assert.equal(result.quality, 'usable');
  assert.ok(result.pauseRanges.some((range) => range.startSeconds <= 1.3 && range.endSeconds >= 1.7));
  assert.ok(result.metrics.find((metric) => metric.id === 'pause-count')?.available);
});

test('静音录音不会伪造声音指标', () => {
  const result = analyzePcm(new Float32Array(16000 * 4), 16000);
  assert.equal(result.quality, 'insufficient');
  assert.equal(result.metrics.find((metric) => metric.id === 'pitch-range')?.available, false);
});
