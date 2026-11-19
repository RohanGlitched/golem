#!/usr/bin/bash
# How every session in this folder was started: Kiro CLI 3.5 in headless mode, one prompt file per run.
#   launch.sh <prompt-name> [--mode spec] [--model claude-opus-5.5|claude-sonnet-5.5] [--agent <name>]
# Spec runs append prompts/common.txt (the shared spec-format instructions). Output: run-<name>.jsonl (stream-json).
name=$1; shift
prompt="$(cat prompts/$name.txt)"
case " $* " in *" --mode spec "*) prompt="$prompt $(cat prompts/common.txt)";; esac
kiro-cli chat --no-interactive "$@" --trust-workspace --trust-all-tools --output-format stream-json "$prompt" > run-$name.jsonl 2> run-$name.err
