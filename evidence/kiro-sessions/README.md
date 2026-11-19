# Kiro CLI sessions

The headless Kiro CLI runs that built or repaired GOLEM and whose logs we kept (40 runs in 33 sessions; a resumed run continues its session), each as its raw stream-json log (gzipped), with the prompt it was given. `prompts/` also holds a few prompts whose runs left no log. The agent-gate experiment's own runs are in `evidence/results/agent-gate*.streams/`.

- `index.json`: one row per session: Kiro session ids, mode (`spec`, `vibe` = Kiro's default mode, or a custom agent such as `golem-tuner`), credits used (summed from the log's own `credits` records), tool calls, files written, and the final message.
- `<name>.jsonl.gz`: the log. `zcat ears-fix.jsonl.gz | head` to read one.
- `prompts/<name>.txt`: the prompt. Spec-mode runs also got `prompts/common.txt` (the shared spec format). `launch.sh` shows the exact command line.
- Names ending `.r1`, `.r2` are resumed runs after an interruption (Kiro throttling, or the laptop shutting down mid-run).

Local paths in the logs are redacted: the temporary working folder is `<tmp>` and the home folder is `<home>`. Nothing else is changed. Runs that were killed before Kiro wrote a credits record (for example `evidence`, `site`) show 0 credits; the account's real total is higher than the sum here.

Regenerate with `python scripts/pack-kiro-sessions.py <folder with run-*.jsonl>`.
