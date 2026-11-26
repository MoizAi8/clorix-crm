CREATE FUNCTION clorix_access.authorized_member(p_workspace uuid,p_owner boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m JOIN public.workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=p_workspace AND m.user_id=clorix_access.actor() AND m.status='active'
      AND (w.expires_at IS NULL OR w.expires_at>now())
      AND (NOT p_owner OR (m.role='owner' AND w.kind='private'))
  )
$$;
REVOKE ALL ON FUNCTION clorix_access.authorized_member(uuid,boolean) FROM PUBLIC;

ALTER POLICY member_read ON memberships USING (
  (user_id=clorix_access.actor() AND status='active') OR
  (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),false)))
);
ALTER POLICY member_write ON memberships
  USING (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)))
  WITH CHECK (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)));
ALTER POLICY member_insert ON memberships
  WITH CHECK (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)));
ALTER POLICY workspace_read ON workspaces USING (clorix_access.authorized_member(id,false));
ALTER POLICY workspace_write ON workspaces
  USING (id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)))
  WITH CHECK (id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)));
ALTER POLICY tenant ON invites
  USING (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)))
  WITH CHECK (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.authorized_member(clorix_access.tenant(),true)));

CREATE OR REPLACE FUNCTION clorix_access.active_member() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT clorix_access.authorized_member(clorix_access.tenant(),false)
$$;
