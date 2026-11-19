// One injected <style> for the studio: tokens per theme, B612 faces, the grid, type scale and controls.
// No gradients, no drop shadows; elevation comes from --ground-2.
import { TOKENS } from '../core/theme-tokens.js';
import type { TokenSet } from '../types.js';

export const TYPE_SCALE = [13, 16, 20, 25, 31, 39, 61] as const;
export const FOCUS_RING_PX = 2;

function tokenBlock(t: TokenSet): string {
  return [
    `--ground:${t.ground}`, `--ground-2:${t.ground2}`, `--ink:${t.ink}`, `--ink-2:${t.ink2}`, `--clay:${t.clay}`,
    `--ghost:${t.ghost}`, `--break:${t.break}`, `--hold:${t.hold}`, `--break-text:${t.breakText}`, `--hold-text:${t.holdText}`,
    `--rule:color-mix(in srgb, var(--clay) 35%, transparent)`,
  ].join(';');
}

export function studioCss(fontBaseUrl = './fonts/'): string {
  const f = fontBaseUrl.endsWith('/') ? fontBaseUrl : `${fontBaseUrl}/`;
  const [s13, s16, s20, s25] = TYPE_SCALE;
  return `
@font-face{font-family:'B612';src:url('${f}B612-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:'B612';src:url('${f}B612-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
@font-face{font-family:'B612 Mono';src:url('${f}B612Mono-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:'Gloock';src:url('${f}Gloock-Regular.ttf') format('truetype');font-weight:400;font-display:swap}
.golem-studio[data-golem-theme='dark']{${tokenBlock(TOKENS.dark)};color-scheme:dark}
.golem-studio[data-golem-theme='light']{${tokenBlock(TOKENS.light)};color-scheme:light}
.golem-studio{box-sizing:border-box;background:var(--ground);color:var(--ink);font-family:'B612',system-ui,sans-serif;font-size:${s16}px;line-height:1.55;
  display:grid;grid-template-columns:380px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;
  grid-template-areas:"actions stage" "tablet stage" "verdict reel";height:100vh;height:100dvh;overflow:hidden;max-width:100%}
.golem-studio *,.golem-studio *::before,.golem-studio *::after{box-sizing:inherit}
.golem-studio :focus-visible{outline:${FOCUS_RING_PX}px solid var(--ink);outline-offset:2px}
.golem-sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.golem-actions{grid-area:actions;display:flex;flex-wrap:wrap;gap:8px;padding:16px 20px 12px;background:var(--ground-2);border-right:1px solid var(--rule)}
.golem-tablet{grid-area:tablet;overflow:auto;padding:4px 20px 20px;background:var(--ground-2);border-right:1px solid var(--rule)}
.golem-verdict{grid-area:verdict;padding:12px 20px 16px;background:var(--ground-2);border-right:1px solid var(--rule);border-top:1px solid var(--rule);font-size:${s13}px;max-height:40vh;overflow:auto}
.golem-main{grid-area:stage / stage / reel / reel;display:grid;grid-template-rows:minmax(0,1fr) auto;min-width:0;min-height:0}
.golem-stage{position:relative;min-height:0;background:var(--ground);border-radius:0;overflow:hidden}
.golem-stage::after{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 95% at 50% 42%,transparent 55%,rgba(0,0,0,.38) 100%)}
.golem-canvas{display:block;width:100%;height:100%;touch-action:pan-y}
.golem-stage-msg,.golem-stage-slow{position:absolute;left:20px;top:16px;max-width:60ch;color:var(--ink-2);font-size:${s13}px;pointer-events:none}
.golem-stage-slow{top:auto;bottom:12px}
.golem-stage-msg[hidden],.golem-stage-slow[hidden],.golem-shove-label[hidden]{display:none}
.golem-shove-label{position:absolute;left:0;top:0;padding:2px 6px;margin:-28px 0 0 8px;background:var(--ground-2);color:var(--ink);border:1px solid var(--rule);border-radius:2px;font-size:${s13}px;pointer-events:none}
.golem-reel{padding:12px 20px 16px;border-top:1px solid var(--rule);min-width:0;background:var(--ground)}
.golem-h{font-size:${s20}px;font-weight:700;line-height:1.3;margin:12px 0 8px}
.golem-group-h{font-size:${s16}px;font-weight:700;color:var(--ink-2);margin:16px 0 4px}
.golem-lines{list-style:none;margin:0;padding:0}
.golem-line{position:relative;padding:12px 0 12px 12px;border-left:2px solid transparent;border-bottom:1px solid var(--rule);max-width:72ch}
.golem-line-selected{border-left-color:var(--clay)}
.golem-line-head{display:flex;gap:8px;align-items:baseline}
.golem-line-id{font-family:inherit;font-variant-numeric:tabular-nums;font-size:${s13}px;color:var(--ink-2);background:transparent;border:0;border-radius:2px;padding:0 2px;cursor:pointer}
.golem-line-id:hover{color:var(--ink)}
.golem-narrow-only{display:none!important}
.golem-sentence{position:relative;margin:4px 0;font-size:${s16}px}
.golem-kw{font-size:.85em;letter-spacing:.04em}
.golem-num{font-family:'B612 Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.golem-q{display:inline-block;min-height:24px;padding:0 3px;text-decoration:underline dashed var(--clay);text-decoration-thickness:1px;text-underline-offset:4px;border-radius:2px;cursor:ew-resize;user-select:none;font-variant-numeric:tabular-nums}
.golem-q:hover{background:color-mix(in srgb, var(--clay) 18%, transparent)}
.golem-q-drag{background:color-mix(in srgb, var(--clay) 25%, transparent)}
.golem-q-input{font:inherit;color:var(--ink);background:var(--ground);border:1px solid var(--clay);border-radius:2px;padding:0 3px}
.golem-q-msg{display:block;color:var(--break-text);font-size:${s13}px}
.golem-fracture{position:absolute;left:-4px;right:8%;top:52%;height:1px;background:var(--break);transform:rotate(-1.2deg);transform-origin:left;pointer-events:none}
.golem-line-selected .golem-response{display:block;margin-top:2px;font-family:'Gloock',Georgia,serif;font-size:clamp(39px,3.4vw,61px);line-height:1.12;letter-spacing:0}
.golem-line-selected .golem-response .golem-q{min-height:0;text-underline-offset:8px}
.golem-w.golem-bind-tilt{display:inline-block;transform:rotate(calc(var(--golem-tilt,0) * 1deg));transform-origin:50% 85%}
.golem-bind{position:relative;display:inline-block}
.golem-bind::after{content:'';position:absolute;left:3px;right:3px;bottom:0;height:2px;transform-origin:left center;pointer-events:none}
.golem-bind-fuse::after{background:var(--ghost);transform:scaleX(var(--golem-fuse,0))}
.golem-bind-force::after{background:var(--ink);transform:scaleX(var(--golem-force,0))}
.golem-fracture-word{position:relative}
.golem-w.golem-fracture-word:not(.golem-bind-tilt){display:inline-block}
.golem-fracture.golem-fracture-at{left:-3px;right:-3px;top:56%;transform:rotate(-5deg);transform-origin:center}
.golem-fracture-margin{color:var(--break-text);font-size:${s13}px;vertical-align:middle;white-space:nowrap}
.golem-line-selected .golem-fracture-margin{font-size:${s16}px}
.golem-status{margin:4px 0 0;font-size:${s13}px;color:var(--ink-2)}
.golem-status-held .golem-status{color:var(--hold-text)}
.golem-status-broken .golem-status,.golem-status-error .golem-status{color:var(--break-text)}
.golem-margin{margin-left:4px}
.golem-stale{color:var(--ink-2)}
.golem-line-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.golem-btn{font:inherit;font-size:${s13}px;color:var(--ink);background:var(--ground-2);border:1px solid var(--rule);border-radius:2px;padding:4px 10px;min-height:28px;cursor:pointer}
.golem-btn:hover{border-color:var(--clay)}
.golem-btn:disabled{color:var(--ink-2);cursor:not-allowed;opacity:.7}
.golem-btn-primary{border-color:var(--clay);font-weight:700}
.golem-btn-quiet{background:transparent}
.golem-btn[aria-pressed='true']{border-color:var(--ink)}
.golem-note,.golem-empty{color:var(--ink-2);font-size:${s13}px;max-width:72ch}
.golem-diags{list-style:none;margin:6px 0 0;padding:0;font-size:${s13}px}
.golem-diags li{margin:2px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.golem-diag-error{color:var(--break-text)}
.golem-diag-warn{color:var(--ink-2)}
.golem-editor-box{position:relative}
.golem-editor-mirror,.golem-editor-text{font:inherit;font-size:${s16}px;line-height:1.55;padding:6px 8px;margin:0;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;border:1px solid transparent;border-radius:2px;width:100%}
.golem-editor-mirror{position:absolute;inset:0;color:transparent;pointer-events:none}
.golem-editor-text{position:relative;display:block;resize:vertical;background:transparent;color:var(--ink);border-color:var(--clay)}
.golem-wavy{background:none;color:transparent;text-decoration:underline wavy var(--break);text-decoration-thickness:1px;text-underline-offset:3px}
.golem-rows{display:grid;grid-template-columns:auto auto;gap:2px 16px;margin:0}
.golem-rows>div{display:contents}
.golem-rows dt{color:var(--ink-2)}
.golem-rows dd{margin:0;text-align:right}
.golem-aura-summary,.golem-sentence-small{margin:8px 0 0;max-width:72ch}
.golem-reel-strip{display:flex;gap:8px;overflow-x:auto;max-width:100%;padding-bottom:4px}
.golem-frame{flex:0 0 auto;margin:0;text-align:center;font-size:${s13}px;color:var(--ink-2)}
.golem-frame canvas{display:block;width:120px;height:90px;border:1px solid var(--rule);background:var(--ground)}
.golem-frame-worst canvas{border-color:var(--break)}
.golem-reel-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.golem-scrubber{position:relative;flex:1 1 200px;min-width:120px}
.golem-scrubber input{width:100%;accent-color:var(--clay)}
.golem-scrub-tick{position:absolute;top:0;width:2px;height:6px;background:var(--break);pointer-events:none}
.golem-seed-field{width:100%;max-width:60ch;font-family:'B612 Mono',ui-monospace,monospace;font-size:${s13}px;color:var(--ink);background:var(--ground-2);border:1px solid var(--rule)}
.golem-pins{list-style:none;padding:0;margin:8px 0 0;font-size:${s13}px}
.golem-panel-error{padding:12px 20px;color:var(--break-text)}
.golem-messages{list-style:none;margin:0;padding:0 20px;font-size:${s13}px;color:var(--ink-2)}
@media (max-width:1023.98px){
  .golem-studio{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:none;grid-template-areas:"stage" "actions" "tablet" "reel" "verdict";height:auto;overflow:visible}
  .golem-main{display:contents}
  .golem-stage{grid-area:stage;height:56vh}
  .golem-reel{grid-area:reel}
  .golem-actions,.golem-tablet,.golem-verdict{border-right:0}
  .golem-tablet{overflow:visible}
  .golem-verdict{max-height:none}
  .golem-btn,.golem-line-id{min-height:44px;min-width:44px}
  .golem-narrow-only{display:inline-block!important}
  .golem-wide-only{display:none!important}
  .golem-q{padding:10px 4px;margin:-10px 0;line-height:24px}
  .golem-sentence{font-size:${s16}px}
  .golem-h{font-size:${s20}px}
}
@media (min-width:1024px){.golem-sentence{font-size:${s16}px}.golem-line-selected .golem-sentence{font-size:${s20}px}}
@media (min-width:1440px){.golem-line-selected .golem-sentence{font-size:${s25}px;line-height:1.4}}
`;
}
