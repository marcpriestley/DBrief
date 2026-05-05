import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export interface OrgBranding {
  orgId: number;
  orgName: string;
  role: "admin" | "member";
  accentColour: string;
  aiPersonaName: string;
  logoUrl: string | null;
  subscriptionStatus: string;
}

const OrgBrandingContext = createContext<OrgBranding | null>(null);

const CORPORATE_ENABLED = import.meta.env.VITE_CORPORATE_TIER_ENABLED === "true";

export function OrgBrandingProvider({ children }: { children: React.ReactNode }) {
  const { data: branding } = useQuery<OrgBranding | null>({
    queryKey: ["/api/corporate/membership"],
    queryFn: async () => {
      if (!CORPORATE_ENABLED) return null;
      const res = await fetch("/api/corporate/membership", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: CORPORATE_ENABLED,
  });

  useEffect(() => {
    if (!branding?.accentColour) return;
    const hex = branding.accentColour.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const hsl = rgbToHsl(r, g, b);
    const hslCss = `hsl(${hsl})`;
    document.documentElement.style.setProperty("--org-accent", hsl);
    // Apply org accent as the primary theme token so all Shadcn components
    // and Tailwind bg-primary / text-primary classes reflect the org branding.
    document.documentElement.style.setProperty("--primary", hslCss);
    document.documentElement.style.setProperty("--accent", hslCss);
    document.documentElement.style.setProperty("--ring", hslCss);
    return () => {
      document.documentElement.style.removeProperty("--org-accent");
      document.documentElement.style.removeProperty("--primary");
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--ring");
    };
  }, [branding?.accentColour]);

  return (
    <OrgBrandingContext.Provider value={branding ?? null}>
      {children}
    </OrgBrandingContext.Provider>
  );
}

export function useOrgBranding(): OrgBranding | null {
  return useContext(OrgBrandingContext);
}

export function useIsOrgAdmin(): boolean {
  const b = useOrgBranding();
  return b?.role === "admin";
}

export function useIsOrgMember(): boolean {
  const b = useOrgBranding();
  return b !== null;
}

function rgbToHsl(r: number, g: number, b: number): string {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
