CREATE FUNCTION clorix_access.active_member() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.workspaces w JOIN public.memberships m ON m.workspace_id=w.id
    WHERE w.id=clorix_access.tenant() AND m.user_id=clorix_access.actor() AND m.status='active'
      AND (w.expires_at IS NULL OR w.expires_at>now())
  )
$$;
REVOKE ALL ON FUNCTION clorix_access.active_member() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invites','companies','contacts','leads','pipeline_stages','deals','deal_stage_events','tasks','activities','idempotency_keys','audit_events'] LOOP
    EXECUTE format('ALTER POLICY tenant ON %I USING (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member())) WITH CHECK (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()))',t);
  END LOOP;
END $$;
