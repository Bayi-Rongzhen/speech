import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDER_PRESETS, ProviderConnectionSchema } from './ai-provider.ts';

const base = {
  kind: 'deepseek' as const,
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  apiKey: 'sk-valid-example',
  optionalHeaders: [],
};

test('官方服务地址必须使用固定预设', () => {
  assert.equal(ProviderConnectionSchema.safeParse(base).success, true);
  assert.equal(ProviderConnectionSchema.safeParse({ ...base, baseUrl: 'https://relay.example.com' }).success, false);
});

test('中转站允许自定义 HTTPS 地址和模型', () => {
  const result = ProviderConnectionSchema.safeParse({
    ...base,
    kind: 'openai-compatible',
    baseUrl: 'https://relay.example.com/v1',
    model: 'custom-model',
  });
  assert.equal(result.success, true);
});

test('可选请求头不能重复', () => {
  const result = ProviderConnectionSchema.safeParse({
    ...base,
    optionalHeaders: [
      { name: 'X-Title', value: 'A' },
      { name: 'X-Title', value: 'B' },
    ],
  });
  assert.equal(result.success, false);
});
