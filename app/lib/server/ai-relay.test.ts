import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeProviderUrl, buildProviderHeaders, isPrivateOrReservedAddress } from './ai-relay.ts';

for (const url of [
  'http://relay.example.com',
  'https://localhost/v1',
  'https://127.0.0.1/v1',
  'https://8.8.8.8/v1',
  'https://10.0.0.1/v1',
  'https://[::1]/v1',
  'https://service.internal/v1',
  'https://user:pass@relay.example.com/v1',
  'https://relay.example.com:8443/v1',
  'https://relay.example.com/v1?target=x',
]) {
  test(`拒绝危险 API 地址 ${url}`, () => {
    assert.throws(() => assertSafeProviderUrl(url));
  });
}

test('接受公开 HTTPS 中转地址并移除尾部斜杠', () => {
  assert.equal(assertSafeProviderUrl('https://relay.example.com/v1/').toString(), 'https://relay.example.com/v1');
});

test('只构造允许的可选请求头', () => {
  const headers = buildProviderHeaders({
    kind: 'openai-compatible',
    baseUrl: 'https://relay.example.com/v1',
    model: 'model',
    apiKey: 'sk-valid-example',
    optionalHeaders: [{ name: 'X-Title', value: '讲清楚' }],
  });
  assert.deepEqual(headers, { 'X-Title': '讲清楚' });
});

for (const address of [
  '127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.1.1',
  '0.0.0.0', '100.64.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
  '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1',
]) {
  test(`识别为私有或保留地址：${address}`, () => {
    assert.equal(isPrivateOrReservedAddress(address), true);
  });
}

for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
  test(`识别为公开地址：${address}`, () => {
    assert.equal(isPrivateOrReservedAddress(address), false);
  });
}
