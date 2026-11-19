import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AURA_FRAG, AuraView, TICK_VERT } from '../aura/aura-view.js';
import { AuraModel } from '../aura/aura-model.js';
import { TOKENS } from '../core/theme-tokens.js';

const deg = (d: number) => (d * Math.PI) / 180;

function view() {
  let requests = 0;
  const v = new AuraView(THREE, TOKENS.dark, { requestOnce: () => { requests++; } });
  return { v, requests: () => requests };
}

describe('AuraView', () => {
  it('uses a 36x1 linear texture that repeats on U', () => {
    const { v } = view();
    expect([v.texture.image.width, v.texture.image.height]).toEqual([36, 1]);
    expect(v.texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(v.texture.magFilter).toBe(THREE.LinearFilter);
    expect(v.texture.minFilter).toBe(THREE.LinearFilter);
    expect(v.texture.generateMipmaps).toBe(false);
  });
  it('requests one render per trial batch', () => {
    const { v, requests } = view();
    const m = new AuraModel(100);
    m.add(deg(5), 50, -1); m.add(deg(95), 80, 1);
    v.write(m);
    expect(requests()).toBe(1);
  });
  it('writes G = 255 for a bin with a break and a tick per broken trial', () => {
    const { v } = view();
    const m = new AuraModel(100);
    m.add(deg(5), 50, -1); m.add(deg(15), 80, 1);
    v.write(m);
    expect(v.texels[1]).toBe(255);
    expect(v.texels[5]).toBe(0);
    expect((v.ticks.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
  });
  it('draws no glow or shadow and discards unknown bins', () => {
    const { v } = view();
    expect(v.decal.castShadow || v.decal.receiveShadow).toBe(false);
    expect(AURA_FRAG).toMatch(/if \(aa <= 0\.002\) discard;/);
    expect(AURA_FRAG + TICK_VERT).not.toMatch(/time/i);
  });
  it('re-centres on the hero base', () => {
    const { v } = view();
    v.setCentre(1, -2);
    expect([v.group.position.x, v.group.position.y]).toEqual([1, -2]);
  });
});
