#!/usr/bin/env python3
import re, os, glob, sys

base = os.path.expanduser('~/dbrief')
if not os.path.isdir(base):
    print(f"ERROR: {base} not found")
    sys.exit(1)
os.chdir(base)
print(f"Working in: {base}")

# 1. queryClient.ts - write the whole file cleanly
qc = """import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const IS_NATIVE_BUILD = import.meta.env.VITE_NATIVE_BUILD === "true";
const NATIVE_API_BASE = "https://dbrief.replit.app";

export function resolveUrl(url: string): string {
  const isNative = IS_NATIVE_BUILD ||
    (typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.() === true);
  if (url.startsWith("/") && isNative) {
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
"""
open('client/src/lib/queryClient.ts', 'w').write(qc)
print("✓ queryClient.ts rewritten")

# 2. Fix all raw fetch(`/api/ calls - global regex replace across all tsx/ts files
all_files = sorted(
    glob.glob('client/src/**/*.tsx', recursive=True) +
    glob.glob('client/src/**/*.ts', recursive=True)
)

for path in all_files:
    if 'queryClient.ts' in path:
        continue
    content = open(path).read()
    orig = content

    # Replace fetch(`/api/ → fetch(resolveUrl(`/api/  (idempotent - skip if already wrapped)
    content = re.sub(r'fetch\((?!resolveUrl\()(`/api/)', r'fetch(resolveUrl(\1', content)
    content = re.sub(r"fetch\((?!resolveUrl\()('/api/)", r"fetch(resolveUrl(\1", content)

    if 'resolveUrl' in content and 'resolveUrl' not in orig:
        # Add resolveUrl to existing queryClient import if present
        m = re.search(r'from "@/lib/queryClient"', content)
        if m:
            content = re.sub(
                r'import \{([^}]+)\} from "@/lib/queryClient"',
                lambda x: x.group(0) if 'resolveUrl' in x.group(1)
                          else f'import {{{x.group(1).rstrip()}, resolveUrl}} from "@/lib/queryClient"',
                content
            )
        else:
            # Add as new import after very first import line
            content = re.sub(r'^(import .+;\n)', r'\1import { resolveUrl } from "@/lib/queryClient";\n', content, count=1, flags=re.MULTILINE)

    if content != orig:
        open(path, 'w').write(content)
        print(f"✓ {path}")

# 3. DebriefPanel - guard ALL .messages accesses
dp_path = 'client/src/components/DebriefPanel.tsx'
dp = open(dp_path).read()
orig = dp
for method in ['some', 'filter', 'find', 'map', 'forEach', 'every']:
    dp = re.sub(rf'(?<!\|\| \[\])\.messages\.{method}\(', f'.messages || []).{method}(', dp)
    # Fix cases like  d.messages.some → (d.messages || []).some
    dp = re.sub(rf'(\w+)\.messages\.{method}\(', lambda m: f'({m.group(1)}.messages || []).{method}(', dp)
# Specifically guard debrief.messages.length and .slice and [] access
dp = re.sub(r'(?<!\(\()(?<!\|\| \[\]\))\.messages\.length(?!\s*[=!])', '.messages || []).length', dp)
dp = re.sub(r'\.messages\.slice\(', '.messages || []).slice(', dp)
dp = re.sub(r'\.messages\[', '.messages || [])[', dp)
# Clean up any double-parentheses introduced by multiple passes
dp = re.sub(r'\(\((\w+)\.messages \|\| \[\]\)', r'(\1.messages || [])', dp)
if dp != orig:
    open(dp_path, 'w').write(dp)
    print("✓ DebriefPanel.tsx - messages guards applied")

# 4. index.html - add onerror handler
html_path = 'client/index.html'
html = open(html_path).read()
if 'window.__dbriefErrors' not in html:
    handler = '    <script>window.__dbriefErrors=[];function showErr(t){var d=document.createElement("div");d.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;background:#8b0000;color:#fff;padding:16px;font:11px/1.5 monospace;white-space:pre-wrap;overflow-y:auto;z-index:9999999";d.textContent=t;document.body.appendChild(d);}window.onerror=function(m,s,l,c,e){showErr("JS ERROR\\n"+m+"\\n"+(s||"")+":"+(l||"")+"\\n"+(e&&e.stack?e.stack:""));};window.addEventListener("unhandledrejection",function(e){var r=e.reason;showErr("PROMISE\\n"+(r&&r.stack?r.stack:String(r)));});</script>\n'
    # insert before the closing </head> or before the module script
    html = re.sub(r'(\s*)(<script type="module")', handler + r'\1\2', html, count=1)
    open(html_path, 'w').write(html)
    print("✓ index.html - onerror handler added")
else:
    print("✓ index.html - onerror handler already present")

# 5. Verify
print("\n--- Verification ---")
qc_check = open('client/src/lib/queryClient.ts').read()
print(f"resolveUrl in queryClient: {'YES' if 'export function resolveUrl' in qc_check else 'NO - PROBLEM!'}")
dp_check = open('client/src/components/DebriefPanel.tsx').read()
raw = len(re.findall(r'\.messages\.(?:map|some|filter|find)\(', dp_check))
print(f"Unguarded .messages.X() calls in DebriefPanel: {raw} {'(OK)' if raw == 0 else '(STILL NEED FIX)'}")
html_check = open('client/index.html').read()
print(f"onerror handler in index.html: {'YES' if 'window.__dbriefErrors' in html_check else 'NO'}")

print("\nAll done! Now run:")
print("  cd ~/dbrief")
print("  VITE_NATIVE_BUILD=true npm run build && npx cap sync android")
print('  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"')
print("  cd android && ./gradlew clean installDebug")
