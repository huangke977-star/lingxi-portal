import Link from 'next/link';

export default function RegisterPage() {
  return (
    <section>
      <span className="eyebrow">Account</span>
      <h1>注册</h1>
      <p>开放注册将在认证阶段实现，新用户默认角色为练气。</p>
      <div className="actions">
        <Link className="button secondary" href="/login">
          返回登录
        </Link>
      </div>
    </section>
  );
}
