import { QueryClient, QueryFunction } from "@tanstack/react-query";

// In the native Android/iOS bundle the Capacitor WebView serves files from
// https://localhost (androidScheme=https). Relative API paths like /api/auth/login
// resolve against https://localhost and are intercepted by the native layer which
// returns index.html instead of JSON. We detect this reliably by checking
// window.location.hostname at runtime — no dependency on the Capacitor JS bridge.
const NATIVE_API_BASE = "https://dbrief.replit.app";

export const isNativeBundle =
  import.meta.env.PROD &&
  typeof window !== "undefined" &&
  window.location.hostname === "localhost";

function resolveUrl(url: string): string {
  if (url.startsWith("/") && isNativeBundle) {
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
