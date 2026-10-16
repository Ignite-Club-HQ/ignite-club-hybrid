CREATE OR REPLACE FUNCTION public.can_view_pending_role_request_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.role_requests rr
   LEFT JOIN public.teams t ON t.id = rr.team_id
   WHERE rr.user_id = p_profile_id AND rr.status = 'pending'
     AND (public.has_role(auth.uid(), 'app_admin'::public.app_role)
       OR (COALESCE(rr.club_id,t.club_id) IS NOT NULL AND public.has_role(auth.uid(), 'club_admin'::public.app_role, COALESCE(rr.club_id, t.club_id), NULL::uuid))
       OR (rr.team_id IS NOT NULL AND
         (public.has_role(auth.uid(), 'team_admin'::public.app_role, NULL::uuid, rr.team_id)
          OR public.has_role(auth.uid(), 'coach'::public.app_role, NULL::uuid, rr.team_id))))
 );
$$;