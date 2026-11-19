// Photograph: renders the stage once at twice its CSS size, copies it to a 2D canvas, sets the requirement in the
// lower-left corner and downloads a PNG. The copy happens in the same task as the render, so the WebGL canvas
// needs no preserveDrawingBuffer.
import { photoLayout } from '../core/photo.js';
import type { Renderer } from '../stage/stage.js';
import type { TokenSet } from '../types.js';

export const PHOTO_SCALE = 2;

export interface PhotoDeps {
  renderer: Renderer;
  /** Renders scene and camera once with the renderer. */
  render(): void;
  canvas: HTMLCanvasElement;
  tokens: TokenSet;
  id: string;
  text: string;
  note?: string;
  fileName: string;
  /** Test seam: receives the PNG instead of a download. */
  save?(blob: Blob, fileName: string): void;
}

export async function savePhotograph(d: PhotoDeps): Promise<{ width: number; height: number } | undefined> {
  const doc = d.canvas.ownerDocument;
  const w = Math.max(1, d.canvas.clientWidth || d.canvas.width), h = Math.max(1, d.canvas.clientHeight || d.canvas.height);
  const prev = d.renderer.getPixelRatio?.() ?? 1;
  const out = doc.createElement('canvas');
  out.width = PHOTO_SCALE * w;
  out.height = PHOTO_SCALE * h;
  const g = out.getContext('2d');
  if (!g) return undefined;
  try {
    d.renderer.setPixelRatio(PHOTO_SCALE);
    d.renderer.setSize(w, h, false);
    d.render();
    g.drawImage(d.canvas, 0, 0, out.width, out.height);
  } finally {
    d.renderer.setPixelRatio(prev);
    d.renderer.setSize(w, h, false);
    d.render();
  }
  try { await (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* no font loading API */ }
  const lines = photoLayout({
    width: out.width, height: out.height, scale: PHOTO_SCALE, id: d.id, text: d.text, ...(d.note ? { note: d.note } : {}),
    measure: (t, f) => { g.font = f; return g.measureText(t).width; },
  });
  g.textBaseline = 'alphabetic';
  for (const l of lines) {
    g.font = l.font;
    g.fillStyle = l.ink === 'ink' ? d.tokens.ink : d.tokens.ink2;
    g.fillText(l.text, l.x, l.y);
  }
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
  if (!blob) return undefined;
  if (d.save) d.save(blob, d.fileName);
  else {
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = d.fileName;
    a.hidden = true;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { width: out.width, height: out.height };
}
