"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthUser, getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  portalThemes,
  readThemePreference,
  RecommendedThemeId,
  ThemePreference,
  writeThemePreference,
} from "@/lib/theme-preferences";

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

  const activeRecommendedTheme = useMemo(() => {
    return (
      portalThemes.find((theme) => theme.id === preference.themeId) ??
      portalThemes[0]
    );
  }, [preference.themeId]);

  const customAccent =
    preference.themeId === "custom"
      ? (preference.customAccent ?? "#db2777")
      : activeRecommendedTheme.swatches[2];
  const customCardAlpha =
    preference.themeId === "custom" ? (preference.customCardAlpha ?? 52) : 52;

  function selectRecommendedTheme(themeId: RecommendedThemeId) {
    const nextPreference: ThemePreference = { themeId };
    setPreference(nextPreference);
    writeThemePreference(nextPreference);
  }

  function updateCustomTheme(
    partialPreference:
      | Pick<ThemePreference, "customAccent">
      | Pick<ThemePreference, "customCardAlpha">,
  ) {
    const nextPreference: ThemePreference = {
      customAccent,
      customCardAlpha,
      themeId: "custom",
      ...partialPreference,
    };

    setPreference(nextPreference);
    writeThemePreference(nextPreference);
  }

  const previewStyle = {
    "--theme-preview-accent": customAccent,
    "--theme-preview-alpha": customCardAlpha / 100,
  } as CSSProperties;

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
              <strong>推荐主题</strong>
              <p>
                主题会立即应用到当前浏览器。后续如果要跨设备同步，可以再接入账号级保存。
              </p>
            </div>

            <div className="theme-grid">
              {portalThemes.map((theme) => {
                const isActive = preference.themeId === theme.id;

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
            </div>
          </section>

          <section className="profile-panel theme-panel custom-theme-panel">
            <div className="panel-heading">
              <span className="section-label">自定义</span>
              <strong>颜色与透明度</strong>
              <p>适合在推荐主题的基础上微调主色和卡片通透感。</p>
            </div>

            <div className="custom-theme-grid">
              <div className="theme-control-list">
                <label className="theme-control-row">
                  <span>
                    <strong>主色</strong>
                    <small>{customAccent}</small>
                  </span>
                  <input
                    aria-label="自定义主题主色"
                    onChange={(event) =>
                      updateCustomTheme({ customAccent: event.target.value })
                    }
                    type="color"
                    value={customAccent}
                  />
                </label>

                <label className="theme-control-row range-row">
                  <span>
                    <strong>卡片透明度</strong>
                    <small>{customCardAlpha}%</small>
                  </span>
                  <input
                    aria-label="自定义卡片透明度"
                    max={76}
                    min={38}
                    onChange={(event) =>
                      updateCustomTheme({
                        customCardAlpha: Number(event.target.value),
                      })
                    }
                    type="range"
                    value={customCardAlpha}
                  />
                </label>
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
