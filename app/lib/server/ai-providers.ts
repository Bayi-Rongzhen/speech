import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import type { z } from 'zod';
import { AiCoachingResultSchema } from '../schemas/coaching';
import type { ProviderConnection } from '../schemas/ai-provider';
import { assertSafeProviderUrl, buildProviderHeaders, createRelayFetch, RelayError } from './ai-relay';

const JSON_EXAMPLE = JSON.stringify({
  schemaVersion: 1,
  overallSummary: '...',
  dimensions: [],
  strengths: [],
  improvements: [],
  nextFocus: '...',
  limitations: ['...'],
});

function createOpenAiClient(provider: ProviderConnection, timeout: number) {
  return new OpenAI({
    apiKey: provider.apiKey,
    baseURL: assertSafeProviderUrl(provider.baseUrl).toString().replace(/\/$/, ''),
    defaultHeaders: buildProviderHeaders(provider),
    fetch: createRelayFetch(),
    maxRetries: 0,
    timeout,
  });
}

function createAnthropicClient(provider: ProviderConnection, timeout: number) {
  return new Anthropic({
    apiKey: provider.apiKey,
    baseURL: assertSafeProviderUrl(provider.baseUrl).toString().replace(/\/$/, ''),
    defaultHeaders: buildProviderHeaders(provider),
    fetch: createRelayFetch(),
    maxRetries: 0,
    timeout,
  });
}

function parseJsonOutput(content: string | null) {
  if (!content) throw new RelayError('invalid_output', '服务商没有返回可用内容。', 502, true);
  try {
    return AiCoachingResultSchema.parse(JSON.parse(content));
  } catch {
    throw new RelayError('invalid_output', '服务商返回的结构化反馈无法验证。', 502, true);
  }
}

export async function testProviderConnection(provider: ProviderConnection, signal: AbortSignal) {
  if (provider.kind === 'deepseek' || provider.kind === 'openai-compatible') {
    const response = await createOpenAiClient(provider, 12_000).chat.completions.create({
      model: provider.model,
      max_tokens: 32,
      messages: [{ role: 'user', content: '只回复 OK' }],
      stream: false,
    }, { signal });
    if (!response.choices[0]?.message) throw new RelayError('provider_rejected', '服务商没有返回有效响应。', 502);
    return;
  }
  const response = await createAnthropicClient(provider, 12_000).messages.create({
    model: provider.model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply only OK' }],
  }, { signal });
  if (!response.content.length) throw new RelayError('provider_rejected', '服务商没有返回有效响应。', 502);
}

export async function scoreWithProvider(
  provider: ProviderConnection,
  systemPrompt: string,
  requestPayload: string,
  signal: AbortSignal,
): Promise<{ result: z.infer<typeof AiCoachingResultSchema>; model: string }> {
  if (provider.kind === 'anthropic') {
    const response = await createAnthropicClient(provider, 85_000).beta.messages.parse({
      model: provider.model,
      max_tokens: 9000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(AiCoachingResultSchema) },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemPrompt,
      messages: [{ role: 'user', content: requestPayload }],
    }, { signal });
    if (response.stop_reason === 'refusal') throw new RelayError('provider_rejected', '服务商拒绝了本次分析。', 422);
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new RelayError('invalid_output', '反馈未完整生成。', 502, true);
    return { result: response.parsed_output, model: provider.model };
  }

  if (provider.kind === 'anthropic-compatible') {
    const response = await createAnthropicClient(provider, 85_000).messages.create({
      model: provider.model,
      max_tokens: 9000,
      system: `${systemPrompt}\n必须只返回一个 json 对象，字段结构示例：${JSON_EXAMPLE}`,
      messages: [{ role: 'user', content: requestPayload }],
    }, { signal });
    const content = response.content.find((block) => block.type === 'text')?.text ?? null;
    return { result: parseJsonOutput(content), model: provider.model };
  }

  const request = {
    model: provider.model,
    max_tokens: 9000,
    messages: [
      { role: 'system' as const, content: `${systemPrompt}\n必须返回一个 json 对象，字段结构示例：${JSON_EXAMPLE}` },
      { role: 'user' as const, content: requestPayload },
    ],
    stream: false as const,
  };
  try {
    const response = await createOpenAiClient(provider, 85_000).chat.completions.create({
      ...request,
      response_format: { type: 'json_object' },
    }, { signal });
    return { result: parseJsonOutput(response.choices[0]?.message.content ?? null), model: provider.model };
  } catch (error) {
    if (provider.kind !== 'openai-compatible' || !(error instanceof OpenAI.BadRequestError)) throw error;
    const response = await createOpenAiClient(provider, 85_000).chat.completions.create(request, { signal });
    return { result: parseJsonOutput(response.choices[0]?.message.content ?? null), model: provider.model };
  }
}

export function normalizeProviderError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  if (error instanceof OpenAI.AuthenticationError || error instanceof Anthropic.AuthenticationError) return new RelayError('authentication_failed', 'API Key 无效或未被服务商接受。', 401);
  if (error instanceof OpenAI.PermissionDeniedError || error instanceof Anthropic.PermissionDeniedError) return new RelayError('permission_denied', 'API Key 没有访问该模型的权限。', 403);
  if (error instanceof OpenAI.NotFoundError || error instanceof Anthropic.NotFoundError) return new RelayError('model_not_found', 'API 地址或模型不存在。', 404);
  if (error instanceof OpenAI.RateLimitError || error instanceof Anthropic.RateLimitError) return new RelayError('rate_limited', '服务商当前限流，请稍后重试。', 429, true);
  if (error instanceof OpenAI.BadRequestError || error instanceof Anthropic.BadRequestError) return new RelayError('provider_rejected', '服务商不支持当前模型或请求格式。', 422);
  if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionTimeoutError || (error instanceof DOMException && error.name === 'AbortError')) return new RelayError('timeout', '连接服务商超时。', 504, true);
  if (error instanceof OpenAI.APIConnectionError || error instanceof Anthropic.APIConnectionError) return new RelayError('provider_unavailable', '无法连接到服务商。', 503, true);
  return new RelayError('provider_unavailable', '服务商暂时无法使用。', 503, true);
}
