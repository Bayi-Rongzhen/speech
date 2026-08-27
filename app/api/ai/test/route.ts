import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ProviderTestRequestSchema } from '../../../lib/schemas/ai-provider';
import { normalizeProviderError, testProviderConnection } from '../../../lib/server/ai-providers';
import { noStoreHeaders, relayErrorResponse, RelayError, requireSameOrigin } from '../../../lib/server/ai-relay';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { provider } = ProviderTestRequestSchema.parse(await request.json());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      await testProviderConnection(provider, controller.signal);
      return NextResponse.json({
        ok: true,
        provider: { kind: provider.kind, model: provider.model },
      }, { headers: noStoreHeaders() });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof z.ZodError) return relayErrorResponse(new RelayError('invalid_request', '服务商配置不完整或无效。', 400));
    return relayErrorResponse(normalizeProviderError(error));
  }
}
