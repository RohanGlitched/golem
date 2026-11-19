// Orbit camera with damping, limits from the model size, keyboard orbit and the `transition` render reason.
import type * as THREE_NS from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type Three = typeof THREE_NS;

export const DAMPING = 0.12;
export const KEY_ORBIT_DEG = 5;
export const SETTLE_M = 1e-4;

export interface OrbitDeps {
  scheduler: { acquire(r: 'transition'): void; release(r: 'transition'): void };
  reduced(): boolean;
  /** True when the press starts on a hero body: that press shoves and never orbits. */
  isOnBody(e: PointerEvent): boolean;
}

export interface Orbit {
  controls: OrbitControls;
  /** Called once per stage frame. Releases `transition` once the camera moved less than 0.1 mm. */
  update(): void;
  /** Shift + arrow: rotate by 5 degrees. Returns true when the key was handled. */
  key(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean;
  setLimits(radius: number, target: THREE_NS.Vector3): void;
  dispose(): void;
}

export function createOrbit(T: Three, camera: THREE_NS.PerspectiveCamera, dom: HTMLElement, deps: OrbitDeps): Orbit {
  let controls: OrbitControls | undefined;
  // Registered before OrbitControls adds its own listener, so it runs first.
  const onDown = (e: PointerEvent): void => { if (controls) controls.enabled = !deps.isOnBody(e); };
  const onUp = (): void => { if (controls) controls.enabled = true; };
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  const c = new OrbitControls(camera, dom);
  controls = c;
  c.enableDamping = !deps.reduced();
  c.dampingFactor = DAMPING;
  c.maxPolarAngle = Math.PI / 2 - 0.05;
  c.enablePan = false;
  c.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_ROTATE };
  const prev = new T.Vector3().copy(camera.position);
  let moving = false;
  const onChange = (): void => {
    if (!moving) { moving = true; deps.scheduler.acquire('transition'); }
  };
  c.addEventListener('change', onChange);
  c.addEventListener('start', onChange);
  const tmp = new T.Vector3();
  const zAxis = new T.Vector3(0, 0, 1);

  return {
    controls: c,
    update(): void {
      c.enableDamping = !deps.reduced();
      c.update();
      const travel = prev.distanceTo(camera.position);
      prev.copy(camera.position);
      if (moving && travel < SETTLE_M) { moving = false; deps.scheduler.release('transition'); }
    },
    key(e): boolean {
      if (!e.shiftKey) return false;
      const a = (KEY_ORBIT_DEG * Math.PI) / 180;
      tmp.copy(camera.position).sub(c.target);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        tmp.applyAxisAngle(zAxis, e.key === 'ArrowLeft' ? -a : a);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const horiz = new T.Vector3(tmp.x, tmp.y, 0);
        const axis = new T.Vector3(-horiz.y, horiz.x, 0).normalize();
        if (axis.lengthSq() === 0) return true;
        tmp.applyAxisAngle(axis, e.key === 'ArrowUp' ? -a : a);
      } else return false;
      camera.position.copy(c.target).add(tmp);
      onChange();
      c.update();
      return true;
    },
    setLimits(radius: number, target: THREE_NS.Vector3): void {
      c.minDistance = 0.8 * radius;
      c.maxDistance = 6 * radius;
      c.target.copy(target);
      c.update();
      prev.copy(camera.position);
    },
    dispose(): void {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      c.removeEventListener('change', onChange);
      c.removeEventListener('start', onChange);
      c.dispose();
      if (moving) { moving = false; deps.scheduler.release('transition'); }
    },
  };
}
