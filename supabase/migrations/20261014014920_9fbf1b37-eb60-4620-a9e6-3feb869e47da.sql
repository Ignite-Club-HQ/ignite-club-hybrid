CREATE OR REPLACE FUNCTION public.can_view_pending_role_request_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.role_requests rr
   LEFT JOIN public.teams t ON t.id = rr.team_id
   WHERE rr.user_id = p_profile_id AND rr.status = 'pending'
   AND EXISTS (
     SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
     AND (ur.role = 'app_admin'
       OR (ur.role = 'club_admin' AND ur.club_id = COALESCE(rr.club_id, t.club_id))
       OR (rr.team_id IS NOT NULL AND ur.team_id = rr.team_id AND ur.role IN ('team_admin','coach')))
   )
 );
$$;
REVOKE ALL ON FUNCTION public.can_view_pending_role_request_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_pending_role_request_profile(uuid) TO authenticated, service_role;
CREATE POLICY "Request managers can view pending requester profiles" ON public.profiles
FOR SELECT TO authenticated USING (public.can_view_pending_role_request_profile(id));