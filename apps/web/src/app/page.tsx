import Link from 'next/link';
import { getApiHealth } from '@/lib/api';

export default async function HomePage() {
  const health = await getApiHealth().catch(() => null);

  return (
    <section className="hero">
      <span className="eyebrow">Lingxi Portal</span>
      <h1>灵犀门户</h1>
      <p>公开主页、个人工作台、导航、工具箱和服务器入口。</p>
      <div className="actions">
        <Link className="button" href="/nav">
          查看导航
        </Link>
        <Link className="button secondary" href="/login">
          登录
        </Link>
      </div>
      <div className="panel">
        <span className="status">
          API 状态：{health ? `${health.service} ${health.status}` : '未连接'}
        </span>
      </div>
    </section>
  );
}
