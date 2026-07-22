import { PortalContentList } from "@/components/portal-content-list";

const toolKinds = ["tool", "server"] as const;

export default function ToolsPage() {
  return (
    <section className="page-shell">
      <PortalContentList
        emptyMessage="登录后可以查看账号有权使用的工具。"
        kinds={[...toolKinds]}
      />
    </section>
  );
}
