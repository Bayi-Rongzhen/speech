import 'server-only';
import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getDeepSeekClient() {
  client ??= new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
    maxRetries: 2,
    timeout: 90_000,
  });
  return client;
}

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';
