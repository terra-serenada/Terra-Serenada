#!/usr/bin/env python3
"""Prepare Nara 2.1's patch helper for harmless whitespace differences.

Runs inside the ephemeral GitHub Actions checkout before the main patch script.
Does not modify repository root index.html or persistent app data.
"""
from pathlib import Path
import re

path = Path('.github/scripts/patch_nara_query_understanding.py')
if not path.is_file():
    raise SystemExit(f'ERROR: Required query-understanding patch is missing: {path}')
source = path.read_text(encoding='utf-8')
original = source

start_marker = 'def replace_once(text: str, old: str, new: str, label: str) -> str:'
end_marker = '\nbuilder_start = source.find('
start = source.find(start_marker)
end = source.find(end_marker, start + 1)
if start < 0 or end <= start:
    raise SystemExit('ERROR: Could not safely locate replace_once helper in query-understanding patch.')

replacement = '''def replace_once(text: str, old: str, new: str, label: str) -> str:
    """Replace one exact anchor, falling back to a unique whitespace-insensitive match.

    Exact matching is preferred. The fallback ignores whitespace only and is unique-only;
    it refuses ambiguous edits rather than patching an uncertain location.
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
source = source[:start] + replacement + source[end:]

# The previous patch tried to find the retrieval diagnostic listener using one exact
# indentation string. The restored Step 2P source can indent that listener differently.
old_diag = '''diag_start = source.find("function naraRunRetrievalDiagnostic(){")
diag_end = source.find("\\n          document.addEventListener('click'", diag_start)
if diag_start < 0 or diag_end <= diag_start:
    raise SystemExit("ERROR: Could not isolate existing retrieval diagnostic function.")
diag = source[diag_start:diag_end]'''
new_diag = '''diag_start = source.find("function naraRunRetrievalDiagnostic(){")
if diag_start < 0:
    raise SystemExit("ERROR: Could not locate existing retrieval diagnostic function start.")
listener_pattern = re.compile(
    r"(?m)^[ \\t]*document\\.addEventListener\\(\\s*['\\\"]click['\\\"]\\s*,\\s*function\\s*\\(\\s*e\\s*\\)\\s*\\{"
)
listener_match = listener_pattern.search(source, diag_start + len("function naraRunRetrievalDiagnostic(){"))
if listener_match is None or listener_match.start() <= diag_start:
    raise SystemExit("ERROR: Could not isolate retrieval diagnostic function: click-listener boundary not found.")
diag_end = listener_match.start()
diag = source[diag_start:diag_end]'''
count = source.count(old_diag)
if count != 1:
    raise SystemExit(f'ERROR: Could not safely update retrieval diagnostic boundary logic: expected one old block, found {count}.')
source = source.replace(old_diag, new_diag, 1)

if source == original:
    raise SystemExit('ERROR: Preparatory patch made no changes.')
compile(source, str(path), 'exec')
path.write_text(source, encoding='utf-8')
print('PASS: unique whitespace-insensitive anchors enabled.')
print('PASS: retrieval diagnostic boundary now ignores indentation.')
