import type { DimensionTrend } from './hooks/use-training-history';

const DIMENSION_COLOR: Record<DimensionTrend['key'], string> = {
  content: 'var(--green)',
  structure: 'var(--orange)',
  evidence: '#a9c943',
  clarity: 'var(--blue)',
  delivery: 'var(--rose)',
  timing: '#bda66d',
};

const TREND_COPY: Record<DimensionTrend['trend'], string> = {
  up: '进步中',
  down: '需要关注',
  flat: '保持稳定',
  insufficient: '数据不足',
};

function sparklinePath(points: DimensionTrend['points'], width: number, height: number) {
  if (points.length < 2) return null;
  const stepX = width / (points.length - 1);
  const toY = (score: number) => height - (score / 100) * height;
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(index * stepX).toFixed(1)} ${toY(point.score).toFixed(1)}`).join(' ');
}

function DimensionSparkline({ trend }: { trend: DimensionTrend }) {
  const width = 132;
  const height = 34;
  const color = DIMENSION_COLOR[trend.key];
  const path = sparklinePath(trend.points, width, height);
  const last = trend.points.at(-1);
  return (
    <article className="trend-row" aria-label={`${trend.label}：${trend.points.length < 2 ? '数据还不够' : `最近 ${trend.points.length} 次评分，${TREND_COPY[trend.trend]}`}`}>
      <div className="trend-head">
        <strong>{trend.label}</strong>
        <span className={`trend-badge ${trend.trend}`}>{TREND_COPY[trend.trend]}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-hidden="true">
        {path
          ? <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          : <line x1={4} y1={height / 2} x2={width - 4} y2={height / 2} stroke="#d7d7cc" strokeWidth={2} strokeDasharray="1 5" strokeLinecap="round" />}
        {last && <circle cx={width - 1} cy={height - (last.score / 100) * height} r={3} fill={color} />}
      </svg>
      <span className="trend-score">{last ? last.score : '—'}</span>
    </article>
  );
}

export default function DimensionTrends({ trends }: { trends: DimensionTrend[] }) {
  const visible = trends.filter((trend) => trend.points.length > 0);
  if (!visible.length) return null;
  return (
    <section className="trend-panel" aria-label="维度成长趋势">
      <div className="column-title"><h2>维度趋势</h2><span>跨题目，仅统计当前量表版本</span></div>
      <div className="trend-grid">
        {visible.map((trend) => <DimensionSparkline trend={trend} key={trend.key} />)}
      </div>
    </section>
  );
}
