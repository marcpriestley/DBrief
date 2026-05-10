#!/usr/bin/env python3
"""
fix6.py - fix ALL broken resolveUrl() calls introduced by fix.py across every .tsx/.ts file.

fix.py changed:  fetch('/api/path', { opts })
to broken:       fetch(resolveUrl('/api/path', { opts })   <- fetch( never closes
should be:       fetch(resolveUrl('/api/path'), { opts })  <- resolveUrl closes after URL

Two broken patterns:
  CASE A: resolveUrl('URL', { ...  <- options swallowed into resolveUrl
  CASE B: fetch(resolveUrl('URL')  <- single-arg, fetch( never closes
"""
import re, os, glob, sys

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base): print(f"ERROR: {base} not found"); sys.exit(1)
os.chdir(base)
print(f"Working in: {base}")

all_files = sorted(
    glob.glob('client/src/**/*.tsx', recursive=True) +
    glob.glob('client/src/**/*.ts', recursive=True)
)

total = 0
for path in all_files:
    if 'queryClient.ts' in path: continue
    c = open(path).read()
    orig = c

    # CASE A: resolveUrl got fetch options as 2nd arg — insert ) after URL
    # Single-quoted URL
    c = re.sub(r"resolveUrl\('([^']+)',(\s*\{)", r"resolveUrl('\1'),\2", c)
    # Double-quoted URL
    c = re.sub(r'resolveUrl\("([^"]+)",(\s*\{)', r'resolveUrl("\1"),\2', c)
    # Template literal (with or without ${} expressions)
    c = re.sub(r'resolveUrl\(`([^`]+)`,(\s*\{)', r'resolveUrl(`\1`),\2', c)

    # CASE B: single-arg fetch where fetch( is left unclosed
    # Original: fetch('URL');  →  after fix.py: fetch(resolveUrl('URL');
    # The ) closes resolveUrl but not fetch. Need an extra ).
    # Single-quoted
    c = re.sub(r"fetch\(resolveUrl\('([^']+)'\)(\s*;)", r"fetch(resolveUrl('\1'))\2", c)
    # Double-quoted
    c = re.sub(r'fetch\(resolveUrl\("([^"]+)"\)(\s*;)', r'fetch(resolveUrl("\1"))\2', c)
    # Template literal (handles ${...} expressions since [^`] matches $, {, })
    c = re.sub(r'fetch\(resolveUrl\(`([^`]+)`\)(\s*;)', r'fetch(resolveUrl(`\1`))\2', c)

    if c != orig:
        open(path, 'w').write(c)
        print(f"  ✓ Fixed: {os.path.basename(path)}")
        total += 1

print(f"\nTotal files patched: {total}")

# Verify: look for any remaining broken resolveUrl calls
print("\nChecking for remaining broken patterns...")
broken = 0
for path in all_files:
    if 'queryClient.ts' in path: continue
    c = open(path).read()
    # Case A remnants: resolveUrl(URL, { (should not exist after fix)
    if re.search(r"resolveUrl\(['\"`][^)]+,\s*\{", c):
        for i, line in enumerate(c.split('\n'), 1):
            if re.search(r"resolveUrl\(['\"`][^)]+,\s*\{", line):
                print(f"  ✗ CASE A still broken: {os.path.basename(path)} L{i}: {line.strip()[:80]}")
                broken += 1

if broken == 0:
    print("  ✓ No broken resolveUrl patterns found!")
else:
    print(f"  {broken} issue(s) remain — check output above")

print("\nNow rebuild:")
print("  cd ~/dbrief && VITE_NATIVE_BUILD=true npm run build 2>&1 | head -20")
