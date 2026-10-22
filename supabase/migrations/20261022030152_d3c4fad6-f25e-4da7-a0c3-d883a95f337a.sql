REVOKE ALL ON FUNCTION public.enforce_paid_team_capacity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.protect_subscription_entitlements() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.club_team_capacity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_paid_team_capacity() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_subscription_entitlements() TO service_role;
GRANT EXECUTE ON FUNCTION public.club_team_capacity(uuid) TO service_role;