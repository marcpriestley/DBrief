#!/usr/bin/env python3
"""
fixall.py — one-shot native Android fix for ~/dbrief
Applies all resolveUrl + messages-guard fixes to the current codebase.
Safe to re-run. Run from any directory.
"""
import re, os, glob, sys

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base):
    print(f"ERROR: {base} not found"); sys.exit(1)
os.chdir(base)
print(f"Working in {base}\n")

# ─────────────────────────────────────────────────────────────
# 1. Rewrite queryClient.ts cleanly
# ─────────────────────────────────────────────────────────────
QC = '''import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const IS_NATIVE_BUILD = import.meta.env.VITE_NATIVE_BUILD === "true";
const NATIVE_API_BASE = "https://dbrief.replit.app";

function checkNative(): boolean {
  if (IS_NATIVE_BUILD) return true;
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return true;
  if (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.() === true) return true;
  return false;
}
export const isNativeBundle = IS_NATIVE_BUILD || checkNative();

export function resolveUrl(url: string): string {
  if (url.startsWith("/") && checkNative()) {
    return `${NATIVE_API_BASE}${url}`;
  }
  return url;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(resolveUrl(url), {
    method,
    headers: {
      "Accept": "application/json",
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(resolveUrl(queryKey[0] as string), {
      credentials: "include",
    });
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: { retry: false },
  },
});
'''
open('client/src/lib/queryClient.ts', 'w').write(QC)
print("✓ queryClient.ts rewritten")

# ─────────────────────────────────────────────────────────────
# 2. Fix all raw fetch('/api/ calls in every .tsx / .ts file
# ─────────────────────────────────────────────────────────────
all_files = sorted(
    glob.glob('client/src/**/*.tsx', recursive=True) +
    glob.glob('client/src/**/*.ts', recursive=True)
)

def add_import(content, path):
    """Add resolveUrl to the queryClient import, or add a new import."""
    if re.search(r'from "@/lib/queryClient"', content):
        content = re.sub(
            r'import \{([^}]+)\} from "@/lib/queryClient"',
            lambda m: m.group(0) if 'resolveUrl' in m.group(1)
                      else f'import {{{m.group(1).rstrip()}, resolveUrl}} from "@/lib/queryClient"',
            content
        )
    else:
        content = re.sub(
            r'^(import .+;\n)',
            r'\1import { resolveUrl } from "@/lib/queryClient";\n',
            content, count=1, flags=re.MULTILINE
        )
    return content

fixed_files = []
for path in all_files:
    if 'queryClient.ts' in path:
        continue
    c = open(path).read()
    orig = c

    # Step A: wrap bare fetch('/api/  →  fetch(resolveUrl('/api/
    c = re.sub(r"(?<!\()fetch\((?!resolveUrl\()('/api/[^']*')", r"fetch(resolveUrl(\1", c)
    c = re.sub(r'(?<!\()fetch\((?!resolveUrl\()("/api/[^"]*")',  r'fetch(resolveUrl(\1', c)
    c = re.sub(r'(?<!\()fetch\((?!resolveUrl\()(`/api/[^`]*`)', r'fetch(resolveUrl(\1', c)
    # template literals with ${} expressions
    c = re.sub(r'(?<!\()fetch\((?!resolveUrl\()(`/api/(?:[^`])*?`)', r'fetch(resolveUrl(\1', c)

    if 'resolveUrl' in c and 'resolveUrl' not in orig:
        c = add_import(c, path)

    # Step B: fix Case A — resolveUrl(URL, {opts  →  resolveUrl(URL), {opts
    c = re.sub(r"resolveUrl\('([^']+)',(\s*\{)", r"resolveUrl('\1'),\2", c)
    c = re.sub(r'resolveUrl\("([^"]+)",(\s*\{)',  r'resolveUrl("\1"),\2',  c)
    c = re.sub(r'resolveUrl\(`([^`]+)`,(\s*\{)',  r'resolveUrl(`\1`),\2',  c)

    # Step C: fix Case B — fetch(resolveUrl(URL) where fetch( is unclosed
    # Only when NOT followed by ) or , (which would mean it's already correct)
    c = re.sub(r"fetch\(resolveUrl\('([^']+)'\)(?![),])", r"fetch(resolveUrl('\1'))", c)
    c = re.sub(r'fetch\(resolveUrl\("([^"]+)"\)(?![),])',  r'fetch(resolveUrl("\1"))',  c)
    c = re.sub(r'fetch\(resolveUrl\(`([^`]+)`\)(?![),])',  r'fetch(resolveUrl(`\1`))',  c)

    if c != orig:
        open(path, 'w').write(c)
        fixed_files.append(os.path.basename(path))

print(f"✓ fetch/resolveUrl fixes applied to {len(fixed_files)} files")

# ─────────────────────────────────────────────────────────────
# 3. Fix DebriefPanel .messages guards
# ─────────────────────────────────────────────────────────────
dp_path = 'client/src/components/DebriefPanel.tsx'
dp = open(dp_path).read()
orig_dp = dp

# Wrap unguarded .messages.METHOD( calls
for method in ['some', 'filter', 'find', 'map', 'forEach', 'every']:
    # If already wrapped: (X.messages || []).METHOD — skip
    # Pattern: WORD.messages.METHOD(  →  (WORD.messages || []).METHOD(
    dp = re.sub(
        rf'(?<!\|\| \[\])\b(\w+)\.messages\.{method}\(',
        lambda m, meth=method: f'({m.group(1)}.messages || []).{meth}(',
        dp
    )
    # Clean up double-wraps: ((WORD.messages || [])).  →  (WORD.messages || []).
    dp = re.sub(r'\(\((\w+\.messages \|\| \[\])\)\)', r'(\1)', dp)

# Guard .messages.length
dp = re.sub(r'\b(\w+)\.messages\.length\b', r'(\1.messages || []).length', dp)
# Guard .messages.slice(
dp = re.sub(r'\b(\w+)\.messages\.slice\(', r'(\1.messages || []).slice(', dp)
# Guard .messages[
dp = re.sub(r'\b(\w+)\.messages\[', r'(\1.messages || [])[', dp)
# Clean double wraps again
dp = re.sub(r'\(\((\w+\.messages \|\| \[\])\)\)', r'(\1)', dp)

if dp != orig_dp:
    open(dp_path, 'w').write(dp)
    print("✓ DebriefPanel.tsx — .messages guards applied")
else:
    print("✓ DebriefPanel.tsx — already guarded")

# ─────────────────────────────────────────────────────────────
# 4. Verify
# ─────────────────────────────────────────────────────────────
print("\n── Verification ──────────────────────────────────────")
issues = 0

# Check for raw fetch calls
for path in all_files:
    if 'queryClient.ts' in path: continue
    c = open(path).read()
    for i, line in enumerate(c.split('\n'), 1):
        if re.search(r"(?<!\()fetch\((?!resolveUrl\()(['\"`])/api/", line):
            print(f"  ✗ RAW FETCH {os.path.basename(path)} L{i}: {line.strip()[:80]}")
            issues += 1
        if 'resolveUrl(' in line and ')), {' in line:
            print(f"  ✗ OVER-CORRECTED {os.path.basename(path)} L{i}: {line.strip()[:80]}")
            issues += 1

# Check for unguarded .messages. calls in DebriefPanel
dp_check = open(dp_path).read()
raw = re.findall(r'\b\w+\.messages\.(?:map|some|filter|find)\(', dp_check)
if raw:
    print(f"  ✗ UNGUARDED .messages calls in DebriefPanel: {raw}")
    issues += 1

if issues == 0:
    print("  ✓ All checks passed!")
else:
    print(f"\n  {issues} issue(s) found above")

print("\nNow rebuild:")
print("  cd ~/dbrief")
print("  VITE_NATIVE_BUILD=true npm run build 2>&1 | tail -5")
print("  npx cap sync android")
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print("  cd android && ./gradlew clean installDebug")
