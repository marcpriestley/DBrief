#!/usr/bin/env python3
"""fix5.py - exact string replacement, no regex"""
import os, sys
base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base): print(f"ERROR: {base} not found"); sys.exit(1)
os.chdir(base)

dp_path = 'client/src/components/DebriefPanel.tsx'
c = open(dp_path).read()
orig = c

FIXES = [
    # broken by fix.py          ->  correct
    ('d.messages || []).some(',      '(d.messages || []).some('),
    ('d.messages || []).filter(',    '(d.messages || []).filter('),
    ('d.messages || []).find(',      '(d.messages || []).find('),
    ('d.messages || []).map(',       '(d.messages || []).map('),
    ('d.messages || []).forEach(',   '(d.messages || []).forEach('),
    ('d.messages || []).every(',     '(d.messages || []).every('),
    ('debrief.messages || []).some(',    '(debrief.messages || []).some('),
    ('debrief.messages || []).filter(',  '(debrief.messages || []).filter('),
    ('debrief.messages || []).find(',    '(debrief.messages || []).find('),
    ('debrief.messages || []).map(',     '(debrief.messages || []).map('),
    ('debrief.messages || []).length',   '(debrief.messages || []).length'),
    ('debrief.messages || []).slice(',   '(debrief.messages || []).slice('),
    ('debrief.messages || [])[',         '(debrief.messages || [])['),
]

applied = 0
for broken, fixed in FIXES:
    # Count occurrences not already preceded by (
    count = c.count(broken)
    already_ok = c.count(fixed)
    # Occurrences that need fixing = those where broken is NOT already the right form
    need_fix = count - already_ok  # approximate
    if broken in c and broken != fixed:
        # Safe replace: only replace if not already correctly wrapped
        # We do this by temporarily replacing the correct form, replacing broken, then putting correct back
        placeholder = f'__PLACEHOLDER_{applied}__'
        c = c.replace(fixed, placeholder)          # hide already-correct occurrences
        actual_broken = c.count(broken)
        if actual_broken > 0:
            c = c.replace(broken, fixed)           # fix remaining broken ones
            print(f'  Fixed {actual_broken}x: {broken[:50]} -> {fixed[:50]}')
            applied += actual_broken
        c = c.replace(placeholder, fixed)          # restore already-correct ones

if c != orig:
    open(dp_path, 'w').write(c)
    print(f'\n✓ DebriefPanel.tsx - {applied} fix(es) applied')
else:
    print('DebriefPanel.tsx - no changes needed (either already fixed or fix.py did not run)')

# Show lines containing .messages to verify
print('\nLines containing .messages in DebriefPanel.tsx:')
for i, line in enumerate(c.split('\n'), 1):
    if '.messages' in line and not line.strip().startswith('//') and not line.strip().startswith('*'):
        stripped = line.strip()
        # Flag broken patterns
        bad = ('d.messages || []).' in stripped and '(d.messages' not in stripped) or \
              ('debrief.messages || []).' in stripped and '(debrief.messages' not in stripped)
        status = '✗ BROKEN' if bad else '✓'
        print(f'  {status} L{i}: {stripped[:90]}')

print('\nNow rebuild:')
print('  cd ~/dbrief && VITE_NATIVE_BUILD=true npm run build && npx cap sync android')
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print('  cd android && ./gradlew clean installDebug')
