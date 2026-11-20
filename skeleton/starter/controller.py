"""The starter cart-pole's controller, in Python. Run it with GOLEM_CONTROLLER=python npx --no-install golem-spec gate.

GOLEM calls `make_controller()` before every trial and then the controller once per control step (50 Hz) with
[cart position (m), pole angle (rad), cart velocity (m/s), pole angular velocity (rad/s)]. It returns [force (N)];
app.js clamps it to the motor's +-15 N. The gains are the ones in app.js, so both controllers give the same verdicts.
Replace the body with your own controller: numpy, a trained policy, anything Python runs.
"""
from golem_bridge import serve

KX, KTH, KXD, KTHD = 1.25, 29.4, 2.2, 5.8


def make_controller():
    def step(obs):
        x, th, xd, thd = obs
        return [KX * x + KTH * th + KXD * xd + KTHD * thd]
    return step


if __name__ == '__main__':
    serve(make_controller)
