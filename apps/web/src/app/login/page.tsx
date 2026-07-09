import Link from 'next/link';

export default function LoginPage() {
  return (
    <section>
      <span className="eyebrow">Account</span>
      <h1>登录</h1>
      <p>账号密码登录将在认证阶段实现。</p>
      <div className="actions">
        <Link className="button secondary" href="/register">
          注册
        </Link>
      </div>
    </section>
  );
}
