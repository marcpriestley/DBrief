import { QueryClient, QueryFunction } from "@tanstack/react-query";

// In the native Android/iOS bundle the Capacitor WebView serves local assets.
// Relative API paths like /api/auth/login get intercepted by the native layer
// and return index.html instead of JSON.
//
// We detect native context lazily on EVERY request (not once at module load)
// so there are no race conditions with Capacitor bridge initialisation.
// Two checks in order:
//  1. Capacitor.isNativePlatform() — authoritative once the bridge has loaded
//  2. hostname === "localhost" — reliable fallback (Capacitor Android serves
//     from https://localhost when no server.url is set)
const NATIVE_API_BASE = "https://dbrief.replit.app";

function checkNative(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as any).Capacitor?.isNativePlatform?.() === true) return true;
  if (window.location.hostname === "localhost") return true;
  return false;
}

// Exported for components that read it at render time (after bridge loads)
export const isNativeBundle = checkNative();

function resolveUrl(url: string): string {
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
