import { PortalContentList } from "@/components/portal-content-list";

const toolKinds = ["tool", "server"] as const;

export default function ToolsPage() {
  return (
    <section className="page-shell">
      <header className="page-header">
        <span className="eyebrow">HLOVET Toolbox</span>
        <div className="title-row">
          <div>
            <h1>工具箱</h1>
            <p>常用工具会根据当前账号身份显示。</p>
          </div>
        </div>
      </header>

      <PortalContentList
        emptyMessage="登录后可以查看账号有权使用的工具。"
        kinds={[...toolKinds]}
      />
    </section>
  );
}
