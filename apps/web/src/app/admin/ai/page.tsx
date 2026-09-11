"use client";

import { Activity, BrainCircuit, CheckCircle2, CircleAlert, Cpu, Database, KeyRound, PlugZap, RefreshCw, Save, Server, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { PasswordInput } from "@/components/password-input";
import { useLanguage } from "@/components/language-provider";
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getAiAdminConfiguration, getAiAdminInvocations, testAiAdminConnection, type AiAdminConfiguration, type AiAdminConfigurationUpdate, type AiInvocationOverview, updateAiAdminConfiguration } from "@/lib/ai-api";
import { localizedPath } from "@/lib/i18n";

type Draft = AiAdminConfigurationUpdate;

const providerOptions = [
  { value: "openai-compatible" as const, label: "OpenAI Compatible" },
  { value: "anthropic" as const, label: "Anthropic" },
  { value: "google" as const, label: "Google" },
];

function toDraft(config: AiAdminConfiguration): Draft {
  return {
    enabled: config.enabled,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    globalConcurrency: config.globalConcurrency,
    userConcurrency: config.userConcurrency,
    maxOutputTokens: config.maxOutputTokens,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
    dailyRequestLimit: config.dailyRequestLimit,
    billingCurrency: config.billingCurrency,
    inputCostPerMillionMicros: config.inputCostPerMillionMicros,
    outputCostPerMillionMicros: config.outputCostPerMillionMicros,
  };
}

export default function AiAdminPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [config, setConfig] = useState<AiAdminConfiguration | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [overview, setOverview] = useState<AiInvocationOverview | null>(null);

  async function load(currentToken: string) {
    const [next, nextOverview] = await Promise.all([getAiAdminConfiguration(currentToken), getAiAdminInvocations(currentToken)]);
    setConfig(next);
    setDraft(toDraft(next));
    setOverview(nextOverview);
    setApiKey("");
    setClearApiKey(false);
  }

  async function testConnection() {
    if (!token || testing) return;
    setTesting(true);
    setError("");
    try {
      const result = await testAiAdminConnection(token);
      setNotice(phrase(`连接成功，耗时 ${result.durationMs} ms。`, `Connection succeeded in ${result.durationMs} ms.`));
      setOverview(await getAiAdminInvocations(token));
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : phrase("AI 连接测试失败。", "AI connection test failed."));
      setOverview(await getAiAdminInvocations(token).catch(() => overview));
    } finally {
      setTesting(false);
    }
  }

  async function refresh() {
    if (!token) return;
    setError("");
    try {
      await load(token);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : phrase("AI 配置读取失败。", "Could not load AI settings."));
    }
  }

  useEffect(() => {
    const currentToken = readAccessToken();
    if (!currentToken) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    let active = true;
    void getMe(currentToken).then(async (currentUser) => {
      if (!active) return;
      setUser(currentUser);
      setToken(currentToken);
      if (currentUser.isSuperAdmin) await load(currentToken);
    }).catch((loadError) => {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      if (active) setError(loadError instanceof Error ? loadError.message : phrase("AI 配置读取失败。", "Could not load AI settings."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, phrase, router]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || !draft || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await updateAiAdminConfiguration(token, { ...draft, apiKey: apiKey.trim() || undefined, clearApiKey });
      setConfig(saved);
      setDraft(toDraft(saved));
      setApiKey("");
      setClearApiKey(false);
      setNotice(phrase("AI 配置已保存。", "AI settings saved."));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("AI 配置保存失败。", "Could not save AI settings."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <AdminPageLoading title={phrase("AI 配置", "AI settings")} description={phrase("配置外部 AI 服务和资源保护参数。", "Configure an external AI service and resource limits.")} loadingLabel={phrase("正在读取 AI 配置", "Loading AI settings")} />;
  if (!user?.isSuperAdmin) return <section className="page-shell admin-shell"><AdminPageHeader title={phrase("无权访问", "Access denied")} description={phrase("AI 配置仅超级管理员可管理。", "AI settings can be managed only by the super admin.")} /></section>;
  if (!config || !draft) return <section className="page-shell admin-shell"><AdminPageHeader title={phrase("AI 配置", "AI settings")} description={phrase("暂时无法读取 AI 配置。", "AI settings are temporarily unavailable.")} /><AppToast message={error || phrase("AI 配置读取失败。", "Could not load AI settings.")} onDismiss={() => setError("")} tone="error" /></section>;
  const recommendation = config.recommendation;

  return <section className="page-shell admin-shell ai-admin-page">
    <AdminPageHeader title={phrase("AI 配置", "AI settings")} description={phrase("配置外部模型、密钥和并发保护。未启用时不会产生 AI 请求。", "Configure the external model, key, and concurrency protection. No AI requests are made while disabled.")} actions={<button className="admin-header-icon-action" onClick={() => void refresh()} title={phrase("刷新", "Refresh")} type="button"><RefreshCw size={17} /></button>} />
    <section className="ai-resource-summary">
      <header><span><Server size={17} />{phrase("服务器推荐", "Server recommendation")}</span><small>{phrase("根据当前运行环境动态计算", "Calculated from the current runtime")}</small></header>
      <div className="ai-resource-grid"><span><Cpu size={15} /><strong>{recommendation.cpuCores}</strong><small>{phrase("CPU 核心", "CPU cores")}</small></span><span><Database size={15} /><strong>{recommendation.totalMemoryMiB} MiB</strong><small>{phrase("总内存", "Total memory")}</small></span><span><BrainCircuit size={15} /><strong>{recommendation.globalConcurrency}</strong><small>{phrase("推荐全站并发", "Recommended global concurrency")}</small></span><span><ShieldCheck size={15} /><strong>{recommendation.userConcurrency}</strong><small>{phrase("推荐单用户并发", "Recommended per-user concurrency")}</small></span></div>
      <p>{phrase(`当前保护上限：全站 ${recommendation.maxGlobalConcurrency}，单用户 ${recommendation.maxUserConcurrency}。推荐值会随服务器资源变化，保存时仍会执行上限校验。`, `Current protection limits: global ${recommendation.maxGlobalConcurrency}, per user ${recommendation.maxUserConcurrency}. Recommendations follow server resources and are enforced on save.`)}</p>
    </section>
    <form className="ai-config-panel" onSubmit={(event) => void submit(event)}>
      <header><span><BrainCircuit size={17} />{phrase("模型连接", "Model connection")}</span><small>{config.encryptionConfigured ? phrase("密钥加密已就绪", "Secret encryption ready") : phrase("未配置密钥加密", "Secret encryption unavailable")}</small></header>
      <label className="ai-config-toggle"><span>{phrase("启用 AI 功能", "Enable AI features")}</span><input checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} type="checkbox" /></label>
      <div className="ai-config-fields"><label><span>{phrase("供应商", "Provider")}</span><GlassSelect ariaLabel={phrase("供应商", "Provider")} leadingIcon={<BrainCircuit size={14} />} menuPortal onChange={(value) => update("provider", value)} options={providerOptions} value={draft.provider} /></label><label><span>{phrase("接口地址", "Base URL")}</span><input onChange={(event) => update("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" value={draft.baseUrl} /></label><label><span>{phrase("模型名称", "Model")}</span><input onChange={(event) => update("model", event.target.value)} placeholder="例如 gpt-4o-mini" value={draft.model} /></label><label><span><KeyRound size={13} /> API Key {config.apiKeyConfigured ? phrase("（已配置，留空保持不变）", "(configured; leave blank to keep)") : ""}</span><PasswordInput autoComplete="new-password" disabled={!config.encryptionConfigured} onChange={(event) => setApiKey(event.target.value)} placeholder={config.apiKeyConfigured ? phrase("已配置，留空保持不变", "Configured; leave blank to keep") : phrase("输入 API Key", "Enter API key")} value={apiKey} /></label></div>
      {config.apiKeyConfigured ? <label className="ai-clear-key"><input checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} type="checkbox" />{phrase("清除已保存的 API Key", "Clear the saved API key")}</label> : null}
      <div className="ai-config-fields ai-limit-fields"><label><span>{phrase("全站并发", "Global concurrency")}</span><input max={recommendation.maxGlobalConcurrency} min={1} onChange={(event) => update("globalConcurrency", Number(event.target.value))} type="number" value={draft.globalConcurrency} /></label><label><span>{phrase("单用户并发", "Per-user concurrency")}</span><input max={recommendation.maxUserConcurrency} min={1} onChange={(event) => update("userConcurrency", Number(event.target.value))} type="number" value={draft.userConcurrency} /></label><label><span>{phrase("最大输出 tokens", "Max output tokens")}</span><input max={8000} min={256} onChange={(event) => update("maxOutputTokens", Number(event.target.value))} type="number" value={draft.maxOutputTokens} /></label><label><span>{phrase("请求超时（秒）", "Request timeout (seconds)")}</span><input max={300} min={10} onChange={(event) => update("requestTimeoutSeconds", Number(event.target.value))} type="number" value={draft.requestTimeoutSeconds} /></label><label><span>{phrase("全站每日请求上限（0 为不限）", "Global daily request limit (0 = unlimited)")}</span><input max={100000} min={0} onChange={(event) => update("dailyRequestLimit", Number(event.target.value))} type="number" value={draft.dailyRequestLimit} /></label><label><span>{phrase("计价币种", "Billing currency")}</span><GlassSelect ariaLabel={phrase("计价币种", "Billing currency")} leadingIcon={<Activity size={14} />} menuPortal onChange={(value) => update("billingCurrency", value)} options={[{ value: "USD", label: "USD" }, { value: "CNY", label: "CNY" }]} value={draft.billingCurrency} /></label><label><span>{phrase("输入价 / 百万 tokens", "Input price / million tokens")}</span><input min={0} onChange={(event) => update("inputCostPerMillionMicros", Math.round(Number(event.target.value) * 1000000))} step={0.000001} type="number" value={draft.inputCostPerMillionMicros / 1000000} /></label><label><span>{phrase("输出价 / 百万 tokens", "Output price / million tokens")}</span><input min={0} onChange={(event) => update("outputCostPerMillionMicros", Math.round(Number(event.target.value) * 1000000))} step={0.000001} type="number" value={draft.outputCostPerMillionMicros / 1000000} /></label></div>
      <footer><small>{phrase("密钥仅用于服务端调用，不会返回到浏览器；价格填 0 表示只统计 tokens，不估算费用。", "The key is used only for server-side calls and is never returned to the browser. A price of 0 records tokens without estimating cost.")}</small><div className="ai-config-actions"><button className="button ai-test-button" disabled={testing || saving || !config.apiKeyConfigured} onClick={() => void testConnection()} type="button"><PlugZap size={15} />{testing ? phrase("测试中", "Testing") : phrase("测试连接", "Test connection")}</button><button className="button" disabled={saving || !config.encryptionConfigured} type="submit"><Save size={15} />{saving ? phrase("保存中", "Saving") : phrase("保存配置", "Save settings")}</button></div></footer>
    </form>
    <section className="ai-log-panel">
      <header><span><Activity size={17} />{phrase("调用记录", "Invocation log")}</span><small>{overview ? phrase(`今日 ${overview.today.requests} 次，${overview.today.totalTokens} tokens，约 ${(overview.today.estimatedCostMicros / 1000000).toFixed(6)} ${config.billingCurrency}`, `${overview.today.requests} today, ${overview.today.totalTokens} tokens, about ${(overview.today.estimatedCostMicros / 1000000).toFixed(6)} ${config.billingCurrency}`) : phrase("暂无记录", "No records")}</small></header>
      {overview?.logs.length ? <div className="ai-log-list">{overview.logs.map((log) => <div className="ai-log-row" key={log.id}><span className={log.status === "success" ? "ai-log-status success" : "ai-log-status failed"}>{log.status === "success" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}{log.status === "success" ? phrase("成功", "Success") : phrase("失败", "Failed")}</span><span>{log.operation === "test_connection" ? phrase("连接测试", "Connection test") : log.operation}</span><span>{log.model || "-"}</span><span>{log.totalTokens ?? "-"} tokens</span><span>{log.durationMs} ms</span><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")}</time>{log.errorSummary ? <small>{log.errorSummary}</small> : null}</div>)}</div> : <p className="ai-log-empty">{phrase("连接测试或文章助手调用后，脱敏记录会显示在这里。", "Redacted records appear here after a connection test or assistant invocation.")}</p>}
    </section>
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
