const publicLinks = [
  {
    href: 'https://github.com/huangke977-star/lingxi-portal',
    marker: 'Git',
    title: '项目仓库',
    description: '灵犀门户的代码仓库和版本记录。',
    meta: 'GitHub',
  },
  {
    href: 'https://ui.shadcn.com/',
    marker: 'UI',
    title: 'shadcn/ui',
    description: '后续组件体系和界面细节的重要参考。',
    meta: '设计参考',
  },
  {
    href: 'https://gethomepage.dev/',
    marker: 'HP',
    title: 'Homepage',
    description: '导航、服务入口和状态面板的信息组织参考。',
    meta: '入口参考',
  },
];

export default function NavPage() {
  return (
    <section className="page-shell">
      <header className="page-header">
        <span className="eyebrow">Public Navigation</span>
        <div className="title-row">
          <div>
            <h1>公开导航</h1>
            <p>先放置公开可访问的项目和设计参考，后续会从后台配置读取。</p>
          </div>
          <span className="status">公开可见</span>
        </div>
      </header>

      <div className="entry-list">
        {publicLinks.map((link) => (
          <a className="entry-item" href={link.href} key={link.href} rel="noreferrer" target="_blank">
            <span className="entry-marker">{link.marker}</span>
            <span className="entry-main">
              <strong>{link.title}</strong>
              <span>{link.description}</span>
            </span>
            <span className="entry-meta">{link.meta}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
