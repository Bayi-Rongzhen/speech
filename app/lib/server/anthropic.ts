import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropicClient() {
  client ??= new Anthropic({
    maxRetries: 2,
    timeout: 90_000,
  });
  return client;
}

export const CLAUDE_MODEL = 'claude-opus-5';
export const COACH_PROMPT_VERSION = 'speech-coach-1.0';
export const COACH_RUBRIC_VERSION = '语义演说教练 1.0';
