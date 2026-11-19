// The Summoning Circle: the home page hero. A clay Unitree G1 stands in the dark, its requirement written
// around it on the floor. The ring of text bends to the robot's measured safety margin in each direction,
// and cracks where pushes from that side topple it. Scrolling replays a real recorded campaign: one ghost
// per direction is shoved and either recovers or falls outward, leaving a light trail. No physics runs
// here: poses come from real MuJoCo trials recorded by site/scripts/hero-pack.mts (golem-spec).
import * as THREE from 'three';

interface Slice { off: number; len: number }
interface PackGeom { body: number; pos: number[]; quat: number[]; verts: Slice; index: Slice }
interface PackTrial { idle?: boolean; angleDeg: number; force: number; robustness: number; worstAt: number; fell: boolean; frames: number; fps: number; poses: Slice }
interface Pack { nbody: number; fps: number; warmup: number; force: number; phase: number; geoms: PackGeom[]; trials: PackTrial[] }

export interface CircleOptions {
  base: string;                      // folder holding pack.json and pack.bin
  line: string;                      // the EARS line inscribed on the floor
  onProgress?: (p: number) => void;  // scroll progress 0..1, for captions
  reduced?: boolean;
}

const CLAY = 0xc9b59c, GROUND = 0x1d1714, GHOST = new THREE.Color('#d6f1f2'), BREAK = new THREE.Color('#d0452f'), HOLD = '#86bfa6';
const RING_R = 1.45;            // m, radius of the inscription
const ROOT = 1;                 // body 1 is the pelvis (body 0 is the world)

const GHOST_VERT = /* glsl */ `
attribute vec2 aState;           // x: break mix, y: opacity
varying vec3 vN; varying vec3 vV; varying vec2 vS;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vS = aState;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GHOST_FRAG = /* glsl */ `
uniform vec3 uGhost; uniform vec3 uBreak;
varying vec3 vN; varying vec3 vV; varying vec2 vS;
void main() {
  if (vS.y < 0.003) discard;
  float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 3.0);
  vec3 c = mix(uGhost, uBreak, vS.x);
  gl_FragColor = vec4(c, vS.y * (0.05 + 0.95 * rim));
}`;

function quatWXYZ(q: number[], out: THREE.Quaternion): THREE.Quaternion { return out.set(q[1]!, q[2]!, q[3]!, q[0]!); }

export async function mountCircle(el: HTMLElement, o: CircleOptions): Promise<{ dispose(): void }> {
  const [pack, bin] = await Promise.all([
    fetch(o.base + 'pack.json').then((r) => r.json() as Promise<Pack>),
    fetch(o.base + 'pack.bin').then((r) => r.arrayBuffer()),
  ]);
  const f32 = (s: Slice) => new Float32Array(bin, s.off, s.len);
  const u16 = (s: Slice) => new Uint16Array(bin, s.off, s.len);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(GROUND);
  el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(GROUND, 6, 14);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);
  camera.up.set(0, 0, 1);

  // ---- light: a dim night, and a lantern that follows the pointer
  scene.add(new THREE.HemisphereLight(0x6e7d8c, 0x1a120d, 0.35));
  const lantern = new THREE.SpotLight(0xffe2b8, 38, 9, Math.PI / 5, 0.65, 1.6);
  lantern.position.set(1.2, -1.6, 3.4);
  lantern.castShadow = true;
  lantern.shadow.mapSize.set(1024, 1024);
  lantern.shadow.bias = -0.0005;
  scene.add(lantern, lantern.target);
  const rim = new THREE.DirectionalLight(0x9fb7c9, 0.55);
  rim.position.set(-3, 2.5, 2.2);
  scene.add(rim);

  // ---- floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 0.96, metalness: 0 }));
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- geometry shared by the clay hero and the ghosts
  const geos = pack.geoms.map((g) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(f32(g.verts), 3));
    geo.setIndex(new THREE.BufferAttribute(u16(g.index), 1));
    geo.computeVertexNormals();
    return geo;
  });
  const local = pack.geoms.map((g) => new THREE.Matrix4().compose(new THREE.Vector3(...(g.pos as [number, number, number])), quatWXYZ(g.quat, new THREE.Quaternion()), new THREE.Vector3(1, 1, 1)));

  // ---- trials: poses re-centred so every trial starts its push at the circle's centre
  const nb = pack.nbody;
  // Pose frames start at the trigger, so frame 0 is where every push begins.
  const all = pack.trials.map((t) => {
    const p = f32(t.poses);
    const k = ROOT * 7;
    return { ...t, p, ox: p[k]!, oy: p[k + 1]! };
  });
  const T = all.find((t) => t.idle) ?? all[0]!;
  const trials = all.filter((t) => !t.idle);
  const tTrig = 0;
  // The robot walks forward at 0.5 m/s; subtract that common drift (from the idle walk) so a ghost's
  // position shows only what the push did to it.
  const drift = (t: number): [number, number] => {
    const f = Math.max(0, Math.min(T.frames - 1, Math.round(t * T.fps))) * nb * 7 + ROOT * 7;
    return [T.p[f]! - T.ox, T.p[f + 1]! - T.oy];
  };
  const tEnd = (trials[0]!.frames - 1) / trials[0]!.fps;

  const bodyM = Array.from({ length: nb }, () => new THREE.Matrix4());
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function poseAt(tr: (typeof trials)[number], t: number, inPlace: boolean): void {
    const f = Math.max(0, Math.min(tr.frames - 1, t * tr.fps));
    const f0 = Math.floor(f), f1 = Math.min(tr.frames - 1, f0 + 1), a = f - f0;
    const r0 = f0 * nb * 7 + ROOT * 7, r1 = f1 * nb * 7 + ROOT * 7;
    const d = inPlace ? [0, 0] : drift(t);
    const cx = inPlace ? tr.p[r0]! * (1 - a) + tr.p[r1]! * a : tr.ox + d[0]!;
    const cy = inPlace ? tr.p[r0 + 1]! * (1 - a) + tr.p[r1 + 1]! * a : tr.oy + d[1]!;
    for (let b = 0; b < nb; b++) {
      const i0 = f0 * nb * 7 + b * 7, i1 = f1 * nb * 7 + b * 7, P = tr.p;
      tmpV.set(P[i0]! + (P[i1]! - P[i0]!) * a - cx, P[i0 + 1]! + (P[i1 + 1]! - P[i0 + 1]!) * a - cy, P[i0 + 2]! + (P[i1 + 2]! - P[i0 + 2]!) * a);
      tmpQ.set(P[i0 + 4]!, P[i0 + 5]!, P[i0 + 6]!, P[i0 + 3]!);
      const q1 = new THREE.Quaternion(P[i1 + 4]!, P[i1 + 5]!, P[i1 + 6]!, P[i1 + 3]!);
      tmpQ.slerp(q1, a);
      bodyM[b]!.compose(tmpV, tmpQ, one);
    }
  }

  // ---- the clay hero
  const clay = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.82, metalness: 0 });
  const hero = new THREE.Group();
  const heroMeshes = geos.map((g) => { const m = new THREE.Mesh(g, clay); m.castShadow = true; m.matrixAutoUpdate = false; hero.add(m); return m; });
  scene.add(hero);
  function placeHero(t: number): void {
    poseAt(T, t, true);
    heroMeshes.forEach((m, i) => m.matrix.multiplyMatrices(bodyM[pack.geoms[i]!.body]!, local[i]!));
  }

  // ---- the ghosts: one instance per trial and geom
  const ghostMat = new THREE.ShaderMaterial({
    vertexShader: GHOST_VERT, fragmentShader: GHOST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uGhost: { value: GHOST }, uBreak: { value: BREAK } },
  });
  const n = trials.length;
  const state = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const ghosts = geos.map((g) => {
    const gg = g.clone();
    gg.setAttribute('aState', state);
    const im = new THREE.InstancedMesh(gg, ghostMat, n);
    im.frustumCulled = false;
    scene.add(im);
    return im;
  });
  const instM = new THREE.Matrix4();
  function placeGhosts(t: number, opacity: number): void {
    trials.forEach((tr, k) => {
      poseAt(tr, t, false);
      ghosts.forEach((im, i) => { instM.multiplyMatrices(bodyM[pack.geoms[i]!.body]!, local[i]!); im.setMatrixAt(k, instM); });
      const fallen = tr.fell && t > Math.max(0.3, tr.worstAt - pack.warmup - 0.7);
      state.setXY(k, fallen ? 1 : 0, opacity * (fallen ? 1 : 0.16));
    });
    ghosts.forEach((im) => { im.instanceMatrix.needsUpdate = true; });
    state.needsUpdate = true;
  }

  // ---- light trails: each ghost's pelvis path after the push
  const trailGeo = new THREE.BufferGeometry();
  const trailSteps = 48;
  const tp = new Float32Array(n * trailSteps * 2 * 3), tc = new Float32Array(n * trailSteps * 2 * 3);
  trials.forEach((tr, k) => {
    for (let s = 0; s < trailSteps; s++) {
      for (let e = 0; e < 2; e++) {
        const t = tTrig + ((tEnd - tTrig) * (s + e)) / trailSteps;
        const f = Math.min(tr.frames - 1, Math.round(t * tr.fps)) * nb * 7 + ROOT * 7;
        const o = ((k * trailSteps + s) * 2 + e) * 3;
        const dd = drift(t);
        tp[o] = tr.p[f]! - tr.ox - dd[0]; tp[o + 1] = tr.p[f + 1]! - tr.oy - dd[1]; tp[o + 2] = Math.max(0.02, tr.p[f + 2]! * 0.18);
        const c = tr.fell ? BREAK : GHOST;
        tc[o] = c.r; tc[o + 1] = c.g; tc[o + 2] = c.b;
      }
    }
  });
  trailGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const trails = new THREE.LineSegments(trailGeo, trailMat);
  scene.add(trails);

  // ---- the inscription: the requirement written around the robot. Where a ghost falls, the floor cracks from
  // its body out through the sentence, and the letters it crosses break red.
  const landing = trials.filter((t) => t.fell).map((tr) => {
    // the fallen pelvis at the end of the trial, minus the common walking drift
    const fEnd = (tr.frames - 1) * nb * 7 + ROOT * 7, dd = drift(tEnd);
    const x = tr.p[fEnd]! - tr.ox - dd[0], y = tr.p[fEnd + 1]! - tr.oy - dd[1];
    let tLand = tEnd;
    for (let f = 0; f < tr.frames; f++) if (tr.p[f * nb * 7 + ROOT * 7 + 2]! < 0.42) { tLand = f / tr.fps; break; }
    return { az: Math.atan2(y, x), dist: Math.hypot(x, y), tLand };
  });
  const tCrack = landing.length ? Math.min(...landing.map((l) => l.tLand)) : Infinity;
  const SIZE = 2048;
  const px = (r: number) => (r / (RING_R * 1.42)) * (SIZE / 2);
  const C = SIZE / 2;
  const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const drawRing = (cracked: boolean): THREE.CanvasTexture => {
    const cv = document.createElement('canvas');
    cv.width = SIZE; cv.height = SIZE;
    const g2 = cv.getContext('2d')!;
    const near = (a: number) => cracked && landing.some((l) => angDist(a, l.az) < 0.2);
    // the inner line of the circle, broken where the floor cracked
    g2.lineWidth = 3; g2.strokeStyle = HOLD; g2.globalAlpha = 0.7;
    g2.beginPath();
    let pen = false;
    for (let d = 0; d <= 360; d += 1) {
      const a = (d * Math.PI) / 180, r = px(RING_R - 0.2);
      if (near(a)) { pen = false; continue; }
      const x = C + r * Math.cos(a), y = C - r * Math.sin(a);
      if (!pen) { g2.moveTo(x, y); pen = true; } else g2.lineTo(x, y);
    }
    g2.stroke(); g2.globalAlpha = 1;
    // tick marks at the recorded directions
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      if (near(a)) continue;
      g2.strokeStyle = 'rgba(201,181,156,0.45)'; g2.lineWidth = 2;
      g2.beginPath(); g2.moveTo(C + px(RING_R - 0.12) * Math.cos(a), C - px(RING_R - 0.12) * Math.sin(a)); g2.lineTo(C + px(RING_R - 0.06) * Math.cos(a), C - px(RING_R - 0.06) * Math.sin(a)); g2.stroke();
    }
    // the fissures: jagged lines from each fallen body out through the ring, with a few branches
    if (cracked) {
      g2.strokeStyle = '#e0573f'; g2.lineCap = 'round'; g2.lineJoin = 'round';
      landing.forEach((l, j) => {
        const crack = (a0: number, r0: number, r1: number, w: number, seed: number): void => {
          g2.lineWidth = w; g2.beginPath();
          const steps = 22;
          for (let s2 = 0; s2 <= steps; s2++) {
            const r = r0 + ((r1 - r0) * s2) / steps;
            const a = a0 + Math.sin(s2 * 2.3 + seed) * 0.045 + Math.sin(s2 * 5.1 + seed * 3) * 0.02;
            const x = C + px(r) * Math.cos(a), y = C - px(r) * Math.sin(a);
            if (s2 === 0) g2.moveTo(x, y); else g2.lineTo(x, y);
          }
          g2.stroke();
        };
        g2.globalAlpha = 0.95;
        crack(l.az, Math.max(0.35, l.dist * 0.8), RING_R + 0.16, 5, j * 7.1);
        g2.globalAlpha = 0.7;
        crack(l.az + 0.12, RING_R - 0.5, RING_R + 0.08, 2.5, j * 3.3 + 1);
        crack(l.az - 0.1, RING_R - 0.35, RING_R + 0.1, 2, j * 5.7 + 2);
        g2.globalAlpha = 1;
      });
    }
    // the sentence around the ring, starting at the front of the robot and running counterclockwise
    const text = `${o.line.toUpperCase().replace(/\s+/g, ' ')}  ·  `;
    g2.font = `600 ${Math.round(SIZE * 0.021)}px 'B612', 'Segoe UI', sans-serif`;
    g2.textBaseline = 'middle';
    const rText = px(RING_R);
    let ang = -Math.PI / 2;
    const circ = 2 * Math.PI * rText;
    const reps = Math.max(1, Math.floor(circ / g2.measureText(text).width));
    const full = text.repeat(reps);
    const scale = circ / g2.measureText(full).width;
    for (const ch of full) {
      const w = g2.measureText(ch).width * scale;
      const mid = ang + w / (2 * rText);
      const broke = near(mid);
      g2.save();
      g2.translate(C + rText * Math.cos(mid), C - rText * Math.sin(mid));
      g2.rotate(-mid - Math.PI / 2);
      g2.fillStyle = broke ? '#e0573f' : '#e9dfd1';
      g2.globalAlpha = broke ? 1 : 0.72;
      if (broke) { g2.translate(0, Math.sin(mid * 37) * 9); g2.rotate(Math.sin(mid * 53) * 0.35); }
      g2.fillText(ch, -w / 2, 0);
      g2.restore();
      ang += w / rText;
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };
  const ringGeo = new THREE.PlaneGeometry(RING_R * 2.84, RING_R * 2.84);
  const ringMat = new THREE.MeshBasicMaterial({ map: drawRing(false), transparent: true, depthWrite: false, toneMapped: false });
  const crackMat = new THREE.MeshBasicMaterial({ map: drawRing(true), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  const ringCracked = new THREE.Mesh(ringGeo, crackMat);
  ring.position.z = 0.004; ringCracked.position.z = 0.005;
  scene.add(ring, ringCracked);

  // ---- pointer lantern
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const aim = new THREE.Vector3(0.2, -0.2, 0), aimGoal = aim.clone();
  const onMove = (e: PointerEvent): void => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) aimGoal.set(Math.max(-2.2, Math.min(2.2, hit.x)), Math.max(-2.2, Math.min(2.2, hit.y)), 0);
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  // ---- scroll timeline
  let progress = 0;
  const section = el.closest('[data-circle-scroll]') as HTMLElement | null;
  const readScroll = (): void => {
    if (!section) return;
    const r = section.getBoundingClientRect();
    const span = Math.max(1, r.height - window.innerHeight);
    progress = Math.max(0, Math.min(1, -r.top / span));
  };
  window.addEventListener('scroll', readScroll, { passive: true });

  const resize = (): void => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  const ease = (x: number) => x * x * (3 - 2 * x);
  const span = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)));
  let raf = 0, last = performance.now(), idle = 0, visible = true;
  // stop drawing while the circle is scrolled out of view
  const io = new IntersectionObserver(([e]) => {
    const was = visible; visible = !!e?.isIntersecting;
    if (visible && !was) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  io.observe(el);
  const frame = (now: number): void => {
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    idle = (idle + dt) % Math.max(0.5, (T.frames - 2) / T.fps);
    readScroll();
    const p = o.reduced ? 1 : progress;
    o.onProgress?.(p);
    // camera: low three-quarter view, rising to look down on the circle
    const up = ease(span(p, 0.72, 1));
    const az = 0.95 - 0.35 * ease(span(p, 0.1, 0.9)), el2 = 0.33 + 0.85 * up, dist = 4.6 + 1.2 * up;
    camera.position.set(dist * Math.cos(el2) * Math.cos(az), dist * Math.cos(el2) * Math.sin(az), 0.75 + dist * Math.sin(el2));
    const wide = camera.aspect > 1.2 ? 1 : 0;
    camera.lookAt(0, 0, 0.55 * (1 - up));
    camera.setViewOffset(el.clientWidth, el.clientHeight, wide ? -el.clientWidth * 0.2 : 0, 0, el.clientWidth, el.clientHeight);
    // the hero walks in place until the ghosts take over
    const swarm = ease(span(p, 0.12, 0.22));
    const tGhost = tEnd * span(p, 0.22, 0.8);
    placeHero(idle);
    hero.visible = swarm < 0.98;
    clay.opacity = 1 - swarm; clay.transparent = swarm > 0;
    placeGhosts(tGhost, swarm);
    trailMat.opacity = 0.9 * ease(span(p, 0.55, 0.9));
    const crack = ease(Math.max(0, Math.min(1, (tGhost - tCrack) / 0.4)));
    crackMat.opacity = crack; ringMat.opacity = 1 - 0.85 * crack;
    // lantern follows the pointer softly
    aim.lerp(aimGoal, 1 - Math.exp(-dt * 4));
    lantern.target.position.copy(aim);
    lantern.position.set(aim.x + 1.4 * Math.cos(az), aim.y + 1.4 * Math.sin(az), 3.4);
    renderer.render(scene, camera);
    if (!el.dataset.ready) el.dataset.ready = '1';
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    dispose(): void {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      window.removeEventListener('pointermove', onMove); window.removeEventListener('scroll', readScroll);
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
