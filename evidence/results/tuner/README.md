# golem-tuner session

`golem-tuner-session.jsonl` is the full stream-json log of one Kiro CLI session (agent `golem-tuner`, model claude-opus-5.5) that wrote the lateral step-into-the-push reflex now in `apps/stagger/controller/kiro-reflex.ts`. `prompt.txt` is the task it was given.

The prompt was written before the push-angle convention was fixed. It calls the weak side "right (around 260°)"; with the convention the code uses now (push.angle is the side a push comes from, counterclockwise from the heading), the same weak side is the robot's left, around 80°.

The tuner's commit on its branch was `214041c`. On main the reflex ships as a switchable variant (`setReflex('kiro')` or `GOLEM_REFLEX=kiro`); the default stays Unitree's policy unchanged.
