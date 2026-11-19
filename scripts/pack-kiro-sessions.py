"""Packs the Kiro CLI headless session logs (stream-json) into evidence/kiro-sessions/.

Each log is redacted (local temp folders become <tmp>, the home folder becomes <home>), gzipped, and listed in
index.json with its session id, mode, models, credits, tool calls, files written and final message.

Usage: python scripts/pack-kiro-sessions.py <folder with run-*.jsonl>
"""
import gzip
import json
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'evidence' / 'kiro-sessions'
out.mkdir(parents=True, exist_ok=True)

TMP = re.compile(r'[A-Za-z]:(?:\\\\|\\|/)Users(?:\\\\|\\|/)[^\\/"]+(?:\\\\|\\|/)AppData(?:\\\\|\\|/)Local(?:\\\\|\\|/)Temp(?:\\\\|\\|/)[^"\s]*?scratchpad', re.I)
TMP2 = re.compile(r'/c/Users/[^/"]+/AppData/Local/Temp/[^"\s]*?scratchpad', re.I)
HOME = re.compile(r'[A-Za-z]:(?:\\\\|\\|/)Users(?:\\\\|\\|/)rohan', re.I)
HOME2 = re.compile(r'/c/Users/rohan', re.I)


def redact(s: str) -> str:
    s = TMP.sub('<tmp>', s)
    s = TMP2.sub('<tmp>', s)
    s = HOME.sub('<home>', s)
    return HOME2.sub('<home>', s)


def walk(x, f):
    if isinstance(x, dict):
        f(x)
        for v in x.values():
            walk(v, f)
    elif isinstance(x, list):
        for v in x:
            walk(v, f)


index = []
for p in sorted(src.glob('run-*.jsonl')):
    raw = p.read_text(encoding='utf-8', errors='replace')
    red = redact(raw)
    name = p.stem[4:]
    (out / f'{name}.jsonl.gz').write_bytes(gzip.compress(red.encode('utf-8'), 9))
    sessions, modes, models, credits, tools, files, final = set(), set(), set(), 0.0, 0, set(), ''
    for line in red.splitlines():
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue

        def visit(d):
            nonlocal_vars = None  # noqa: F841
            if 'sessionId' in d and isinstance(d['sessionId'], str):
                sessions.add(d['sessionId'])
            if d.get('id') == 'mode' and 'currentValue' in d:
                modes.add(d['currentValue'])
            if d.get('id') == 'model' and 'currentValue' in d:
                models.add(d['currentValue'])
            if d.get('sessionUpdate') == 'tool_call':
                stats['tools'] += 1
            if d.get('type') == 'diff' and isinstance(d.get('path'), str):
                files.add(d['path'])
            if isinstance(d.get('credits'), list):
                for c in d['credits']:
                    if isinstance(c, dict) and isinstance(c.get('usage'), (int, float)):
                        stats['credits'] += c['usage']
            if isinstance(d.get('finalText'), str):
                stats['final'] = d['finalText']

        stats = {'tools': 0, 'credits': 0.0, 'final': ''}
        walk(o, visit)
        tools += stats['tools']
        credits += stats['credits']
        if stats['final']:
            final = stats['final']
    index.append({
        'name': name, 'file': f'{name}.jsonl.gz', 'sessions': sorted(sessions), 'modes': sorted(modes), 'models': sorted(models),
        'credits': round(credits, 2), 'toolCalls': tools, 'filesWritten': len(files), 'finalMessage': final[:1500],
    })
    print(f'{name:18} credits {credits:7.1f}  tools {tools:5}  files {len(files):4}  modes {sorted(modes)}')

(out / 'index.json').write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding='utf-8')
print('total credits', round(sum(r['credits'] for r in index), 1), 'logs', len(index))
