// Theme: saved choice, then the system preference, then options.theme, then dark.
import { TOKENS } from '../core/theme-tokens.js';
import type { ThemeName, TokenSet } from '../types.js';

export const THEME_KEY = 'golem:theme';

type MQ = { matches: boolean; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };

export interface ThemeDeps {
  storage?: Storage | undefined;
  matchMedia?: ((q: string) => MQ) | undefined;
  initial?: ThemeName | undefined;
  /** Writes data-golem-theme, updates the stage uniforms and requests one render. */
  apply(theme: ThemeName, tokens: TokenSet): void;
}

export class ThemeController {
  theme: ThemeName;
  private saved: ThemeName | undefined;
  private readonly light: MQ | undefined;
  private readonly dark: MQ | undefined;
  private readonly onSystem = (): void => { if (this.saved === undefined) this.set(this.fromSystem() ?? this.d.initial ?? 'dark', false); };

  constructor(private readonly d: ThemeDeps) {
    let s: string | null = null;
    try { s = d.storage?.getItem(THEME_KEY) ?? null; } catch { s = null; }
    this.saved = s === 'dark' || s === 'light' ? s : undefined;
    this.light = d.matchMedia?.('(prefers-color-scheme: light)');
    this.dark = d.matchMedia?.('(prefers-color-scheme: dark)');
    this.light?.addEventListener?.('change', this.onSystem);
    this.dark?.addEventListener?.('change', this.onSystem);
    this.theme = this.saved ?? this.fromSystem() ?? d.initial ?? 'dark';
    d.apply(this.theme, TOKENS[this.theme]);
  }

  private fromSystem(): ThemeName | undefined {
    if (this.light?.matches) return 'light';
    if (this.dark?.matches) return 'dark';
    return undefined;
  }

  private set(t: ThemeName, save: boolean): void {
    if (save) {
      this.saved = t;
      try { this.d.storage?.setItem(THEME_KEY, t); } catch { /* the choice lives in memory */ }
    }
    if (t === this.theme) return;
    this.theme = t;
    this.d.apply(t, TOKENS[t]);
  }

  toggle(): ThemeName { this.set(this.theme === 'dark' ? 'light' : 'dark', true); return this.theme; }

  dispose(): void {
    this.light?.removeEventListener?.('change', this.onSystem);
    this.dark?.removeEventListener?.('change', this.onSystem);
  }
}
