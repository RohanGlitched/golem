// Runs on every page: the theme toggle and the copy buttons. No framework.
import { initTheme } from './theme';

initTheme();

document.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('button.copy');
  if (!btn) return;
  const code = btn.parentElement?.querySelector('code')?.textContent ?? '';
  const done = (ok: boolean): void => {
    btn.textContent = ok ? 'Copied' : 'Select and copy';
    window.setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(() => done(true), () => done(false));
  else done(false);
});
