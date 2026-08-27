import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { TopicSnapshotSchema, type TopicSnapshot } from '../schemas/topic';
import { CLAUDE_MODEL, getAnthropicClient } from './anthropic';

const TopicIdeaSchema = z.object({ query: z.string().min(4).max(200) });

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

async function findSources(query: string) {
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

export async function ideateTopicQuery(options: { categoryHint?: string; focusHint?: string; excludeTitles: string[] }): Promise<string> {
  const { categoryHint, focusHint, excludeTitles } = options;
  const instructions = [
    '你负责为中文演说训练想一个新的辩论式议题短语，仅用于后续公开资料研究，不是完整题目文案。',
    '要求：',
    '- 议题必须存在真实、合理的双方分歧，能在限时准备后完成 2-3 分钟表态类演说。',
    '- 避免与已练习过的题目重复或高度相似。',
    '- 优先贴近校园、职场、公共政策、科技伦理、社区生活等场景。',
  ];
  if (categoryHint) instructions.push(`- 本次优先考虑“${categoryHint}”相关的场景。`);
  if (focusHint) {
    instructions.push(`- 优先选择特别考验“${focusHint}”这项能力的议题：内容理解→需要综合多方资料；结构逻辑→存在三个以上互相牵制的因素；论据运用→资料中应有丰富、可引用的数字或研究；清晰适配→听众身份或专业背景较特殊；与口头表达、时间控制无关时可忽略此项。`);
  }
  instructions.push('只返回一个简短的议题短语，不要展开论述或加引号。');
  const response = await getAnthropicClient().messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    output_config: { effort: 'low', format: zodOutputFormat(TopicIdeaSchema) },
    system: instructions.join('\n'),
    messages: [{
      role: 'user',
      content: excludeTitles.length ? `已经练习过的题目，请避免重复：\n${excludeTitles.map((title) => `- ${title}`).join('\n')}` : '还没有练习过任何题目。',
    }],
  });
  if (!response.parsed_output) throw new Error('ideation_failed');
  return response.parsed_output.query;
}

export async function synthesizeTopicFromQuery(query: string): Promise<TopicSnapshot> {
  const sources = await findSources(query);
  if (sources.length < 2) throw new Error('insufficient_sources');
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
  return TopicSnapshotSchema.parse({
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
}
