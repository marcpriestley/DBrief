import { QueryClient, QueryFunction } from "@tanstack/react-query";

// VITE_NATIVE_BUILD=true is set at build time when compiling for Android/iOS.
// This is more reliable than any runtime detection (hostname, Capacitor.isNativePlatform, etc.)
// because it is baked into the JS bundle and cannot be affected by bridge timing or
// URL-scheme differences between Capacitor versions.
// Build for Android/iOS with: VITE_NATIVE_BUILD=true npm run build
const IS_NATIVE_BUILD = import.meta.env.VITE_NATIVE_BUILD === "true";
const NATIVE_API_BASE = "https://DBrief.replit.app";

function resolveUrl(url: string): string {
  if (url.startsWith("/") && IS_NATIVE_BUILD) {
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
