import Link from 'next/link';
import { getApiHealth } from '@/lib/api';

const portalEntries = [
  {
    href: '/dashboard',
    marker: '工',
    title: '个人工作台',
    description: '查看身份、角色境界和当前可进入区域。',
    meta: '登录后可用',
  },
  {
    href: '/nav',
    marker: '航',
    title: '公开导航',
    description: '集中放置公开可访问的网站、项目和资料入口。',
    meta: '公开可见',
  },
  {
    href: '/tools',
    marker: '器',
    title: '工具箱',
    description: '沉淀常用的小工具、脚本入口和后续自定义页面。',
    meta: '按角色开放',
  },
];

export default async function HomePage() {
  const health = await getApiHealth().catch(() => null);

  return (
    <section className="page-shell">
      <header className="page-header">
        <span className="eyebrow">Lingxi Portal</span>
        <div className="title-row">
          <div>
            <h1>入口、工具和权限的统一工作台</h1>
            <p>把公开导航、个人工具、服务器入口和管理能力收拢到一个干净的门户里。</p>
          </div>
          <div className="actions">
            <Link className="button" href="/dashboard">
              进入工作台
            </Link>
            <Link className="button secondary" href="/nav">
              查看导航
            </Link>
          </div>
        </div>
      </header>

      <div className="overview-grid">
        <div className="overview-panel">
          <span className="section-label">运行状态</span>
          <strong>{health ? 'API 已连接' : 'API 未连接'}</strong>
          <p>{health ? `${health.service} 返回 ${health.status}` : '后端服务暂时不可用，请稍后再试。'}</p>
        </div>
        <div className="metric-grid">
          <div className="metric">
            <span>入口</span>
            <strong>3</strong>
          </div>
          <div className="metric">
            <span>默认角色</span>
            <strong>练气</strong>
          </div>
          <div className="metric">
            <span>管理模式</span>
            <strong>RBAC</strong>
          </div>
        </div>
      </div>

      <div className="entry-list">
        {portalEntries.map((entry) => (
          <Link className="entry-item" href={entry.href} key={entry.href}>
            <span className="entry-marker">{entry.marker}</span>
            <span className="entry-main">
              <strong>{entry.title}</strong>
              <span>{entry.description}</span>
            </span>
            <span className="entry-meta">{entry.meta}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
