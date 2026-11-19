# Proposals for the hover app

Lines in `.kiro/specs/hover-hold/requirements.md` are never edited to make a failing run pass. A broken line leads to a controller change, or to an entry here.

## Lines 1.3 and 3.2 are Expected_Break

Both break with the controller in `controller/`, measured in `README.md`.

- **1.3 (a gust of up to 20 N within 1.0 m).** Breaks from about 10 N. A controller change that could move the boundary: raise the tilt limit in `GAINS.tiltLimit` (35 deg now), which costs vertical thrust margin, or add a wind estimate (the integral term only follows slow wind). Raising the line's limit from 1.0 m to a larger ball would change the requirement, not the controller, and needs a human decision.
- **3.2 (an estimate lag of up to 0.30 s).** Breaks from about 0.27 s. A controller change that could move the boundary: predict the position forward by the lag (a Smith predictor), which needs the controller to know the lag, or lower the position gains, which weakens line 1.1.

Neither change is part of this spec.
