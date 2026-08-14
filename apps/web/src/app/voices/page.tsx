import { AnonymousTopicsPanel } from "@/components/anonymous-topics-panel";

export default function VoicesPage() {
  return <section className="p8-page p8-directory-page"><header className="p8-page-heading"><div><span className="section-label">VOICES</span><h1>匿名话题</h1></div></header><AnonymousTopicsPanel pageSize={12} showLoadMore title="全部话题" /></section>;
}
