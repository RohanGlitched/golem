"""GOLEM's Python bridge: run a controller written in Python inside GOLEM's MuJoCo trials.

GOLEM (Node) starts this script once per trial worker and talks to it over stdin and stdout. Before each trial it
sends a reset, and `serve` calls `make_controller()` to get a fresh controller; then, every control step, it sends the
observation (a list of floats) and the controller returns the action (a list of floats). Standard library only.

    request   u32 kind (1 = reset, 2 = step), u32 n, then n float64   (little-endian)
    reply     u32 n, then n float64

Print nothing to stdout from your controller (stdout is the wire); print to stderr instead.
"""
import struct
import sys

RESET, STEP = 1, 2


def serve(make_controller):
    """Answer GOLEM until it closes stdin. `make_controller()` returns a function from observation to action."""
    rd, wr = sys.stdin.buffer, sys.stdout.buffer
    controller = None
    while True:
        head = rd.read(8)
        if len(head) < 8:
            return
        kind, n = struct.unpack('<II', head)
        obs = struct.unpack(f'<{n}d', rd.read(8 * n)) if n else ()
        if kind == RESET:
            controller = make_controller()
            out = ()
        elif kind == STEP:
            out = tuple(float(x) for x in controller(obs))
        else:
            raise ValueError(f'unknown request kind {kind}')
        wr.write(struct.pack(f'<I{len(out)}d', len(out), *out))
        wr.flush()
