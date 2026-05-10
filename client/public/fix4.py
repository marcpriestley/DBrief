#!/usr/bin/env python3
"""
fix4.py - correctly repairs broken .messages guard in DebriefPanel.tsx
Broken pattern:  WORD.messages || []).METHOD(   <- orphaned ) before .
Correct pattern: (WORD.messages || []).METHOD(  <- ( added before WORD
"""
import re, os, sys

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base): print(f"ERROR: {base} not found"); sys.exit(1)
os.chdir(base)
print(f"Working in: {base}")

dp_path = 'client/src/components/DebriefPanel.tsx'
content = open(dp_path).read()
orig = content

# The broken pattern has an ORPHANED ) before the .METHOD:
#   debrief.messages || []).map(    <-- BAD
#   (debrief.messages || []).map(   <-- GOOD
#
# Regex: match WORD.messages || [])  where NOT preceded by (
# then replace with (WORD.messages || [])
content = re.sub(
    r'(?<!\()(\w+\.messages \|\| \[\])\)\.',
    r'(\1).',
    content
)

# Also fix .length access:  WORD.messages || []).length  ->  (WORD.messages || []).length
content = re.sub(
    r'(?<!\()(\w+\.messages \|\| \[\])\)\.length',
    r'(\1).length',
    content
)

if content != orig:
    open(dp_path, 'w').write(content)
    n = len(re.findall(r'(?<!\()(\w+\.messages \|\| \[\])\)\.', orig))
    print(f"✓ DebriefPanel.tsx - fixed {n} broken guard(s)")
else:
    print("No broken patterns found in DebriefPanel.tsx")

# Verify
remaining = re.findall(r'(?<!\()(\w+\.messages \|\| \[\])\)\.', content)
if remaining:
    print(f"WARNING: {len(remaining)} still broken: {remaining}")
else:
    print("✓ All .messages guards look correct")

# Show lines around debrief.messages to confirm fix
for i, line in enumerate(content.split('\n'), 1):
    if '.messages' in line and ('|| []).' in line or '.map(' in line or '.some(' in line):
        stripped = line.strip()
        ok = '(debrief.messages' in line or '(d.messages' in line or '(msgs' in line or '?.' in line
        status = '✓' if ok else '✗ STILL BROKEN'
        print(f"  {status} line {i}: {stripped[:90]}")

print("\nNow rebuild:")
print("  cd ~/dbrief")
print("  VITE_NATIVE_BUILD=true npm run build && npx cap sync android")
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print("  cd android && ./gradlew clean installDebug")
