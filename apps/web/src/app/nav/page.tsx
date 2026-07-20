import { PortalContentList } from "@/components/portal-content-list";

const navigationKinds = ["navigation"] as const;

export default function NavPage() {
  return (
    <section className="page-shell">
      <header className="page-header">
        <span className="eyebrow">HLOVET Navigation</span>
        <div className="title-row">
          <div>
            <h1>公开导航</h1>
            <p>常用站点、在线服务和实用工具会在这里持续更新。</p>
          </div>
        </div>
      </header>

      <PortalContentList
        emptyMessage="超级管理员还没有添加导航条目。"
        kinds={[...navigationKinds]}
      />
    </section>
  );
}
