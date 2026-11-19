import { describe, expect, it } from 'vitest';
import { WEIGHT_SPECS, ZIP_ENTRY_FOR, extractWeights, packPolicy, unpackPolicy } from '../scripts/lib/pack.mjs';
import { readZipEntries } from '../scripts/lib/zip.mjs';
import { policyZip } from './helpers/assetFixtures';

const weights = () => extractWeights(readZipEntries(policyZip()));

describe('policy.bin', () => {
  it('maps zip entries 2 to 9 to the eight tensors with the shapes of Requirement 4.2', () => {
    expect(WEIGHT_SPECS.map((s) => `${s.name}:${s.shape.join('x')}`)).toEqual(
      ['W1:32x64', 'b1:32', 'W2:12x32', 'b2:12', 'Wih:256x47', 'Whh:256x64', 'bih:256', 'bhh:256']);
    expect(ZIP_ENTRY_FOR.W1).toBe('policy_lstm_1/data/2');
    expect(ZIP_ENTRY_FOR.bhh).toBe('policy_lstm_1/data/9');
    const w = weights();
    expect(w.W1![0]).toBeCloseTo(2, 5);
    expect(w.bhh![0]).toBeCloseTo(9, 5);
  });
  it('writes the commit, the gate order ifgo and 4-byte aligned offsets in the header', () => {
    const bytes = packPolicy(weights(), 'a'.repeat(40));
    const { header } = unpackPolicy(bytes);
    expect(header.commit).toBe('a'.repeat(40));
    expect(header.gateOrder).toBe('ifgo');
    expect(header.tensors.map((t) => t.name)).toEqual(WEIGHT_SPECS.map((s) => s.name));
    for (const t of header.tensors) {
      expect(t.offset % 4).toBe(0);
      expect(t.offset + t.bytes).toBeLessThanOrEqual(bytes.length);
    }
    expect(bytes.length).toBe(header.tensors.at(-1)!.offset + header.tensors.at(-1)!.bytes);
  });
  it('reads tensors back bit for bit', () => {
    const w = weights();
    const back = unpackPolicy(packPolicy(w, 'b'.repeat(40))).tensors;
    for (const s of WEIGHT_SPECS) expect(Array.from(back[s.name]!)).toEqual(Array.from(w[s.name]!));
  });
  it('names the entry with expected and actual bytes when a length is wrong', () => {
    const z = readZipEntries(policyZip({ shortEntry: 'policy_lstm_1/data/6' }));
    expect(() => extractWeights(z)).toThrow('policy_lstm_1/data/6 (Wih): expected 48128 bytes, got 48124 bytes');
  });
  it('names the entry when it is missing', () => {
    const z = readZipEntries(policyZip({ drop: 'policy_lstm_1/data/4' }));
    expect(() => extractWeights(z)).toThrow('policy archive is missing entry policy_lstm_1/data/4');
  });
  it('reads deflated entries too', () => {
    const w = extractWeights(readZipEntries(policyZip({ deflate: true })));
    expect(w.Wih!.length).toBe(256 * 47);
  });
});