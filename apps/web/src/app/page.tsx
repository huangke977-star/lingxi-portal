import Link from "next/link";
import { getApiHealth } from "@/lib/api";

const portalEntries = [
  {
    href: "/dashboard",
    marker: "ME",
    title: "个人工作台",
    description: "查看身份、角色境界和当前可进入区域。",
    meta: "登录后可用",
  },
  {
    href: "/nav",
    marker: "NAV",
    title: "公开导航",
    description: "集中放置公开可访问的网站、项目和资料入口。",
    meta: "公开可见",
  },
  {
    href: "/tools",
    marker: "KIT",
    title: "工具箱",
    description: "沉淀常用的小工具、脚本入口和后续自定义页面。",
    meta: "按角色开放",
  },
];

export default async function HomePage() {
  const health = await getApiHealth().catch(() => null);

  return (
    <section className="page-shell">
      <div className="overview-grid">
        <div className="overview-panel">
          <span className="section-label">运行状态</span>
          <strong>{health ? "API 已连接" : "API 未连接"}</strong>
          <p>
            {health
              ? `${health.service} 返回 ${health.status}`
              : "后端服务暂时不可用，请稍后再试。"}
          </p>
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
            <span>风格</span>
            <strong>Glass</strong>
          </div>
        </div>
      </div>

      <div className="entry-list card-grid">
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
