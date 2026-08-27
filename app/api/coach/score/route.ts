import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCoachingEvidence } from '../../../lib/domain/coaching';
import { AcousticAnalysisSchema } from '../../../lib/schemas/audio';
import { ProviderConnectionSchema } from '../../../lib/schemas/ai-provider';
import { TopicSnapshotSchema } from '../../../lib/schemas/topic';
import { COACH_PROMPT_VERSION, COACH_RUBRIC_VERSION } from '../../../lib/server/anthropic';
import { normalizeProviderError, scoreWithProvider } from '../../../lib/server/ai-providers';
import { noStoreHeaders, relayErrorResponse, RelayError, requireSameOrigin } from '../../../lib/server/ai-relay';

const RequestSchema = z.object({
  consent: z.literal(true),
  provider: ProviderConnectionSchema,
  transcript: z.string().min(40).max(30000),
  topic: TopicSnapshotSchema,
  acoustic: AcousticAnalysisSchema.optional(),
});

const SYSTEM_PROMPT = `你是一名严谨的中文演说教练。你只根据给定讲稿、训练任务、资料摘录和聚合声音指标作判断，不臆测录音里没有提供的信息。

要求：
- 评价论点、结构、证据、资料忠实度、听众适配和说服力。
- 不把关键词出现等同于理解，不因观点立场本身加减分。
- 无法判断的维度必须使用 null 分数并说明原因。
- 每条优点和改进都必须提供至少一个可验证证据：讲稿字符范围、声音时间范围、声音指标 ID 或资料来源 ID。
- transcript quote 必须逐字等于对应字符范围；不要改写引文。
- 资料忠实度只判断讲稿是否与给定资料相符，不声称完成了资料之外的事实核查。
- 声音指标受设备、噪声和算法限制；不评价口音优劣，不作医学、情绪或人格判断。
- 给出具体、可在下一遍立即执行的动作与 30 秒练习。
- 输出简洁、具体、使用简体中文。`;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const parsed = RequestSchema.parse(await request.json());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 85_000);
    try {
      const requestPayload = JSON.stringify({
        rubricVersion: COACH_RUBRIC_VERSION,
        topic: parsed.topic,
        transcript: parsed.transcript,
        acoustic: parsed.acoustic ?? null,
      });
      const { result, model } = await scoreWithProvider(parsed.provider, SYSTEM_PROMPT, requestPayload, controller.signal);
      if (!validateCoachingEvidence(result, parsed.transcript, parsed.topic, parsed.acoustic)) {
        throw new RelayError('invalid_evidence', 'AI 反馈中的证据无法核对，本次结果未采用。', 502, true);
      }
      return NextResponse.json({
        status: 'complete',
        scorer: parsed.provider.kind,
        model,
        promptVersion: COACH_PROMPT_VERSION,
        rubricVersion: COACH_RUBRIC_VERSION,
        createdAt: new Date().toISOString(),
        result,
        errorCode: null,
      }, { headers: noStoreHeaders() });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof z.ZodError) return relayErrorResponse(new RelayError('invalid_request', '发送的数据不完整或超出限制。', 400));
    return relayErrorResponse(normalizeProviderError(error));
  }
}
