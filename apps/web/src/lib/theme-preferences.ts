export const THEME_STORAGE_KEY = "hlovet.theme.preference";
export const THEME_CHANGE_EVENT = "hlovet-theme-change";

export const portalThemes = [
  {
    id: "sakura-mist",
    name: "浅樱暖雾",
    description: "默认主题，柔和、浅色、适合长期使用。",
    swatches: ["#fff3f6", "#f7dce6", "#db2777"],
  },
  {
    id: "cloud-blue",
    name: "浅云蓝白",
    description: "更清爽的蓝白氛围，适合工具与导航密集页面。",
    swatches: ["#eef8ff", "#d6efff", "#0284c7"],
  },
  {
    id: "night-purple",
    name: "夜紫灰蓝",
    description: "偏夜色的紫灰蓝氛围，适合想要更沉静的视觉。",
    swatches: ["#ece8f8", "#9aa7bf", "#6d5bd0"],
  },
] as const;

export type RecommendedThemeId = (typeof portalThemes)[number]["id"];
export type ThemeId = RecommendedThemeId | "custom";

export interface ThemePreference {
  customAccent?: string;
  customForeground?: string;
  customMuted?: string;
  customSurface?: string;
  cardAlpha?: number;
  customCardAlpha?: number;
  glassBlur?: number;
  glassTint?: string;
  glassTintAlpha?: number;
  themeId: ThemeId;
}

export const defaultThemePreference: ThemePreference = {
  cardAlpha: 52,
  customAccent: "#db2777",
  customForeground: "#2b2530",
  customMuted: "#665867",
  customSurface: "#ffffff",
  glassBlur: 22,
  glassTint: "#fff3f6",
  glassTintAlpha: 72,
  themeId: "sakura-mist",
};

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return defaultThemePreference;
  }

  const rawValue = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (!rawValue) {
    return defaultThemePreference;
  }

  try {
    return normalizeThemePreference(
      JSON.parse(rawValue) as Partial<ThemePreference>,
    );
  } catch {
    return defaultThemePreference;
  }
}

export function writeThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedPreference = normalizeThemePreference(preference);
  window.localStorage.setItem(
    THEME_STORAGE_KEY,
    JSON.stringify(normalizedPreference),
  );
  applyThemePreference(normalizedPreference);
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, { detail: normalizedPreference }),
  );
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }

  const normalizedPreference = normalizeThemePreference(preference);
  const root = document.documentElement;
  root.dataset.portalTheme = normalizedPreference.themeId;

  root.style.removeProperty("--custom-accent");
  root.style.removeProperty("--custom-accent-strong");
  root.style.removeProperty("--custom-accent-soft");
  root.style.removeProperty("--custom-foreground");
  root.style.removeProperty("--custom-muted");
  root.style.removeProperty("--custom-muted-strong");
  root.style.removeProperty("--surface");
  root.style.removeProperty("--surface-strong");
  root.style.removeProperty("--surface-soft");
  root.style.removeProperty("--foreground");
  root.style.removeProperty("--muted");
  root.style.removeProperty("--muted-strong");
  root.style.removeProperty("--line");
  root.style.removeProperty("--line-strong");
  root.style.removeProperty("--control-line");

  const cardAlpha = normalizeCardAlpha(normalizedPreference.cardAlpha ?? 52);
  const glassBlur = normalizeGlassBlur(normalizedPreference.glassBlur ?? 22);
  const glassTint = normalizeHexColor(normalizedPreference.glassTint ?? "#fff3f6", "#fff3f6");
  const glassTintAlpha = normalizeGlassTintAlpha(normalizedPreference.glassTintAlpha ?? 72);
  const surface = normalizeHexColor(
    normalizedPreference.themeId === "custom"
      ? (normalizedPreference.customSurface ?? "#ffffff")
      : "#ffffff",
    "#ffffff",
  );
  const surfaceRgb = hexToRgb(surface);
  const glassTintRgb = hexToRgb(glassTint);

  root.style.setProperty("--glass-blur", `blur(${glassBlur}px) saturate(138%)`);
  root.style.setProperty(
    "--portal-bg-blur",
    `${Math.round(glassBlur * 0.92)}px`,
  );
  root.style.setProperty("--portal-bg-wash", `rgba(${glassTintRgb}, ${glassTintAlpha / 100})`);
  root.style.setProperty("--portal-bg-edge", `rgba(${hexToRgb(darkenHex(glassTint, 0.48))}, 0.16)`);
  root.style.setProperty(
    "--surface",
    `rgba(${surfaceRgb}, ${cardAlpha / 100})`,
  );
  root.style.setProperty(
    "--surface-strong",
    `rgba(${surfaceRgb}, ${Math.min(0.88, (cardAlpha + 10) / 100)})`,
  );
  root.style.setProperty(
    "--surface-soft",
    `rgba(${surfaceRgb}, ${Math.max(0.2, (cardAlpha - 14) / 100)})`,
  );

  if (normalizedPreference.themeId !== "custom") {
    return;
  }

  const accent = normalizeHexColor(
    normalizedPreference.customAccent ?? "#db2777",
    "#db2777",
  );
  const foreground = normalizeHexColor(
    normalizedPreference.customForeground ?? "#2b2530",
    "#2b2530",
  );
  const muted = normalizeHexColor(
    normalizedPreference.customMuted ?? "#665867",
    "#665867",
  );
  const accentRgb = hexToRgb(accent);
  const mutedRgb = hexToRgb(muted);
  const accentStrong = darkenHex(accent, 0.22);
  const mutedStrong = darkenHex(muted, 0.18);

  root.style.setProperty("--custom-accent", accent);
  root.style.setProperty("--custom-accent-strong", accentStrong);
  root.style.setProperty("--custom-accent-soft", `rgba(${accentRgb}, 0.12)`);
  root.style.setProperty("--foreground", foreground);
  root.style.setProperty("--muted", muted);
  root.style.setProperty("--muted-strong", mutedStrong);
  root.style.setProperty("--line", `rgba(${mutedRgb}, 0.16)`);
  root.style.setProperty("--line-strong", `rgba(${mutedRgb}, 0.24)`);
  root.style.setProperty("--control-line", `rgba(${mutedRgb}, 0.16)`);
}

export function normalizeThemePreference(
  preference: Partial<ThemePreference>,
): ThemePreference {
  const themeId =
    preference.themeId === "custom"
      ? "custom"
      : portalThemes.some((theme) => theme.id === preference.themeId)
    ? (preference.themeId as RecommendedThemeId)
    : defaultThemePreference.themeId;

  return {
    cardAlpha: normalizeCardAlpha(
      preference.cardAlpha ?? preference.customCardAlpha ?? 52,
    ),
    customAccent: normalizeHexColor(preference.customAccent ?? "#db2777", "#db2777"),
    customForeground: normalizeHexColor(
      preference.customForeground ?? "#2b2530",
      "#2b2530",
    ),
    customMuted: normalizeHexColor(preference.customMuted ?? "#665867", "#665867"),
    customSurface: normalizeHexColor(
      preference.customSurface ?? "#ffffff",
      "#ffffff",
    ),
    glassBlur: normalizeGlassBlur(preference.glassBlur ?? 22),
    glassTint: normalizeHexColor(preference.glassTint ?? "#fff3f6", "#fff3f6"),
    glassTintAlpha: normalizeGlassTintAlpha(preference.glassTintAlpha ?? 72),
    themeId,
  };
}

function normalizeHexColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function normalizeCardAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 52;
  }

  return Math.min(76, Math.max(38, Math.round(value)));
}

function normalizeGlassBlur(value: number): number {
  if (!Number.isFinite(value)) {
    return 22;
  }

  return Math.min(36, Math.max(0, Math.round(value)));
}

function normalizeGlassTintAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 72;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function hexToRgb(value: string): string {
  const hexValue = normalizeHexColor(value, "#db2777").slice(1);
  return [0, 2, 4]
    .map((index) => Number.parseInt(hexValue.slice(index, index + 2), 16))
    .join(", ");
}

function darkenHex(value: string, amount: number): string {
  const hexValue = normalizeHexColor(value, "#db2777").slice(1);
  const channels = [0, 2, 4].map((index) => {
    const channel = Number.parseInt(hexValue.slice(index, index + 2), 16);
    return Math.max(0, Math.min(255, Math.round(channel * (1 - amount))));
  });

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
