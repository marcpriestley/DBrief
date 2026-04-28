import { useQuery } from "@tanstack/react-query";

export type SubscriptionStatus = 'free' | 'beta' | 'premium' | 'cancelled';

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  isPremium: boolean;
  currentPeriodEnd: string | null;
}

/**
 * Returns the current user's subscription status.
 * Since subscriptionStatus is included in /api/auth/me, this hook
 * reads from that cached query — no extra network call.
 */
export function useSubscription(): { isPremium: boolean; status: SubscriptionStatus; isLoading: boolean } {
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  return {
    isPremium: user?.isPremium === true,
    status: (user?.subscriptionStatus as SubscriptionStatus) ?? 'free',
    isLoading,
  };
}
