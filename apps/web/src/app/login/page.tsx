'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { login } from '@/lib/auth-api';
import { saveAuthTokens } from '@/lib/auth-storage';

export default function LoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!account.trim() || !password) {
      setError('请输入账号和密码。');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await login({ account, password });
      saveAuthTokens(response);
      router.push('/dashboard');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-panel">
        <div className="auth-panel-head">
          <span className="section-label">HLOVET</span>
          <h1>账号登录</h1>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label>
            <span>账号或邮箱</span>
            <input
              autoComplete="username"
              name="account"
              onChange={(event) => setAccount(event.target.value)}
              value={account}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="message error">{error}</p> : null}
          <div className="actions">
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? '登录中' : '登录'}
            </button>
            <Link className="button secondary" href="/register">
              注册账号
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
