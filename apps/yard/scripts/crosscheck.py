"""An independent re-measurement of the yard roses, with MuJoCo's Python bindings instead of GOLEM's WASM build.

    pip install mujoco==3.3.7 numpy
    python apps/yard/scripts/crosscheck.py > apps/yard/crosscheck.txt

It shares nothing with GOLEM but the scene files: its own keyframe loading, its own push and its own upright test, written
from the glossary of .kiro/specs/stand-push/requirements.md (base above 60% of its standing height and tilted less than
45 deg; a push for 0.2 s after a 1.5 s warm-up, judged over the next 3 s). For four directions it bisects the smallest
push, as a share of the robot's weight, that topples the robot, and prints it next to the rose in board.json.
"""
import json
import math
from pathlib import Path

import mujoco
import numpy as np

YARD = Path(__file__).resolve().parent.parent
META = json.loads((YARD / 'robots.json').read_text())
BOARD = json.loads((YARD / 'board.json').read_text())
WARMUP, PUSH, AFTER = 1.5, 0.2, 3.0
STEPS = 10


def load(robot):
    m = mujoco.MjModel.from_xml_path(str(YARD / 'robots' / robot['id'] / 'robot' / 'scene.xml'))
    k = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_KEY, robot['key']) if robot['key'] else -1
    pose = m.key_qpos[k].copy() if k >= 0 else m.qpos0.copy()
    key_ctrl = m.key_ctrl[k].copy() if k >= 0 else np.zeros(m.nu)
    if key_ctrl.any():
        targets = key_ctrl
    else:
        targets = np.array([pose[m.jnt_qposadr[m.actuator_trnid[a, 0]]] for a in range(m.nu)])
    base = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, robot['base'])
    return m, pose, targets, base


def topples(m, pose, targets, base, ratio, deg):
    d = mujoco.MjData(m)
    d.qpos[:] = pose
    d.ctrl[:] = targets
    mujoco.mj_forward(m, d)
    dt = m.opt.timestep
    for _ in range(round(WARMUP / dt)):
        mujoco.mj_step(m, d)
    # the push comes from `deg` (counterclockwise from the robot's front) and points away from that side
    q = d.xquat[base]
    hx, hy = 1 - 2 * (q[2] ** 2 + q[3] ** 2), 2 * (q[1] * q[2] + q[0] * q[3])
    n = math.hypot(hx, hy)
    hx, hy = hx / n, hy / n
    a = math.radians(deg)
    c, s = -math.cos(a), -math.sin(a)
    fx, fy = c * hx - s * hy, s * hx + c * hy
    f = ratio * m.body_subtreemass[base] * 9.81
    stand = pose[2]
    for i in range(round((PUSH + AFTER) / dt)):
        d.xfrc_applied[base, :] = 0
        if i * dt < PUSH:
            d.xfrc_applied[base, 0] = f * fx
            d.xfrc_applied[base, 1] = f * fy
        mujoco.mj_step(m, d)
        w, x, y, _ = d.qpos[3:7]
        tilt = math.degrees(math.acos(max(-1.0, min(1.0, 1 - 2 * (x * x + y * y)))))
        if d.qpos[2] < 0.6 * stand or tilt > 45:
            return True
    return False


print(f'MuJoCo {mujoco.__version__} (Python), {STEPS} halvings per direction; GOLEM rose from board.json for comparison')
print(f'{"robot":10} {"from":>6}  {"python":>8}  {"golem":>8}')
for robot in META['robots']:
    m, pose, targets, base = load(robot)
    row = next(r for r in BOARD['robots'] if r['id'] == robot['id'])
    for deg in (0, 90, 180, 270):
        if topples(m, pose, targets, base, 0.0, deg):
            mine = 0.0
        elif not topples(m, pose, targets, base, 1.0, deg):
            mine = None
        else:
            lo, hi = 0.0, 1.0
            for _ in range(STEPS):
                mid = (lo + hi) / 2
                if topples(m, pose, targets, base, mid, deg):
                    hi = mid
                else:
                    lo = mid
            mine = hi
        golem = next((p['breaks'] for p in row['rose'] if p['deg'] == deg), 'n/a')
        fmt = lambda v: 'holds' if v is None else (f'{v * 100:.1f}%' if isinstance(v, float) or isinstance(v, int) else str(v))
        print(f'{robot["id"]:10} {deg:>5} deg  {fmt(mine):>8}  {fmt(golem):>8}', flush=True)
