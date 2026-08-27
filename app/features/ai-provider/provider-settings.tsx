'use client';

import { useState } from 'react';
import {
  PROVIDER_PRESETS,
  ProviderConnectionSchema,
  type AiProviderKind,
  type ProviderConnection,
} from '../../lib/schemas/ai-provider';
import { clearSessionProvider, saveSessionProvider } from './provider-session';

const providerKinds: AiProviderKind[] = ['deepseek', 'anthropic', 'openai-compatible', 'anthropic-compatible'];

export default function ProviderSettings({
  provider,
  onChange,
  onClear,
}: {
  provider: ProviderConnection | null;
  onChange: (provider: ProviderConnection) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<ProviderConnection>(provider ?? {
    kind: 'deepseek',
    baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
    model: PROVIDER_PRESETS.deepseek.model,
    apiKey: '',
    optionalHeaders: [],
  });
  const [showKey, setShowKey] = useState(false);
  const [keepForSession, setKeepForSession] = useState(Boolean(provider));
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const custom = draft.kind === 'openai-compatible' || draft.kind === 'anthropic-compatible';

  const updateDraft = (next: ProviderConnection) => {
    setDraft(next);
    setMessage('配置已修改，请重新测试连接。');
    onClear();
    clearSessionProvider();
  };

  const selectKind = (kind: AiProviderKind) => {
    const preset = PROVIDER_PRESETS[kind];
    updateDraft({
      ...draft,
      kind,
      baseUrl: preset.baseUrl,
      model: preset.model,
      optionalHeaders: [],
    });
  };

  const validate = (candidate: ProviderConnection) => {
    const parsed = ProviderConnectionSchema.safeParse(candidate);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? '配置不完整。');
      return null;
    }
    return parsed.data;
  };

  const test = async () => {
    const parsed = validate(draft);
    if (!parsed) return;
    setTesting(true);
    setMessage('');
    try {
      const response = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: parsed }),
      });
      const data = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !data.ok) throw new Error(data.error?.message ?? '连接测试失败。');
      onChange(parsed);
      if (keepForSession) saveSessionProvider(parsed);
      else clearSessionProvider();
      setMessage('连接成功，可以用于 AI 深度反馈。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接测试失败。');
    } finally {
      setTesting(false);
    }
  };

  const clear = () => {
    clearSessionProvider();
    setDraft({
      kind: 'deepseek',
      baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
      model: PROVIDER_PRESETS.deepseek.model,
      apiKey: '',
      optionalHeaders: [],
    });
    setKeepForSession(false);
    setMessage('配置已从当前页面和标签页会话中删除。');
    onClear();
  };

  return (
    <section className="provider-settings">
      <div className="column-title"><div><h2>AI 服务设置</h2><p>密钥默认只留在当前页面内存中，不会进入训练历史或导出文件。</p></div><span>{provider ? PROVIDER_PRESETS[provider.kind].label : '尚未配置'}</span></div>
      <div className="provider-kind-grid">
        {providerKinds.map((kind) => <button type="button" className={draft.kind === kind ? 'active' : ''} key={kind} onClick={() => selectKind(kind)}>{PROVIDER_PRESETS[kind].label}</button>)}
      </div>
      <div className="provider-form">
        <label>Base URL<input type="url" value={draft.baseUrl} disabled={!custom} onChange={(event) => updateDraft({ ...draft, baseUrl: event.target.value })} placeholder={PROVIDER_PRESETS[draft.kind].placeholder} />{custom && <small>{draft.kind === 'openai-compatible' ? '填写 Chat Completions 的 API 根路径，通常以 /v1 结尾。' : '填写 Anthropic Messages 兼容 API 的根路径。'}</small>}</label>
        <label>模型 ID<input value={draft.model} onChange={(event) => updateDraft({ ...draft, model: event.target.value })} placeholder="模型名称" /></label>
        <label>API Key<span className="provider-secret"><input type={showKey ? 'text' : 'password'} autoComplete="off" value={draft.apiKey} onChange={(event) => updateDraft({ ...draft, apiKey: event.target.value })} placeholder="仅用于向所选服务商发起请求" /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</button></span></label>
      </div>
      <label className="provider-session-toggle"><input type="checkbox" checked={keepForSession} onChange={(event) => {
        const enabled = event.target.checked;
        setKeepForSession(enabled);
        if (enabled && provider) saveSessionProvider(provider);
        else if (!enabled) clearSessionProvider();
      }} /><span>仅在当前标签页会话中保存配置；关闭标签页后自动清除</span></label>
      <div className="provider-warning"><strong>使用中转站前请确认可信。</strong><span>中转站能够读取 API Key，以及你明确授权发送的讲稿、当前题目资料和聚合声音指标。本站不会发送原始录音。</span></div>
      <div className="provider-actions"><button className="primary-action compact" type="button" onClick={test} disabled={testing}>{testing ? '正在测试连接…' : '保存并测试连接'} <span>→</span></button><button className="quiet-action bordered" type="button" onClick={clear}>删除配置</button></div>
      {message && <div className={message.startsWith('连接成功') || message.startsWith('配置已') ? 'notice info' : 'notice error'} role="status">{message}</div>}
    </section>
  );
}
