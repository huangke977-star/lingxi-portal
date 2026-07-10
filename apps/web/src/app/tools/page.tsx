const toolEntries = [
  {
    marker: 'JSON',
    title: 'JSON 工具',
    description: '格式化、校验和压缩接口数据。',
    meta: '待接入',
  },
  {
    marker: 'DNS',
    title: '域名检查',
    description: '记录域名解析、证书和可用性检查入口。',
    meta: '待接入',
  },
  {
    marker: 'VPS',
    title: '服务器入口',
    description: '集中管理服务器面板、监控和内部入口。',
    meta: '管理员',
  },
];

export default function ToolsPage() {
  return (
    <section className="page-shell">
      <header className="page-header">
        <span className="eyebrow">Toolbox</span>
        <div className="title-row">
          <div>
            <h1>工具箱</h1>
            <p>这里会逐步沉淀你常用的脚本、小工具和服务器入口。</p>
          </div>
          <span className="status">按角色开放</span>
        </div>
      </header>

      <div className="entry-list">
        {toolEntries.map((tool) => (
          <div className="entry-item muted" key={tool.title}>
            <span className="entry-marker">{tool.marker}</span>
            <span className="entry-main">
              <strong>{tool.title}</strong>
              <span>{tool.description}</span>
            </span>
            <span className="entry-meta">{tool.meta}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
