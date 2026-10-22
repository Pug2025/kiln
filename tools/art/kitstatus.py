#!/usr/bin/env python3
"""Mark art-kit files final: sets their ARTKIT.md status and adds them to ARTKIT.READY with a date.
Run from the repo root:  python3 tools/art/kitstatus.py 2026-10-21 glyphs/wide.png img/backdrop.webp ...
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    date, paths = sys.argv[1], sys.argv[2:]
    md_path = os.path.join(ROOT, 'ARTKIT.md')
    with open(md_path, encoding='utf-8') as f:
        lines = f.read().split('\n')
    found = set()
    for i, line in enumerate(lines):
        cells = line.split('|')
        if len(cells) > 8 and cells[1].strip().strip('`') in paths:
            cells[7] = ' final '
            lines[i] = '|'.join(cells)
            found.add(cells[1].strip().strip('`'))
    missing = [p for p in paths if p not in found]
    if missing:
        sys.exit(f'not in ARTKIT.md: {missing}')
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    ready_path = os.path.join(ROOT, 'ARTKIT.READY')
    with open(ready_path, encoding='utf-8') as f:
        ready = [l for l in f.read().split('\n') if l.strip()]
    keep = [l for l in ready if l.startswith('#') or l.split()[0] not in paths]
    keep += [f'{p} {date}' for p in paths]
    with open(ready_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(keep) + '\n')
    print('final:', len(paths), 'files')


if __name__ == '__main__':
    main()
