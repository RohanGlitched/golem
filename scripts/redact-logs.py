"""Redacts local paths (work folder, home folder, temp folder) in committed log files, in place, with the same rules as
pack-kiro-sessions.py. Usage: python scripts/redact-logs.py <file or folder> ..."""
import sys
from pathlib import Path

src = (Path(__file__).resolve().parent / 'pack-kiro-sessions.py').read_text(encoding='utf-8')
ns = {'__file__': str(Path(__file__).resolve().parent / 'pack-kiro-sessions.py')}
exec(src[:src.index('def walk')].replace('src = Path(sys.argv[1])', 'src = None'), ns)
redact = ns['redact']

for arg in sys.argv[1:]:
    p = Path(arg)
    for f in ([p] if p.is_file() else sorted(x for x in p.rglob('*') if x.is_file())):
        t = f.read_text(encoding='utf-8', errors='replace')
        r = redact(t)
        if r != t:
            f.write_text(r, encoding='utf-8', newline='')
            print('redacted', f)
