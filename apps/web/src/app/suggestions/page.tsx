import { SuggestionsPanel } from "@/components/suggestions-panel";

export default function SuggestionsPage() {
  return <section className="p8-page p8-directory-page"><header className="p8-page-heading"><div><span className="section-label">SUGGESTIONS</span><h1>建议</h1></div></header><SuggestionsPanel pageSize={12} showLoadMore showSearch title="全部建议" /></section>;
}
