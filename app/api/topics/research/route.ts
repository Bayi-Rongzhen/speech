import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TopicSnapshotSchema } from '../../../lib/schemas/topic';
import { CLAUDE_MODEL, getAnthropicClient } from '../../../lib/server/anthropic';

const RequestSchema = z.object({
  query: z.string().min(4).max(300),
});

const SynthesizedTopicSchema = TopicSnapshotSchema.omit({
  id: true,
  version: true,
  origin: true,
  sources: true,
  createdAt: true,
}).extend({
  sourceIds: z.array(z.string()).min(2).max(8),
});

type NormalizedSource = {
  id: string;
  url: string;
  title: string;
  citedText: string;
  retrievedAt: string;
};

async function research(query: string) {
  const client = getAnthropicClient();
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `围绕“${query}”寻找适合中文演说训练的可靠公开资料。至少覆盖两种不同立场或取舍，优先政府、大学、研究机构、主流媒体和原始报告。最后用简体中文概括主要分歧，并确保每个事实性结论都带网页搜索引用。`,
  }];
  let response: Anthropic.Message | null = null;
  for (let continuation = 0; continuation < 4; continuation += 1) {
    response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 12000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  if (!response || response.stop_reason === 'pause_turn') throw new Error('research_incomplete');
  if (response.stop_reason === 'refusal') throw new Error('research_refused');
  const sources = new Map<string, NormalizedSource>();
  for (const block of response.content) {
    if (block.type !== 'text' || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type !== 'web_search_result_location' || sources.has(citation.url)) continue;
      try {
        const url = new URL(citation.url);
        if (!['http:', 'https:'].includes(url.protocol)) continue;
      } catch {
        continue;
      }
      sources.set(citation.url, {
        id: `web-${sources.size + 1}`,
        url: citation.url,
        title: citation.title ?? new URL(citation.url).hostname,
        citedText: citation.cited_text.slice(0, 2500),
        retrievedAt: new Date().toISOString(),
      });
    }
  }
  return [...sources.values()].slice(0, 8);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: '请求来源不受信任。' }, { status: 403 });
  if (process.env.ENABLE_PUBLIC_RESEARCH !== 'true') {
    return NextResponse.json({ error: '公开资料研究尚未在此部署启用。' }, { status: 503 });
  }
  let query: string;
  try {
    query = RequestSchema.parse(await request.json()).query;
  } catch {
    return NextResponse.json({ error: '请输入更具体、长度适中的研究主题。' }, { status: 400 });
  }

  try {
    const sources = await research(query);
    if (sources.length < 2) return NextResponse.json({ error: '没有找到足够多可引用的公开资料。' }, { status: 422 });
    const synthesis = await getAnthropicClient().messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 7000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: zodOutputFormat(SynthesizedTopicSchema),
      },
      system: '你负责把已提供且带引用的公开资料整理成一项中文演说训练。不得引入未提供的事实。题目必须存在真实取舍，任务要求明确表态并提出可执行方案。keywordGroups 中每组是同一概念的常见同义表达。sourceIds 只能使用输入中已有 ID。',
      messages: [{ role: 'user', content: JSON.stringify({ query, sources }) }],
    });
    if (!synthesis.parsed_output) throw new Error('synthesis_invalid');
    const knownIds = new Set(sources.map((source) => source.id));
    if (synthesis.parsed_output.sourceIds.some((id) => !knownIds.has(id))) throw new Error('source_invalid');
    const selected = new Set(synthesis.parsed_output.sourceIds);
    const topic = TopicSnapshotSchema.parse({
      ...synthesis.parsed_output,
      id: `research-${crypto.randomUUID()}`,
      version: 1,
      origin: 'researched',
      sources: sources.filter((source) => selected.has(source.id)).map((source) => ({
        ...source,
        kind: 'web',
        status: 'retrieved',
        label: '公开网页',
        body: source.citedText,
        publisher: new URL(source.url).hostname,
      })),
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ topic });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: '研究服务当前繁忙，请稍后重试。' }, { status: 429 });
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return NextResponse.json({ error: '研究服务尚未配置。' }, { status: 503 });
    }
    return NextResponse.json({ error: '暂时无法完成公开资料研究。' }, { status: 502 });
  }
}
