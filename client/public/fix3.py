#!/usr/bin/env python3
"""
fix3.py - repairs broken .messages guard syntax in DebriefPanel.tsx
Problem:  WORD.messages || []).METHOD(   <-- missing opening (
Fixed:   (WORD.messages || []).METHOD(
"""
import re, os, sys

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base): print(f"ERROR: {base} not found"); sys.exit(1)
os.chdir(base)
print(f"Working in: {base}")

dp_path = 'client/src/components/DebriefPanel.tsx'
dp = open(dp_path).read()
orig = dp

# Fix broken pattern: WORD.messages || []).METHOD(
# where WORD is not already preceded by (
# Regex: find   WORD.messages || []).   not preceded by (
# Replace with: (WORD.messages || []).
dp = re.sub(r'(?<!\()(\w+\.messages \|\| \[\])\.', r'(\1).', dp)

# Also fix .messages || []).length  (no method call, just .length)
dp = re.sub(r'(?<!\()(\w+\.messages \|\| \[\])\.length', r'(\1).length', dp)

# Also fix .messages || [])\.slice\(
dp = re.sub(r'(?<!\()(\w+\.messages \|\| \[\])\.slice\(', r'(\1).slice(', dp)

# Also fix .messages || []\)?\[  (bracket access)
dp = re.sub(r'(?<!\()(\w+\.messages \|\| \[\])\[', r'(\1)[', dp)

if dp != orig:
    open(dp_path, 'w').write(dp)
    count = len(re.findall(r'(?<!\()(\w+\.messages \|\| \[\])\.', orig))
    print(f"✓ DebriefPanel.tsx - fixed {count} missing opening parentheses")
else:
    print("DebriefPanel.tsx - no broken patterns found (already clean or fix.py didn't run)")

# Verify no remaining broken patterns
remaining = re.findall(r'(?<!\()(\w+\.messages \|\| \[\])\.', dp)
if remaining:
    print(f"WARNING: {len(remaining)} patterns still broken: {remaining[:3]}")
else:
    print("✓ DebriefPanel.tsx - all .messages guards look correct")

# Quick sanity check - look for unmatched )
lines = dp.split('\n')
for i, line in enumerate(lines, 1):
    stripped = line.strip()
    if '.messages || []).' in stripped and not re.search(r'\(\w+\.messages', stripped):
        print(f"  Possible issue line {i}: {stripped[:80]}")

print("\nNow rebuild:")
print("  cd ~/dbrief")
print("  VITE_NATIVE_BUILD=true npm run build && npx cap sync android")
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print("  cd android && ./gradlew clean installDebug")
