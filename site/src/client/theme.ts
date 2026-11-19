// Theme store: dark by default, a light toggle, saved under the studio's own key so both agree.
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'golem:theme';

export function readTheme(doc: Document = document): Theme {
  return doc.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, save: boolean, doc: Document = document): void {
  doc.documentElement.setAttribute('data-theme', theme);
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#D6D6D2' : '#2A211C');
  if (save) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* blocked storage: the choice lasts for this page */ }
  }
  doc.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((b) => {
    b.textContent = theme === 'light' ? 'Dark' : 'Light';
    b.setAttribute('aria-label', theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme');
  });
  doc.dispatchEvent(new CustomEvent('golem-theme', { detail: theme }));
}

export function initTheme(doc: Document = document): void {
  applyTheme(readTheme(doc), false, doc);
  doc.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.addEventListener('click', () => applyTheme(readTheme(doc) === 'light' ? 'dark' : 'light', true, doc));
  });
}
