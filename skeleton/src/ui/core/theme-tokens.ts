// Theme tokens (design-language.md) and WCAG 2.2 contrast.
import type { ThemeName, TokenSet } from '../types.js';

export const TOKENS: Record<ThemeName, TokenSet> = {
  dark: {
    ground: '#2A211C', ground2: '#342923', ink: '#EDE6DC', ink2: '#B8AC9E', clay: '#C9B59C',
    ghost: '#D6F1F2', break: '#D0452F', hold: '#86BFA6', breakText: '#DA7D6C', holdText: '#86BFA6',
  },
  light: {
    ground: '#D6D6D2', ground2: '#E3E3DF', ink: '#1F1B18', ink2: '#55504A', clay: '#A88E73',
    ghost: '#4B44A6', break: '#A8311F', hold: '#2F7560', breakText: '#A8311F', holdText: '#2C6352',
  },
};

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Text pairs the studio uses, with their minimum contrast. */
export const TEXT_PAIRS: { fg: keyof TokenSet; bg: keyof TokenSet; min: number }[] = [
  { fg: 'ink', bg: 'ground', min: 7 },
  { fg: 'ink', bg: 'ground2', min: 7 },
  { fg: 'ink2', bg: 'ground', min: 4.5 },
  { fg: 'breakText', bg: 'ground', min: 4.5 },
  { fg: 'breakText', bg: 'ground2', min: 4.5 },
  { fg: 'holdText', bg: 'ground', min: 4.5 },
  { fg: 'holdText', bg: 'ground2', min: 4.5 },
];
