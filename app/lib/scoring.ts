import type { DimensionKey, FeedbackItem, ScoreDimension, ScoreResult, Topic } from './types';

export const RUBRIC_VERSION = '本地训练量表 1.1';

const DIMENSION_META: Array<{ key: DimensionKey; label: string; weight: number }> = [
  { key: 'content', label: '内容理解', weight: 25 },
  { key: 'structure', label: '结构逻辑', weight: 20 },
  { key: 'evidence', label: '论据运用', weight: 20 },
  { key: 'clarity', label: '清晰适配', weight: 15 },
  { key: 'delivery', label: '口头表达', weight: 15 },
  { key: 'timing', label: '时间控制', weight: 5 },
];

const FILLERS = ['嗯', '呃', '然后', '就是', '那个', '怎么说', '其实吧', '所以说'];
const STRUCTURE_MARKERS = ['我的观点', '我认为', '首先', '第一', '其次', '第二', '同时', '另一方面', '最后', '因此', '总之', '综上'];
const EVIDENCE_MARKERS = ['数据显示', '调查', '资料', '根据', '例如', '比如', '这意味着', '可以看到', '%', '万'];
const AUDIENCE_MARKERS = ['各位', '大家', '你们', '我们', '对于学生', '对于学校', '对于公司', '对于居民', '对于用户'];

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(value)));

const countTerms = (text: string, terms: string[]) => terms.reduce((sum, term) => {
  let from = 0;
  let count = 0;
  while ((from = text.indexOf(term, from)) !== -1) {
    count += 1;
    from += term.length;
  }
  return sum + count;
}, 0);

export function countSpeechUnits(text: string) {
  const han = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
  const numbers = text.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
  return han + latin + numbers;
}

export function estimateDuration(text: string) {
  const units = countSpeechUnits(text);
  return Math.max(20, Math.round((units / 210) * 60));
}

function sentenceList(text: string) {
  return text.split(/[。！？!?；;\n]+/).map((part) => part.trim()).filter(Boolean);
}

function excerpt(text: string, matcher?: (sentence: string) => boolean) {
  const sentences = sentenceList(text);
  const selected = (matcher ? sentences.find(matcher) : undefined) ?? sentences[0] ?? text.trim();
  return selected.length > 58 ? `${selected.slice(0, 58)}…` : selected;
}

function scoreLevel(total: number): ScoreResult['level'] {
  if (total >= 86) return '出色';
  if (total >= 72) return '熟练';
  if (total >= 58) return '发展';
  return '起步';
}

function dimensionSummary(key: DimensionKey, score: number) {
  const level = score >= 82 ? '表现稳定' : score >= 68 ? '基础扎实' : score >= 54 ? '仍可加强' : '建议优先练习';
  const details: Record<DimensionKey, string> = {
    content: '核心概念与题目要求的覆盖程度',
    structure: '结论、层次、转折与收束是否清楚',
    evidence: '数字、资料与观点之间是否建立连接',
    clarity: '句意清晰度以及对目标听众的照顾',
    delivery: '语速和口头禅所反映的表达流畅度',
    timing: '实际篇幅与目标演说时长的匹配程度',
  };
  return `${level} · ${details[key]}`;
}

function feedbackFor(
  key: DimensionKey,
  text: string,
  topic: Topic,
  context: { missingKeywords: string[]; fillerCount: number; evidenceSignals: number; averageSentence: number; timeRatio: number },
): FeedbackItem {
  const { missingKeywords, fillerCount, evidenceSignals, averageSentence, timeRatio } = context;
  const firstQuote = excerpt(text);
  const evidenceQuote = excerpt(text, (sentence) => /\d|数据|调查|资料|例如|比如/.test(sentence));
  const conclusionQuote = excerpt(text, (sentence) => /观点|认为|应该|建议|因此|总之/.test(sentence));
  const longestQuote = sentenceList(text).sort((a, b) => countSpeechUnits(b) - countSpeechUnits(a))[0] ?? firstQuote;
  const items: Record<DimensionKey, FeedbackItem> = {
    content: {
      key,
      title: '把关键取舍讲完整',
      quote: conclusionQuote,
      observation: missingKeywords.length ? `题目中的“${missingKeywords.slice(0, 2).join('、')}”还没有被充分回应，听众可能只听到立场，没有听到取舍。` : '已经表明立场，但对可能付出的代价还可以说得更具体。',
      action: `在结论后补一句：“我支持这个方案，但前提是同时处理好${missingKeywords[0] ?? '执行成本'}。”`,
      drill: '用 30 秒只说三件事：你的结论、最大收益、必须守住的底线。',
    },
    structure: {
      key,
      title: '先让听众拿到路线图',
      quote: firstQuote,
      observation: '开头还没有迅速交代结论和接下来的两层理由，听众需要边听边猜你的方向。',
      action: '把开头改成：“我的建议是先做有限试点，理由有两点：第一看实际效果，第二控制潜在风险。”',
      drill: '不看讲稿，用 20 秒说出“一句结论＋两个理由”，连续练三遍。',
    },
    evidence: {
      key,
      title: '让资料真正支撑观点',
      quote: evidenceQuote,
      observation: evidenceSignals > 0 ? '已经出现了数字或资料线索，但“这个信息为什么能支持你的结论”还没有明确说出来。' : '当前讲稿中还没有检测到数字、资料或具体例子，听众很难判断立场依据。',
      action: evidenceSignals > 0 ? '每个数字后加一句解释：“这意味着……，因此我建议……”。' : '从资料卡选择一个最能支持结论的数字，用“信息—含义—建议”连接起来。',
      drill: '任选一张资料卡，只用“数据—含义—建议”三句话讲完。',
    },
    clarity: {
      key,
      title: '一句只承载一层意思',
      quote: longestQuote.length > 58 ? `${longestQuote.slice(0, 58)}…` : longestQuote,
      observation: averageSentence > 62 ? '这句话信息较密，多个转折放在一起，非专业听众可能抓不住主干。' : '目前表达基本可读；下一步可以更主动地解释术语，并提醒听众正在进入哪一层理由。',
      action: averageSentence > 62 ? '先说结论，再停一下；把原因和例外拆成两个短句。' : '在每层理由开头加入一句路标，例如“第二个需要考虑的是执行风险”。',
      drill: '找出最长的一句话，把它拆成不超过三句，每句只保留一个动词中心。',
    },
    delivery: {
      key,
      title: fillerCount > 1 ? '用停顿替代口头禅' : '给关键句留出呼吸',
      quote: excerpt(text, (sentence) => FILLERS.some((term) => sentence.includes(term))),
      observation: fillerCount > 1 ? `本次识别到 ${fillerCount} 处常见口头禅。它们会稀释关键句的力量。` : '整体表达较连贯；如果在结论和数字之后主动停半秒，重点会更突出。',
      action: fillerCount > 1 ? '想下一句时直接停顿，不用“然后、就是、那个”填满空白。' : '在提纲中的结论和两个证据后各标一个“／”，提醒自己停顿。',
      drill: '重讲开头 30 秒，每次想说口头禅时安静停一秒。',
    },
    timing: {
      key,
      title: '给结尾预留完整空间',
      quote: excerpt(text, (sentence) => /最后|因此|总之|综上/.test(sentence)),
      observation: timeRatio < .72 ? '本次时长明显短于目标，观点还没有获得足够的展开空间。' : timeRatio > 1.18 ? '本次已经明显超出目标时长，需要压缩背景，把空间留给结论。' : '本次时长接近目标，可以继续优化各部分的主动分配。',
      action: timeRatio < .72 ? '增加一段对反方担忧的回应，再补一个明确的执行步骤。' : timeRatio > 1.18 ? '删去重复背景，只保留一个核心数字和两条理由。' : '按“开头 20 秒—两点论据各 60 秒—回应风险 25 秒—结尾 15 秒”分配。',
      drill: '只练最后 15 秒：回扣听众、重申建议、明确下一步。',
    },
  };
  return items[key];
}

export function scoreSpeech(
  rawText: string,
  durationSeconds: number,
  durationEstimated: boolean,
  topic: Topic,
  transcriptSource: 'browser' | 'manual' | 'edited' = 'manual',
): ScoreResult {
  const text = rawText.replace(/\s+/g, ' ').trim();
  const units = countSpeechUnits(text);
  const safeDuration = durationSeconds > 0 ? durationSeconds : estimateDuration(text);
  const measuredPace = Math.round((units / Math.max(safeDuration, 1)) * 60);
  const fillerCount = countTerms(text, FILLERS);
  const structureSignals = countTerms(text, STRUCTURE_MARKERS);
  const evidenceSignals = countTerms(text, EVIDENCE_MARKERS) + (text.match(/\d+(?:\.\d+)?%?/g)?.length ?? 0);
  const audienceSignals = countTerms(text, AUDIENCE_MARKERS);
  const coveredKeywords = topic.keywords.filter((keyword) => text.includes(keyword));
  const missingKeywords = topic.keywords.filter((keyword) => !text.includes(keyword));
  const keywordCoverage = Math.round((coveredKeywords.length / topic.keywords.length) * 100);
  const sentences = sentenceList(text);
  const averageSentence = units / Math.max(sentences.length, 1);
  const punctuationCount = text.match(/[。！？!?；;\n]/g)?.length ?? 0;
  const lengthFactor = Math.min(units / 360, 1);
  const deliveryAvailable = !durationEstimated && transcriptSource === 'browser';
  const timingAvailable = !durationEstimated;

  let content = clamp(38 + keywordCoverage * .42 + lengthFactor * 16);
  let structure = clamp(39 + Math.min(structureSignals, 5) * 8 + (/观点|认为|建议|应该/.test(text.slice(0, 100)) ? 10 : 0) + (/因此|总之|最后|综上|所以/.test(text.slice(-130)) ? 11 : 0));
  let evidence = clamp(36 + Math.min(evidenceSignals, 7) * 6 + Math.min(coveredKeywords.length, 4) * 4);
  const sentencePenalty = punctuationCount >= 2
    ? averageSentence > 62 ? Math.min(12, (averageSentence - 62) * .28) : averageSentence < 8 ? 6 : 0
    : 0;
  let clarity = clamp(72 + Math.min(audienceSignals, 3) * 5 - sentencePenalty - (deliveryAvailable ? Math.max(0, fillerCount - 1) * 2 : 0));
  const paceDistance = measuredPace < 130 ? 130 - measuredPace : measuredPace > 290 ? measuredPace - 290 : 0;
  let delivery = clamp(86 - paceDistance * .18 - fillerCount * 2.6);
  const timeRatio = safeDuration / topic.speechSeconds;
  const timing = clamp(96 - Math.abs(1 - timeRatio) * 85);

  if (units < 90) {
    content = Math.min(content, 48);
    structure = Math.min(structure, 52);
    evidence = Math.min(evidence, 45);
    clarity = Math.min(clarity, 62);
    delivery = Math.min(delivery, 64);
  } else if (units < 180) {
    content = Math.min(content, 67);
    evidence = Math.min(evidence, 64);
  }

  const rawScores: Record<DimensionKey, number> = { content, structure, evidence, clarity, delivery, timing };
  const availability: Record<DimensionKey, boolean> = {
    content: true,
    structure: true,
    evidence: true,
    clarity: true,
    delivery: deliveryAvailable,
    timing: timingAvailable,
  };
  const dimensions: ScoreDimension[] = DIMENSION_META.map((meta) => ({
    ...meta,
    score: rawScores[meta.key],
    available: availability[meta.key],
    summary: availability[meta.key]
      ? dimensionSummary(meta.key, rawScores[meta.key])
      : meta.key === 'delivery'
        ? '本次讲稿经过手动输入或修订，无法可靠判断口头表达'
        : '本次没有有效录音时长，无法判断时间控制',
  }));
  const availableWeight = dimensions.filter((item) => item.available).reduce((sum, item) => sum + item.weight, 0);
  const total = clamp(dimensions.filter((item) => item.available).reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight);
  const sorted = dimensions.filter((item) => item.available).sort((a, b) => a.score - b.score || b.weight - a.weight);
  const feedback = sorted.slice(0, 3).map((item) => feedbackFor(item.key, text, topic, {
    missingKeywords, fillerCount, evidenceSignals, averageSentence, timeRatio,
  }));
  const strongest = dimensions.filter((item) => item.available).sort((a, b) => b.score - a.score || b.weight - a.weight).slice(0, units < 90 ? 0 : 2);
  const strengths = strongest.map((item) => ({
    title: `${item.label}是这次的亮点`,
    detail: item.summary.replace(/^.*? · /, ''),
    quote: item.key === 'evidence'
      ? excerpt(text, (sentence) => /\d|数据|调查|资料|例如|比如/.test(sentence))
      : excerpt(text, (sentence) => /观点|认为|建议|应该|因此|总之/.test(sentence)),
  }));
  const confidence: ScoreResult['confidence'] = units >= 260 && safeDuration >= 75 && !durationEstimated
    ? '参考性较高'
    : units >= 110
      ? '参考性中等'
      : '数据较少';

  return {
    total,
    level: scoreLevel(total),
    confidence,
    rubricVersion: RUBRIC_VERSION,
    dimensions,
    metrics: {
      durationSeconds: safeDuration,
      durationEstimated,
      speechUnits: units,
      pace: deliveryAvailable ? measuredPace : null,
      fillerCount: deliveryAvailable ? fillerCount : null,
      structureSignals,
      evidenceSignals,
      keywordCoverage,
    },
    strengths,
    feedback,
    nextFocus: feedback[0]?.drill ?? '重讲一次，并在开头先说出你的结论。',
  };
}
