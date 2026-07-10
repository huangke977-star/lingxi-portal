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
  customCardAlpha?: number;
  themeId: ThemeId;
}

export const defaultThemePreference: ThemePreference = {
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
  root.style.removeProperty("--custom-card-alpha");
  root.style.removeProperty("--surface");
  root.style.removeProperty("--surface-strong");
  root.style.removeProperty("--surface-soft");

  if (normalizedPreference.themeId !== "custom") {
    return;
  }

  const accent = normalizeHexColor(
    normalizedPreference.customAccent ?? "#db2777",
  );
  const cardAlpha = normalizeCardAlpha(
    normalizedPreference.customCardAlpha ?? 52,
  );
  const accentRgb = hexToRgb(accent);
  const accentStrong = darkenHex(accent, 0.22);

  root.style.setProperty("--custom-accent", accent);
  root.style.setProperty("--custom-accent-strong", accentStrong);
  root.style.setProperty("--custom-accent-soft", `rgba(${accentRgb}, 0.12)`);
  root.style.setProperty("--custom-card-alpha", `${cardAlpha / 100}`);
  root.style.setProperty(
    "--surface",
    `rgba(255, 255, 255, ${cardAlpha / 100})`,
  );
  root.style.setProperty(
    "--surface-strong",
    `rgba(255, 255, 255, ${(cardAlpha + 8) / 100})`,
  );
  root.style.setProperty(
    "--surface-soft",
    `rgba(255, 255, 255, ${(cardAlpha - 12) / 100})`,
  );
}

export function normalizeThemePreference(
  preference: Partial<ThemePreference>,
): ThemePreference {
  if (preference.themeId === "custom") {
    return {
      customAccent: normalizeHexColor(preference.customAccent ?? "#db2777"),
      customCardAlpha: normalizeCardAlpha(preference.customCardAlpha ?? 52),
      themeId: "custom",
    };
  }

  const themeId = portalThemes.some((theme) => theme.id === preference.themeId)
    ? (preference.themeId as RecommendedThemeId)
    : defaultThemePreference.themeId;

  return { themeId };
}

function normalizeHexColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#db2777";
}

function normalizeCardAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 52;
  }

  return Math.min(76, Math.max(38, Math.round(value)));
}

function hexToRgb(value: string): string {
  const hexValue = normalizeHexColor(value).slice(1);
  return [0, 2, 4]
    .map((index) => Number.parseInt(hexValue.slice(index, index + 2), 16))
    .join(", ");
}

function darkenHex(value: string, amount: number): string {
  const hexValue = normalizeHexColor(value).slice(1);
  const channels = [0, 2, 4].map((index) => {
    const channel = Number.parseInt(hexValue.slice(index, index + 2), 16);
    return Math.max(0, Math.min(255, Math.round(channel * (1 - amount))));
  });

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
