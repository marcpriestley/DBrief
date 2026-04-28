import { createContext, useContext } from "react";

interface PaywallContextValue {
  openPaywall: (featureName?: string) => void;
}

const PaywallCtx = createContext<PaywallContextValue>({ openPaywall: () => {} });

export const PaywallProvider = PaywallCtx.Provider;
export function usePaywall() { return useContext(PaywallCtx); }
