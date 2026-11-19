# Proposals

Discussion about lines of `.kiro/specs/g1-walking/requirements.md` goes here. Requirement lines are never edited to make a failing run pass.

## P1. Meaning of "from behind" (open)

The push applies its force along the robot's heading rotated by `push.angle` (stagger-app Property 25: 0 deg pushes along the heading). The compiler reads `from behind` as `push.angle` in [135 deg, 225 deg], so the force points backwards: physically the push lands on the chest, which most readers would call "from the front". Line 1.2 keeps its words. Options: measure `push.angle` as the direction the push comes from (force = -(heading rotated by angle)), or change the ears reading of `from behind` to [-45 deg, 45 deg]. Either changes Property 25 or golem-ears, so it needs a decision before evidence runs.

## P2. Push recovery threshold (record)

stagger-app Requirement 17.5 suggests "up to 100 N from any direction" as the push Expected_Hold line. Probe runs (0.2 s pushes, 8 stride points, 2 seeds) found falls at 100 N and at 80 N from 270 deg (4 of 16 runs each), and none at 60 N. Line 1.1 therefore states 60 N, and the 100 N line is kept as 1.3, marked Expected_Break.

## P3. Commanded speed changes (open)

The settling allowance of `track the commanded speed within {speed}` covers episode time below 2 s, which is the warm-up, so a command change at the trigger is scored from its first Control_Step. Probe runs of `WHEN commanded to walk at 0.2 m/s to 0.8 m/s THE robot SHALL track the commanded speed within 0.2 m/s for 5 s` broke at 0.2 m/s and 0.8 m/s while the robot was still changing speed. The file therefore has no speed-change tracking line yet. A settling allowance measured from the trigger would make such a line testable.
