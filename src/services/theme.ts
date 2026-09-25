export type Appearance = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "ridetogether-appearance";
const LEGACY_SETTINGS_KEY = "ridetogether-settings";

const isAppearance = (value: unknown): value is Appearance =>
  value === "light" || value === "dark" || value === "system";

const readLegacyAppearance = (): Appearance => {
  try {
    const raw = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return "system";
    const saved = JSON.parse(raw) as { appearance?: unknown };
    return isAppearance(saved.appearance) ? saved.appearance : "system";
  } catch {
    return "system";
  }
};

export const readAppearance = (): Appearance => {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isAppearance(saved)) return saved;
  } catch {
    return readLegacyAppearance();
  }
  return readLegacyAppearance();
};

const getSystemAppearance = (): "light" | "dark" =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export const applyAppearance = (appearance: Appearance): void => {
  const resolved = appearance === "system" ? getSystemAppearance() : appearance;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = appearance;
  root.style.colorScheme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
};

export const saveAppearance = (appearance: Appearance): void => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, appearance);
  } catch {
    applyAppearance(appearance);
    return;
  }
  applyAppearance(appearance);
};

export const initializeAppearance = (): void => {
  applyAppearance(readAppearance());
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemChange = () => {
    if (readAppearance() === "system") applyAppearance("system");
  };
  media.addEventListener("change", handleSystemChange);
};
