"use client";

import { Check, FlaskConical, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import { useLanguage } from "@/components/language-provider";
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  createAdminWebhook,
  deleteAdminWebhook,
  getAdminGoogleOAuthConfiguration,
  listAdminWebhookDeliveries,
  listAdminWebhooks,
  replayAdminWebhookDelivery,
  testAdminWebhook,
  updateAdminGoogleOAuthConfiguration,
  type AdminGoogleOAuthConfiguration,
  type WebhookEndpoint,
} from "@/lib/integrations-api";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";

const eventOptions = ["integration.test", "user.registered", "article.published", "article.commented", "notification.created", "resource.redeemed"];

export default function IntegrationsAdminPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState("");
  const [items, setItems] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Array<{ id: number; eventType: string; status: string; attempts: number; lastError: string | null; createdAt: string }>>([]);
  const [googleConfig, setGoogleConfig] = useState<AdminGoogleOAuthConfiguration | null>(null);
  const [googleDraft, setGoogleDraft] = useState({ enabled: false, clientId: "", clientSecret: "", redirectUri: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<string[]>(["integration.test"]);
  const [busy, setBusy] = useState(false);
  const [googleSaving, setGoogleSaving] = useState(false);

  async function load(currentToken = token) {
    if (!currentToken) return;
    try {
      const [hooks, logs, google] = await Promise.all([
        listAdminWebhooks(currentToken),
        listAdminWebhookDeliveries(currentToken),
        getAdminGoogleOAuthConfiguration(currentToken),
      ]);
      setItems(hooks);
      setDeliveries(logs);
      setGoogleConfig(google);
      setGoogleDraft({ enabled: google.enabled, clientId: google.clientId, clientSecret: "", redirectUri: google.redirectUri });
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(loadError instanceof Error ? loadError.message : phrase("集成数据读取失败。", "Could not load integrations."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const current = readAccessToken();
    if (!current) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    void getMe(current).then((next) => {
      setToken(current);
      setUser(next);
      if (next.isSuperAdmin) void load(current);
      else setLoading(false);
    }).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : phrase("权限读取失败。", "Could not check access."));
      setLoading(false);
    });
  }, [locale, phrase, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      await createAdminWebhook(token, { name, url, secret, events });
      setOpen(false);
      setName("");
      setUrl("");
      setSecret("");
      setEvents(["integration.test"]);
      setNotice(phrase("Webhook 已添加。", "Webhook endpoint added."));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("Webhook 添加失败。", "Could not add webhook."));
    } finally {
      setBusy(false);
    }
  }

  async function saveGoogle(event: FormEvent) {
    event.preventDefault();
    if (!token || googleSaving) return;
    setGoogleSaving(true);
    setError("");
    try {
      const saved = await updateAdminGoogleOAuthConfiguration(token, googleDraft);
      setGoogleConfig(saved);
      setGoogleDraft({ enabled: saved.enabled, clientId: saved.clientId, clientSecret: "", redirectUri: saved.redirectUri });
      setNotice(phrase("Google 登录配置已保存。", "Google sign-in settings saved."));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("Google 登录配置保存失败。", "Could not save Google sign-in settings."));
    } finally {
      setGoogleSaving(false);
    }
  }

  async function remove(id: number) {
    if (!token || busy) return;
    setBusy(true);
    try {
      await deleteAdminWebhook(token, id);
      setNotice(phrase("Webhook 已删除。", "Webhook deleted."));
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : phrase("Webhook 删除失败。", "Could not delete webhook."));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    if (!token || busy) return;
    setBusy(true);
    try {
      await testAdminWebhook(token);
      setNotice(phrase("测试事件已排队。", "Test event queued."));
      window.setTimeout(() => void load(), 500);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : phrase("测试事件发送失败。", "Could not send test event."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <AdminPageLoading title={phrase("外部集成", "Integrations")} description={phrase("管理 Google 登录、Webhook 和只读接口。", "Manage Google sign-in, webhooks, and read-only access.")} loadingLabel={phrase("正在读取集成", "Loading integrations")} />;
  if (!user || !isSiteManager(user) || !user.isSuperAdmin) return <section className="page-shell admin-shell"><AdminPageHeader title={phrase("无权访问", "Access denied")} description={phrase("外部集成仅超级管理员可管理。", "Integrations can be managed only by the super admin.")} /></section>;

  return (
    <section className="page-shell admin-shell integrations-admin-page">
      <AdminPageHeader title={phrase("外部集成", "Integrations")} description={phrase("管理 Google 登录、签名 Webhook、投递重试与只读接口。", "Manage Google sign-in, signed webhooks, delivery retries, and read-only access.")} actions={<><button className="admin-header-icon-action" onClick={() => void load()} title={phrase("刷新", "Refresh")} type="button"><RefreshCw size={17} /></button><button className="admin-header-icon-action" onClick={() => setOpen(true)} title={phrase("新增 Webhook", "Add webhook")} type="button"><Plus size={18} /></button></>} />

      {googleConfig && <section className="integrations-panel integrations-google-config-panel">
        <header><span><img alt="" aria-hidden="true" className="google-brand-icon" height="17" src="/google-g.svg" width="17" />{phrase("Google 登录", "Google sign-in")}</span><small className={googleConfig.enabled ? "integration-status" : "integration-status pending"}>{googleConfig.enabled ? phrase("已启用", "Enabled") : phrase("未启用", "Disabled")}</small></header>
        <p className="integrations-google-config-help">{phrase("配置 Google OAuth 客户端。Client Secret 只加密保存，页面不会回显完整内容。", "Configure the Google OAuth client. The client secret is encrypted at rest and is never displayed in full.")}</p>
        <form className="integrations-google-config-form" onSubmit={(event) => void saveGoogle(event)}>
          <label className="integrations-google-toggle"><span>{phrase("启用 Google 登录", "Enable Google sign-in")}</span><input checked={googleDraft.enabled} onChange={(event) => setGoogleDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /></label>
          <label><span>Client ID</span><input disabled={googleSaving} onChange={(event) => setGoogleDraft((current) => ({ ...current, clientId: event.target.value }))} required={googleDraft.enabled} value={googleDraft.clientId} /></label>
          <label><span>Client Secret{googleConfig.clientSecretConfigured ? phrase("（已配置，留空保持不变）", " (configured; leave blank to keep)") : ""}</span><PasswordInput autoComplete="new-password" disabled={googleSaving} onChange={(event) => setGoogleDraft((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={googleConfig.clientSecretConfigured ? phrase("已配置，留空保持不变", "Configured; leave blank to keep unchanged") : phrase("输入 Client Secret", "Enter client secret")} value={googleDraft.clientSecret} /></label>
          <label><span>Redirect URI</span><input disabled={googleSaving} onChange={(event) => setGoogleDraft((current) => ({ ...current, redirectUri: event.target.value }))} required={googleDraft.enabled} value={googleDraft.redirectUri} /></label>
          <footer><small>{googleConfig.source === "environment" ? phrase("当前使用服务器环境变量；保存后切换为数据库配置。", "Currently using server environment variables; saving switches to database configuration.") : phrase("当前使用数据库配置。", "Currently using database configuration.")}</small><button className="button" disabled={googleSaving || !googleConfig.encryptionConfigured} type="submit">{googleSaving ? phrase("保存中", "Saving") : phrase("保存配置", "Save settings")}</button></footer>
        </form>
      </section>}

      <section className="integrations-panel"><header><span><Check size={17} />{phrase("Webhook 端点", "Webhook endpoints")}</span><small>{items.length}</small></header>{items.length ? <div className="integrations-list">{items.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.url}</small><em>{item.events.join(" · ")}</em></div><span className="integration-status">{item.enabled ? phrase("启用", "Enabled") : phrase("停用", "Disabled")}</span><button className="table-icon-action" onClick={() => void remove(item.id)} title={phrase("删除", "Delete")} type="button"><Trash2 size={15} /></button></article>)}</div> : <p className="article-empty-state">{phrase("尚未配置 Webhook。", "No webhooks configured yet.")}</p>}<button className="text-action primary" disabled={busy || !items.length} onClick={() => void runTest()} type="button"><FlaskConical size={15} />{phrase("发送测试事件", "Send test event")}</button></section>
      <section className="integrations-panel"><header><span><Check size={17} />{phrase("最近投递", "Recent deliveries")}</span><small>{deliveries.length}</small></header>{deliveries.length ? <div className="integrations-list">{deliveries.map((item) => <article key={item.id}><div><strong>{item.eventType}</strong><small>{new Date(item.createdAt).toLocaleString(locale)} · {phrase(`尝试 ${item.attempts} 次`, `${item.attempts} attempt(s)`)}</small>{item.lastError ? <em>{item.lastError}</em> : null}</div><span className={`integration-status ${item.status}`}>{item.status}</span><button className="table-icon-action" onClick={() => void replayAdminWebhookDelivery(token, item.id).then(() => { setNotice(phrase("投递已重放。", "Delivery replayed.")); void load(); }).catch((e) => setError(e instanceof Error ? e.message : "Replay failed."))} title={phrase("重放", "Replay")} type="button"><RefreshCw size={15} /></button></article>)}</div> : <p className="article-empty-state">{phrase("暂无投递记录。", "No delivery records yet.")}</p>}</section>
      {open ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} role="presentation"><form className="modal-panel integrations-dialog" onSubmit={(event) => void submit(event)}><header><h2>{phrase("新增 Webhook", "Add webhook")}</h2><button onClick={() => setOpen(false)} type="button"><X size={17} /></button></header><label>{phrase("名称", "Name")}<input onChange={(event) => setName(event.target.value)} required value={name} /></label><label>{phrase("HTTPS 地址", "HTTPS URL")}<input onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/hooks" required type="url" value={url} /></label><label>{phrase("签名 Secret", "Signing secret")}<input minLength={16} onChange={(event) => setSecret(event.target.value)} required type="password" value={secret} /></label><fieldset><legend>{phrase("事件", "Events")}</legend>{eventOptions.map((event) => <label key={event}><input checked={events.includes(event)} onChange={(input) => setEvents((current) => input.target.checked ? [...current, event] : current.filter((item) => item !== event))} type="checkbox" />{event}</label>)}</fieldset><footer><button className="button secondary" onClick={() => setOpen(false)} type="button">{phrase("取消", "Cancel")}</button><button className="button" disabled={busy} type="submit">{busy ? phrase("保存中", "Saving") : phrase("保存", "Save")}</button></footer></form></div> : null}
      <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}
