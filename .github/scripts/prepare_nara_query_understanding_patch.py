#!/usr/bin/env python3
"""Make Nara 2.1's exact-anchor patch resilient to harmless whitespace differences.

This runs only inside the GitHub Actions checkout before the main patch script.
It does not edit the user's root index.html or persistent data. The checkout itself
is ephemeral; this only adjusts the patch helper for the current build run.
"""
from pathlib import Path

path = Path('.github/scripts/patch_nara_query_understanding.py')
if not path.is_file():
    raise SystemExit(f'ERROR: Required query-understanding patch is missing: {path}')
source = path.read_text(encoding='utf-8')
start_marker = 'def replace_once(text: str, old: str, new: str, label: str) -> str:'
end_marker = '\nbuilder_start = source.find('
start = source.find(start_marker)
end = source.find(end_marker, start + 1)
if start < 0 or end <= start:
    raise SystemExit('ERROR: Could not safely locate replace_once helper in query-understanding patch.')

replacement = '''def replace_once(text: str, old: str, new: str, label: str) -> str:
    """Replace one exact anchor, falling back to a unique whitespace-insensitive match.

    Some generated HTML blocks differ only in indentation/newline representation.
    Exact matching remains preferred; the fallback is unique-only and fails closed.
    """
    count = text.count(old)
    if count == 1:
        return text.replace(old, new, 1)

    def compact_with_offsets(value: str):
        chars = []
        offsets = []
        for index, char in enumerate(value):
            if not char.isspace():
                chars.append(char)
                offsets.append(index)
        return ''.join(chars), offsets

    compact_text, offsets = compact_with_offsets(text)
    compact_old, _ = compact_with_offsets(old)
    if not compact_old:
        raise SystemExit(f'ERROR: query-understanding patch at {label}: empty anchor.')
    positions = []
    cursor = 0
    while True:
        found = compact_text.find(compact_old, cursor)
        if found < 0:
            break
        positions.append(found)
        cursor = found + 1
    if len(positions) != 1:
        raise SystemExit(
            f'ERROR: query-understanding patch at {label}: exact matches={count}, '
            f'whitespace-insensitive matches={len(positions)}. Refusing ambiguous edit.'
        )
    compact_start = positions[0]
    raw_start = offsets[compact_start]
    raw_end = offsets[compact_start + len(compact_old) - 1] + 1
    return text[:raw_start] + new + text[raw_end:]
'''

updated = source[:start] + replacement + source[end:]
if updated == source:
    raise SystemExit('ERROR: Whitespace-tolerant patch helper made no change.')
# Validate the patched Python before allowing the main Nara patch to run.
compile(updated, str(path), 'exec')
path.write_text(updated, encoding='utf-8')
print('PASS: query-understanding patch now supports unique whitespace-insensitive anchors.')
