import { z } from 'zod';

export const AiProviderKindSchema = z.enum([
  'deepseek',
  'anthropic',
  'openai-compatible',
  'anthropic-compatible',
]);

export const PROVIDER_PRESETS = {
  deepseek: {
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    placeholder: 'https://api.deepseek.com',
  },
  anthropic: {
    label: 'Anthropic 官方',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    placeholder: 'https://api.anthropic.com',
  },
  'openai-compatible': {
    label: 'OpenAI 兼容中转',
    baseUrl: '',
    model: '',
    placeholder: 'https://relay.example.com/v1',
  },
  'anthropic-compatible': {
    label: 'Anthropic 兼容中转',
    baseUrl: '',
    model: '',
    placeholder: 'https://relay.example.com',
  },
} as const;

export const AllowedProviderHeaderSchema = z.enum([
  'HTTP-Referer',
  'X-Title',
  'OpenAI-Organization',
  'OpenAI-Project',
]);

export const ProviderHeaderSchema = z.object({
  name: AllowedProviderHeaderSchema,
  value: z.string().trim().min(1).max(512),
});

export const ProviderConnectionSchema = z.object({
  kind: AiProviderKindSchema,
  baseUrl: z.string().trim().min(8).max(2048),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(8).max(8192),
  optionalHeaders: z.array(ProviderHeaderSchema).max(4),
}).superRefine((value, context) => {
  const preset = PROVIDER_PRESETS[value.kind];
  if ((value.kind === 'deepseek' || value.kind === 'anthropic') && value.baseUrl.replace(/\/$/, '') !== preset.baseUrl) {
    context.addIssue({ code: 'custom', path: ['baseUrl'], message: '官方服务地址不可修改' });
  }
  const names = value.optionalHeaders.map((header) => header.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: 'custom', path: ['optionalHeaders'], message: '请求头名称不能重复' });
  }
});

export const PublicProviderMetadataSchema = z.object({
  kind: AiProviderKindSchema,
  model: z.string().min(1).max(200),
});

export const ProviderTestRequestSchema = z.object({ provider: ProviderConnectionSchema });

export type AiProviderKind = z.infer<typeof AiProviderKindSchema>;
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;
export type PublicProviderMetadata = z.infer<typeof PublicProviderMetadataSchema>;
