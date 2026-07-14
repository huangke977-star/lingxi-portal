"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthUser, getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  defaultThemePreference,
  normalizeThemePreference,
  portalThemes,
  readThemePreference,
  RecommendedThemeId,
  ThemePreference,
  writeThemePreference,
} from "@/lib/theme-preferences";

type CustomColorKey =
  | "customAccent"
  | "customSurface"
  | "customForeground"
  | "customMuted";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

  useEffect(() => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      router.replace("/login");
      return;
    }

    getMe(accessToken)
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : "无法获取当前用户。",
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [router]);

  const normalizedPreference = useMemo(
    () => normalizeThemePreference(preference),
    [preference],
  );

  const customAccent =
    normalizedPreference.customAccent ?? defaultThemePreference.customAccent!;
  const customSurface =
    normalizedPreference.customSurface ?? defaultThemePreference.customSurface!;
  const customForeground =
    normalizedPreference.customForeground ??
    defaultThemePreference.customForeground!;
  const customMuted =
    normalizedPreference.customMuted ?? defaultThemePreference.customMuted!;
  const cardAlpha =
    normalizedPreference.cardAlpha ?? defaultThemePreference.cardAlpha!;
  const glassBlur =
    normalizedPreference.glassBlur ?? defaultThemePreference.glassBlur!;

  function commitPreference(partialPreference: Partial<ThemePreference>) {
    const nextPreference = normalizeThemePreference({
      ...normalizedPreference,
      ...partialPreference,
    });
    setPreference(nextPreference);
    writeThemePreference(nextPreference);
  }

  function selectRecommendedTheme(themeId: RecommendedThemeId) {
    commitPreference({ themeId });
  }

  function selectCustomTheme() {
    commitPreference({ themeId: "custom" });
  }

  function updateCustomColor(key: CustomColorKey, value: string) {
    commitPreference({ [key]: value, themeId: "custom" });
  }

  const previewStyle = {
    "--theme-preview-accent": customAccent,
    "--theme-preview-alpha": cardAlpha / 100,
    "--theme-preview-blur": `${glassBlur}px`,
    "--theme-preview-foreground": customForeground,
    "--theme-preview-muted": customMuted,
    "--theme-preview-surface-rgb": hexToRgbString(customSurface),
  } as CSSProperties;

  const customColorControls: Array<{
    key: CustomColorKey;
    label: string;
    value: string;
  }> = [
    { key: "customAccent", label: "强调色", value: customAccent },
    { key: "customSurface", label: "卡片底色", value: customSurface },
    { key: "customForeground", label: "主文字", value: customForeground },
    { key: "customMuted", label: "辅助文字", value: customMuted },
  ];

  return (
    <section className="page-shell profile-page">
      <header className="page-header">
        <span className="eyebrow">HLOVET Account</span>
        <div className="title-row">
          <div>
            <h1>个人中心</h1>
            <p>管理当前账号信息，并选择自己喜欢的门户主题。</p>
          </div>
          <div className="actions">
            <Link className="text-action" href="/dashboard">
              返回空间
            </Link>
          </div>
        </div>
      </header>

      <div className="status-row">
        <span className="status">
          {isLoading ? "正在读取身份" : user ? "已登录" : "未登录"}
        </span>
      </div>
      {error ? <p className="message error">{error}</p> : null}

      {user ? (
        <div className="profile-settings-grid">
          <div className="profile-panel account-card">
            <span className="section-label">当前账号</span>
            <strong>{user.username}</strong>
            <p>{user.email}</p>
            <span className="realm-badge">{user.role.name}</span>
          </div>

          <div className="identity-list account-facts">
            <div>
              <span>角色等级</span>
              <strong>{user.role.level}</strong>
            </div>
            <div>
              <span>超级管理员</span>
              <strong>{user.isSuperAdmin ? "是" : "否"}</strong>
            </div>
            <div>
              <span>账号状态</span>
              <strong>{user.status === "active" ? "启用" : "停用"}</strong>
            </div>
          </div>

          <section className="profile-panel theme-panel">
            <div className="panel-heading">
              <span className="section-label">主题外观</span>
              <strong>外观设置</strong>
              <p>
                主题会立即应用到当前浏览器。后续如果要跨设备同步，可以再接入账号级保存。
              </p>
            </div>

            <div className="theme-grid">
              {portalThemes.map((theme) => {
                const isActive = normalizedPreference.themeId === theme.id;

                return (
                  <button
                    aria-pressed={isActive}
                    className={`theme-option ${isActive ? "active" : ""}`}
                    key={theme.id}
                    onClick={() => selectRecommendedTheme(theme.id)}
                    type="button"
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {theme.swatches.map((swatch) => (
                        <span key={swatch} style={{ background: swatch }} />
                      ))}
                    </span>
                    <span className="theme-option-copy">
                      <strong>{theme.name}</strong>
                      <span>{theme.description}</span>
                    </span>
                    {isActive ? (
                      <span className="theme-selected">当前</span>
                    ) : null}
                  </button>
                );
              })}
              <button
                aria-pressed={normalizedPreference.themeId === "custom"}
                className={`theme-option custom-theme-option ${
                  normalizedPreference.themeId === "custom" ? "active" : ""
                }`}
                onClick={selectCustomTheme}
                type="button"
              >
                <span className="theme-swatches" aria-hidden="true">
                  {[customSurface, customForeground, customMuted, customAccent].map(
                    (swatch) => (
                      <span key={swatch} style={{ background: swatch }} />
                    ),
                  )}
                </span>
                <span className="theme-option-copy">
                  <strong>自定义配色</strong>
                  <span>使用下方颜色组件组合自己的主题。</span>
                </span>
                {normalizedPreference.themeId === "custom" ? (
                  <span className="theme-selected">当前</span>
                ) : null}
              </button>
            </div>

            <div className="appearance-settings-grid">
              <div className="theme-control-list">
                <label className="theme-control-row range-row">
                  <span>
                    <strong>卡片透明度</strong>
                    <small>{cardAlpha}%</small>
                  </span>
                  <input
                    aria-label="卡片透明度"
                    max={76}
                    min={38}
                    onChange={(event) =>
                      commitPreference({ cardAlpha: Number(event.target.value) })
                    }
                    type="range"
                    value={cardAlpha}
                  />
                </label>

                <label className="theme-control-row range-row">
                  <span>
                    <strong>磨砂程度</strong>
                    <small>{glassBlur}px</small>
                  </span>
                  <input
                    aria-label="磨砂程度"
                    max={36}
                    min={12}
                    onChange={(event) =>
                      commitPreference({ glassBlur: Number(event.target.value) })
                    }
                    type="range"
                    value={glassBlur}
                  />
                </label>
              </div>

              <div className="theme-control-list color-control-list">
                {customColorControls.map((control) => (
                  <label className="theme-control-row" key={control.key}>
                    <span>
                      <strong>{control.label}</strong>
                      <small>{control.value}</small>
                    </span>
                    <input
                      aria-label={`自定义${control.label}`}
                      onChange={(event) =>
                        updateCustomColor(control.key, event.target.value)
                      }
                      type="color"
                      value={control.value}
                    />
                  </label>
                ))}
              </div>

              <div className="theme-preview" style={previewStyle}>
                <span>Preview</span>
                <strong>HLOVET</strong>
                <p>
                  半透明卡片会叠在虚化背景上，主色用于高亮、徽章和文字操作。
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function hexToRgbString(value: string): string {
  const hexValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value.slice(1) : "ffffff";
  return [0, 2, 4]
    .map((index) => Number.parseInt(hexValue.slice(index, index + 2), 16))
    .join(", ");
}
