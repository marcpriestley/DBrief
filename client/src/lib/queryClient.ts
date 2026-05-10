import { QueryClient, QueryFunction } from "@tanstack/react-query";

// NATIVE_BUILD is baked in at compile time when building for Android/iOS.
// Set VITE_NATIVE_BUILD=true in the environment before running `npm run build`
// for a native Capacitor release.  Web builds leave this undefined/false.
export const IS_NATIVE_BUILD = import.meta.env.VITE_NATIVE_BUILD === "true";
const NATIVE_API_BASE = "https://dbrief.replit.app";

// Runtime fallback: still try to detect Capacitor at call time so that
// hot-reloading dev mode works when served on a phone via a real IP.
function checkNative(): boolean {
  if (IS_NATIVE_BUILD) return true;
  if (typeof window === "undefined") return false;
  if ((window as any).Capacitor?.isNativePlatform?.() === true) return true;
  if (window.location.hostname === "localhost") return true;
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
    mutations: {
      retry: false,
    },
  },
});
