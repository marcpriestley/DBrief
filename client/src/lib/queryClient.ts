import { QueryClient, QueryFunction } from "@tanstack/react-query";

// On Android Capacitor, the WebView runs under https://localhost (the native bridge
// origin), NOT the remote server URL. Relative API paths like /api/auth/login
// resolve to https://localhost/api/... which the Capacitor bridge intercepts and
// serves index.html for — producing the "Unexpected token '<'" JSON parse error.
//
// We detect this by checking window.location.hostname. On Android the page runs at
// https://localhost; on iOS and web it runs at the real domain.
// Using hostname is more reliable than Capacitor.getPlatform() because it doesn't
// depend on the native bridge being fully initialised at module load time.
const ANDROID_API_BASE = "https://DBrief.replit.app";

function resolveUrl(url: string): string {
  if (
    url.startsWith("/") &&
    typeof window !== "undefined" &&
    window.location.hostname === "localhost"
  ) {
    return `${ANDROID_API_BASE}${url}`;
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
