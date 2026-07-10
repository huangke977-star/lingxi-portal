'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { register } from '@/lib/auth-api';
import { saveAuthTokens } from '@/lib/auth-storage';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!username.trim() || !email.trim() || !password || !confirmation) {
      setError('请完整填写注册信息。');
      return;
    }

    if (password !== confirmation) {
      setError('两次输入的密码不一致。');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await register({ username, email, password });
      saveAuthTokens(response);
      router.push('/dashboard');
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : '注册失败，请稍后重试。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-panel">
        <div className="auth-panel-head">
          <span className="section-label">HLOVET</span>
          <h1>创建账号</h1>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
          <label>
            <span>用户名</span>
            <input
              autoComplete="username"
              maxLength={32}
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              value={username}
            />
          </label>
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="new-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <label>
            <span>确认密码</span>
            <input
              autoComplete="new-password"
              name="confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              type="password"
              value={confirmation}
            />
          </label>
          {error ? <p className="message error">{error}</p> : null}
          <div className="actions">
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? '注册中' : '注册'}
            </button>
            <Link className="button secondary" href="/login">
              返回登录
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}
