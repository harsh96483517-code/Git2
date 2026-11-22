export type Theme = 'light' | 'dark' | 'system';
const KEY = 'gp_theme';
export const getTheme = (): Theme => {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage unavailable */ }
  return 'system';
};
export function applyTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
