import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ideateTopicQuery, synthesizeTopicFromQuery } from '../../../lib/server/topic-research';

const RequestSchema = z.object({
  excludeTitles: z.array(z.string().min(1).max(240)).max(40).default([]),
  categoryHint: z.string().min(1).max(40).optional(),
  focusHint: z.string().min(1).max(40).optional(),
});

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '请求来源不受信任。' }, { status: 403 });
  if (process.env.ENABLE_PUBLIC_RESEARCH !== 'true') {
    return NextResponse.json({ error: '公开资料研究尚未在此部署启用。' }, { status: 503 });
  }
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: '请求格式不正确。' }, { status: 400 });
  }

  try {
    const query = await ideateTopicQuery(body);
    const topic = await synthesizeTopicFromQuery(query);
    return NextResponse.json({ topic });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: '研究服务当前繁忙，请稍后重试。' }, { status: 429 });
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return NextResponse.json({ error: '研究服务尚未配置。' }, { status: 503 });
    }
    if (error instanceof Error && error.message === 'insufficient_sources') {
      return NextResponse.json({ error: '没有找到足够多可引用的公开资料，请再试一次。' }, { status: 422 });
    }
    return NextResponse.json({ error: '暂时无法生成新题目。' }, { status: 502 });
  }
}
