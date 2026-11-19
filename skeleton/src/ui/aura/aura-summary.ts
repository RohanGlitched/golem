// One text line that says what the Aura shows, for people who cannot see the floor.
import { formatSig } from '../core/format.js';
import { AURA_BINS, binCentreDeg } from './aura-model.js';
import type { AuraModel } from './aura-model.js';

export const NO_AURA_TEXT = 'This requirement has no direction and force to map';
export const NO_TRIALS_TEXT = 'No trials yet';

/** `m` is undefined when the Aura_Source has no force or no direction dimension. */
export function auraSummary(m: AuraModel | undefined): string {
  if (!m) return NO_AURA_TEXT;
  let weak = -1;
  let strong = -1;
  for (let i = 0; i < AURA_BINS; i++) {
    const br = m.broke[i] as number;
    if (br !== Infinity && (weak < 0 || br < (m.broke[weak] as number))) weak = i;
    const h = m.held[i] as number;
    if (h !== -Infinity && (strong < 0 || h > (m.held[strong] as number))) strong = i;
  }
  if (weak >= 0) {
    return `Weakest direction ${binCentreDeg(weak)} deg: breaks at ${formatSig(m.broke[weak] as number, 3)} N`;
  }
  if (strong >= 0) {
    return `No break found. Strongest push held: ${formatSig(m.held[strong] as number, 3)} N at ${binCentreDeg(strong)} deg in ${m.total} trials`;
  }
  return NO_TRIALS_TEXT;
}
