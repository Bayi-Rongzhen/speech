'use client';

import { useState } from 'react';
import { TopicSnapshotSchema, type TopicSnapshot } from '../../lib/schemas/topic';

export default function TopicBuilder({ onUseTopic }: { onUseTopic: (topic: TopicSnapshot) => void }) {
  const [mode, setMode] = useState<'manual' | 'research'>('manual');
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('');
  const [task, setTask] = useState('');
  const [materials, setMaterials] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createManual = () => {
    try {
      const sourceBodies = materials.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
      const topic = TopicSnapshotSchema.parse({
        id: `custom-${crypto.randomUUID()}`,
        version: 1,
        origin: 'custom',
        category: '自定义训练',
        title,
        audience,
        task,
        prepMinutes: 8,
        speechSeconds: 180,
        difficulty: '进阶',
        sources: sourceBodies.map((body, index) => ({
          id: `user-${index + 1}`,
          kind: 'user',
          status: 'user-provided',
          label: '用户提供',
          title: `自定义资料 ${index + 1}`,
          body,
        })),
        keywordGroups: title.split(/[，。、；：\s]+/).filter((item) => item.length >= 2).slice(0, 6).map((item) => [item]),
        createdAt: new Date().toISOString(),
      });
      onUseTopic(topic);
    } catch {
      setError('请填写题目、听众、任务，并至少提供一段资料。');
    }
  };

  const research = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/topics/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await response.json() as { topic?: unknown; error?: string };
      if (!response.ok || !data.topic) throw new Error(data.error || '研究失败');
      onUseTopic(TopicSnapshotSchema.parse(data.topic));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法完成研究。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="topic-builder">
      <div className="topic-builder-tabs" role="tablist" aria-label="自定义题目方式">
        <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>导入自己的资料</button>
        <button type="button" className={mode === 'research' ? 'active' : ''} onClick={() => setMode('research')}>查找公开资料</button>
      </div>
      {mode === 'manual' ? (
        <div className="topic-builder-form">
          <label>训练题目<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：学校是否应全面禁止手机进入课堂？" /></label>
          <label>目标听众<input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="例如：学校教学委员会" /></label>
          <label>演说任务<input value={task} onChange={(event) => setTask(event.target.value)} placeholder="明确表态，并提出两条可执行规则。" /></label>
          <label>训练资料<textarea value={materials} onChange={(event) => setMaterials(event.target.value)} placeholder="粘贴资料内容。不同资料之间空一行。" /></label>
          <p>这些内容会标记为“用户提供”，不会声称已经完成事实核验。</p>
          <button className="primary-action compact" type="button" onClick={createManual}>使用这道题 <span>→</span></button>
        </div>
      ) : (
        <div className="topic-builder-form">
          <label>想研究的议题<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：大学四天工作制的利弊和试点条件" /></label>
          <p>公开资料研究由本站单独配置的研究服务完成，只发送这个议题；不会使用你在 AI 演说反馈中填写的服务商或 API Key。</p>
          <button className="primary-action compact" type="button" onClick={research} disabled={busy || query.trim().length < 4}>{busy ? '正在查找并整理资料…' : '生成带引用的训练题'} <span>→</span></button>
        </div>
      )}
      {error && <div className="notice error" role="alert">{error}</div>}
    </section>
  );
}
