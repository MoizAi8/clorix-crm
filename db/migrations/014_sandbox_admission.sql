CREATE TABLE clorix_access.sandbox_admissions (
  browser_hash text PRIMARY KEY CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL REFERENCES public.session(id) ON DELETE CASCADE
);

CREATE FUNCTION clorix_access.admit_sandbox(
  p_browser text, p_network text, p_global text, p_network_limit int, p_session text
) RETURNS TABLE (outcome text, retry_after int, session_token text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  existing_token text;
  active_count int;
  next_expiry timestamptz;
  blocked_scope text;
  denial text;
  guest_id uuid;
  guest_session uuid;
BEGIN
  IF p_browser IS NULL OR p_browser !~ '^[0-9a-f]{64}$'
    OR p_network IS NULL OR p_network !~ '^[0-9a-f]{64}$'
    OR p_global IS NULL OR p_global !~ '^[0-9a-f]{64}$' OR p_network=p_global
    OR p_network_limit IS NULL OR p_network_limit NOT BETWEEN 1 AND 20
    OR p_session IS NULL OR p_session !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid sandbox admission';
  END IF;

  -- Share the existing seed/capacity lock. Recheck the receipt after waiting.
  PERFORM pg_advisory_xact_lock(620102544);
  SELECT s.token INTO existing_token
  FROM clorix_access.sandbox_admissions a
  JOIN public.session s ON s.id=a.session_id
  JOIN public."user" u ON u.id=s."userId" AND u."isAnonymous" IS TRUE
  JOIN public.workspaces w ON w.created_by=u.id AND w.kind='sandbox'
  JOIN public.memberships m ON m.workspace_id=w.id AND m.user_id=u.id AND m.status='active'
  WHERE a.browser_hash=p_browser AND s."expiresAt">now() AND w.expires_at>now();
  IF FOUND THEN
    RETURN QUERY SELECT 'resumed'::text, NULL::int, existing_token;
    RETURN;
  END IF;

  SELECT count(*)::int,min(expires_at) INTO active_count,next_expiry
  FROM public.workspaces WHERE kind='sandbox' AND expires_at>now();
  IF active_count >= (SELECT max_active FROM clorix_access.sandbox_policy) THEN
    RETURN QUERY SELECT 'capacity'::text, greatest(1,ceil(extract(epoch FROM next_expiry-clock_timestamp()))::int),NULL::text;
    RETURN;
  END IF;

  -- Roll back both counters if either rejects the start. A subsequent failure
  -- of the seed or session insert also rolls back both counts.
  BEGIN
    IF NOT coalesce(clorix_access.consume_quota(p_network,p_network_limit,86400),false) THEN
      blocked_scope := p_network;
      denial := 'network';
      RAISE SQLSTATE 'CR001';
    END IF;
    IF NOT coalesce(clorix_access.consume_quota(p_global,90,86400),false) THEN
      blocked_scope := p_global;
      denial := 'global';
      RAISE SQLSTATE 'CR001';
    END IF;
  EXCEPTION WHEN SQLSTATE 'CR001' THEN
    SELECT expires_at INTO next_expiry FROM clorix_access.quota WHERE scope=blocked_scope;
    RETURN QUERY SELECT denial,greatest(1,ceil(extract(epoch FROM next_expiry-clock_timestamp()))::int),NULL::text;
    RETURN;
  END;

  guest_id := gen_random_uuid();
  INSERT INTO public."user"(id,name,email,"createdAt","updatedAt","isAnonymous")
  VALUES(guest_id,'Sandbox evaluator',guest_id::text||'@sandbox.clorix.example',now(),now(),true);

  -- The existing anonymous-user trigger creates and seeds the sandbox above.
  INSERT INTO public.session(id,"expiresAt",token,"createdAt","updatedAt","userId")
  VALUES(gen_random_uuid(),now()+interval '7 days',p_session,now(),now(),guest_id)
  RETURNING id INTO guest_session;

  INSERT INTO clorix_access.sandbox_admissions(browser_hash,session_id)
  VALUES(p_browser,guest_session)
  ON CONFLICT (browser_hash) DO UPDATE SET session_id=excluded.session_id;
  PERFORM clorix_access.cleanup_guests(5,false);

  RETURN QUERY SELECT 'created'::text,NULL::int,p_session;
END;
$$;
REVOKE ALL ON FUNCTION clorix_access.admit_sandbox(text,text,text,int,text) FROM PUBLIC;
