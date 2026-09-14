import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { useEffect } from "react";

export function useAuth(options: { redirectOnUnauthenticated?: boolean } = {}) {
  const query = trpc.auth.me.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void query.refetch();
      startLogin();
    },
  });
  const redirectOnUnauthenticated = options.redirectOnUnauthenticated ?? false;

  useEffect(() => {
    if (!redirectOnUnauthenticated || query.isLoading || query.data) return;
    startLogin();
  }, [query.data, query.isLoading, redirectOnUnauthenticated]);

  return {
    user: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    logout: () => logoutMutation.mutate(),
  };
}
