#!/usr/bin/env python3
"""
fix2.py - repairs the broken resolveUrl wrapping introduced by fix.py
The problem: fetch(resolveUrl(`/api/...`, opts)  <-- missing ) after URL
The fix:     fetch(resolveUrl(`/api/...`), opts)  <-- ) moved to after URL
"""
import re, os, glob, sys

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base):
    print(f"ERROR: {base} not found"); sys.exit(1)
os.chdir(base)
print(f"Working in: {base}")

# Pattern: resolveUrl(`/api/...`, opts)  -->  resolveUrl(`/api/...`), opts
# Template literal may contain ${var} expressions but not nested backticks
broken_pattern = re.compile(
    r'resolveUrl\((`/api/(?:[^`$\\]|\\.|\$\{[^}]*\})*`),\s*'
)

def fix_resolveurl(content):
    return broken_pattern.sub(lambda m: f'resolveUrl({m.group(1)}), ', content)

all_files = sorted(
    glob.glob('client/src/**/*.tsx', recursive=True) +
    glob.glob('client/src/**/*.ts', recursive=True)
)

fixed = 0
for path in all_files:
    content = open(path).read()
    new_content = fix_resolveurl(content)
    if new_content != content:
        open(path, 'w').write(new_content)
        # Count fixes
        n = len(broken_pattern.findall(content))
        print(f"  Fixed {n} occurrence(s) in {path}")
        fixed += 1

if fixed == 0:
    print("No broken resolveUrl patterns found - already fixed or fix.py did not run")
else:
    print(f"\n✓ Fixed {fixed} file(s)")

# Verify trends.tsx compiles-ish (check parens balance around resolveUrl calls)
trends = open('client/src/pages/trends.tsx').read()
broken_remaining = broken_pattern.findall(trends)
if broken_remaining:
    print(f"\nWARNING: Still {len(broken_remaining)} broken pattern(s) in trends.tsx!")
else:
    print("✓ trends.tsx looks clean")

print("\nNow rebuild:")
print("  cd ~/dbrief")
print("  VITE_NATIVE_BUILD=true npm run build && npx cap sync android")
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print("  cd android && ./gradlew clean installDebug")
