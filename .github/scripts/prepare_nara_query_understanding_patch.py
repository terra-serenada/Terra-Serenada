#!/usr/bin/env python3
"""Prepare Nara 2.1 patch anchors and isolate test fixtures for its legacy helpers.

Runs inside the ephemeral GitHub Actions checkout before the main patch script.
It does not modify repository root index.html, persistent app data, or APK data.
"""
from pathlib import Path
import re

# 1. Make the main HTML patch resilient to harmless whitespace variation.
patch_path = Path('.github/scripts/patch_nara_query_understanding.py')
if not patch_path.is_file():
    raise SystemExit(f'ERROR: Required query-understanding patch is missing: {patch_path}')
source = patch_path.read_text(encoding='utf-8')
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

# Fix the diagnostic boundary without relying on one exact indentation sequence.
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
if count == 1:
    source = source.replace(old_diag, new_diag, 1)
elif count == 0 and 'retrieval diagnostic function: click-listener boundary not found' in source:
    # Already prepared in an earlier run; keep it idempotent.
    pass
else:
    raise SystemExit(f'ERROR: Could not safely update retrieval diagnostic boundary logic: expected one old block, found {count}.')

if source != original:
    compile(source, str(patch_path), 'exec')
    patch_path.write_text(source, encoding='utf-8')
    print('PASS: unique whitespace-insensitive anchors enabled.')
    print('PASS: retrieval diagnostic boundary now ignores indentation.')
else:
    print('PASS: query-understanding patch anchors were already prepared.')

# 2. The regression test evaluates the online-context builder in an isolated VM.
# Supply the two pre-existing app helpers it references, since that VM intentionally
# evaluates only the builder function instead of loading the entire app script.
test_path = Path('.github/scripts/test_nara_query_understanding.js')
if not test_path.is_file():
    raise SystemExit(f'ERROR: Required query-understanding regression test is missing: {test_path}')
test_source = test_path.read_text(encoding='utf-8')
anchor = '''    naraPlantEntriesMentionedInText: entries,
    naraExplicitCropTerms: cropTerms,
'''
fixtures = '''    naraPlantEntriesMentionedInText: entries,
    naraExplicitCropTerms: cropTerms,
    // Isolated VM fixtures for pre-existing globals used by the context builder.
    naraHasPlantTopic: q => cropTerms(q).length > 0 || /\\b(?:tanaman|tumbuhan|kebun|buah|daun|batang|akar|bunga|hama|penyakit|panen|siram|penyiraman|pupuk|bed)\\b/i.test(normalize(q).join(' ')),
    naraScopeRecentHistory: (q, limit=8) => {
      const count = Number.isInteger(limit) && limit > 0 ? limit : 8;
      return context.naraState.messages.slice(-count);
    },
'''
if 'naraHasPlantTopic: q =>' in test_source and 'naraScopeRecentHistory: (q, limit=8)' in test_source:
    print('PASS: online context test fixtures for legacy helpers already exist.')
else:
    count = test_source.count(anchor)
    if count != 1:
        raise SystemExit(f'ERROR: Could not safely add isolated-VM helper fixtures: expected one anchor, found {count}.')
    test_source = test_source.replace(anchor, fixtures, 1)
    test_path.write_text(test_source, encoding='utf-8')
    print('PASS: isolated-VM fixtures added for naraHasPlantTopic and naraScopeRecentHistory.')

# 3. The isolated memory-retrieval test must mirror the store used by the current
# app. naraGetTaughtKnowledge retrieves Guru material from teacherValidatedLessons,
# not the legacy teacherLessons fixture used in the original test. Put the Guru lesson
# in the validated store (not the candidate store) and keep the user's lesson separate.
rx_anchor = """rx.naraState = {
  messages: [],
  userLessons: [{id:'user-rule'"""
validated_fixture = """rx.naraState = {
  messages: [],
  teacherValidatedLessons: [{id:'guru-rule', title:'Aturan yang pernah saya ajarkan tentang penyiraman', topic:'Penyiraman', text:'Aturan umum penyiraman yang pernah saya ajarkan kepada Nara untuk semua tanaman.', createdAt:'2026-10-13', origin:'Guru AI Online', learningType:'model_language'}],
  teacherCandidateLessons: [],
  onlineTeacherLessons: [],
  lessons: [],
  userLessons: [{id:'user-rule'"""
validated_fixture_marker = "teacherValidatedLessons: [{id:'guru-rule'"
legacy_guru_fixture = "  teacherLessons: [{id:'guru-rule', title:'Aturan yang pernah saya ajarkan tentang penyiraman', topic:'Penyiraman', text:'Aturan umum penyiraman yang pernah saya ajarkan kepada Nara untuk semua tanaman.', createdAt:'2026-10-13', origin:'Guru AI Online', learningType:'model_language'}]"
if validated_fixture_marker in test_source:
    if legacy_guru_fixture in test_source:
        test_source = test_source.replace(legacy_guru_fixture, '  teacherLessons: []', 1)
        test_path.write_text(test_source, encoding='utf-8')
        print('PASS: duplicate legacy Guru fixture moved to the validated store only.')
    else:
        print('PASS: validated Guru memory fixture already exists.')
else:
    count = test_source.count(rx_anchor)
    if count != 1:
        raise SystemExit(f'ERROR: Could not safely add validated memory fixture: expected one anchor, found {count}.')
    test_source = test_source.replace(rx_anchor, validated_fixture, 1)
    if legacy_guru_fixture not in test_source:
        raise SystemExit('ERROR: Expected legacy Guru fixture not found after adding validated fixture.')
    test_source = test_source.replace(legacy_guru_fixture, '  teacherLessons: []', 1)
    test_source = test_source.replace(
        "// 8. Explicit user-taught-memory questions prefer the user's store over equally matching Guru material.",
        "// 8. Explicit user-taught-memory questions prefer the user's store over equally matching validated Guru material.",
        1
    )
    test_source = test_source.replace(
        "assert(memoryHits.length >= 2, 'Test should return both the user and Guru lesson candidates.');",
        "assert(memoryHits.length >= 2, 'Test should return both the user and validated Guru lesson records.');",
        1
    )
    test_path.write_text(test_source, encoding='utf-8')
    print('PASS: memory regression fixture now supplies a real validated Guru lesson and a separate user lesson.')

