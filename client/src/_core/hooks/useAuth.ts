import { trpc } from "@/lib/trpc";
import { hasOAuth, startLogin } from "@/const";

export function useAuth(options: { redirectOnUnauthenticated?: boolean } = {}) {
  const query = trpc.auth.me.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void query.refetch();
      if (hasOAuth) startLogin();
    },
  });
  const redirectOnUnauthenticated = options.redirectOnUnauthenticated ?? false;
  void redirectOnUnauthenticated;

  return {
    user: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    logout: () => logoutMutation.mutate(),
  };
}
