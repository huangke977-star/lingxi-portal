import { PortalContentList } from "@/components/portal-content-list";

const navigationKinds = ["navigation"] as const;

export default function NavPage() {
  return (
    <section className="page-shell">
      <PortalContentList
        emptyMessage={{
          chinese: "超级管理员还没有添加导航条目。",
          english: "No navigation entries have been added by a super administrator yet.",
        }}
        kinds={[...navigationKinds]}
      />
    </section>
  );
}
