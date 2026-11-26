CREATE FUNCTION clorix_access.actor() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('clorix.actor',true),'')::uuid
$$;
CREATE FUNCTION clorix_access.tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('clorix.tenant',true),'')::uuid
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workspaces','memberships','invites','companies','contacts','leads','pipeline_stages','deals','deal_stage_events','tasks','activities','idempotency_keys','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING (true) WITH CHECK (true)',t,current_user);
    IF t NOT IN ('workspaces','memberships') THEN
      EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id=clorix_access.tenant()) WITH CHECK (workspace_id=clorix_access.tenant())',t);
    END IF;
  END LOOP;
END $$;

CREATE POLICY member_read ON memberships FOR SELECT
USING (workspace_id=clorix_access.tenant() OR (user_id=clorix_access.actor() AND status='active'));
CREATE POLICY member_write ON memberships FOR UPDATE
USING (workspace_id=clorix_access.tenant()) WITH CHECK (workspace_id=clorix_access.tenant());
CREATE POLICY member_insert ON memberships FOR INSERT WITH CHECK (workspace_id=clorix_access.tenant());
CREATE POLICY workspace_read ON workspaces FOR SELECT USING (
  (expires_at IS NULL OR expires_at>now()) AND EXISTS (
    SELECT 1 FROM memberships m WHERE m.workspace_id=workspaces.id AND m.user_id=clorix_access.actor() AND m.status='active'
  )
);
CREATE POLICY workspace_write ON workspaces FOR UPDATE
USING (id=clorix_access.tenant()) WITH CHECK (id=clorix_access.tenant());

CREATE FUNCTION clorix_access.consume_quota(p_scope text, p_limit int, p_seconds int)
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  INSERT INTO clorix_access.quota AS q(scope,count,expires_at)
  VALUES (p_scope,1,now()+make_interval(secs=>p_seconds))
  ON CONFLICT(scope) DO UPDATE
    SET count=CASE WHEN q.expires_at<=now() THEN 1 ELSE q.count+1 END,
        expires_at=CASE WHEN q.expires_at<=now() THEN excluded.expires_at ELSE q.expires_at END
    WHERE q.expires_at<=now() OR q.count<p_limit
  RETURNING true
$$;

CREATE FUNCTION clorix_access.init_workspace(p_user uuid,p_name text,p_kind text,p_expiry timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wk uuid; member uuid; co uuid; person uuid; lead uuid; stage uuid; deal uuid; i int;
  org text[] := ARRAY['Northwind Atelier','Mosslight Studio','Juniper Works','Cedar Bridge Labs','Riverglass Co.','Oakline Design','Fernwell Supply','Westmere Creative'];
  names text[] := ARRAY['Avery Quinn','Jordan Reed','Taylor Ellis','Casey Lin','Morgan Lane','Riley Marin','Jamie Rowan','Alex Arden','Drew Blake','Harper Vale','Sidney Wren','Sam Birch'];
BEGIN
  INSERT INTO public.workspaces(name,kind,expires_at,created_by) VALUES(p_name,p_kind,p_expiry,p_user) RETURNING id INTO wk;
  INSERT INTO public.memberships(workspace_id,user_id,role) VALUES(wk,p_user,'owner') RETURNING id INTO member;
  INSERT INTO public.pipeline_stages(workspace_id,name,kind,sort_order,probability) VALUES
    (wk,'New','open',1,10),(wk,'Qualified','open',2,30),(wk,'Proposal','open',3,60),
    (wk,'Negotiation','open',4,80),(wk,'Closed Won','won',5,100),(wk,'Closed Lost','lost',6,0);
  IF p_kind='private' THEN RETURN wk; END IF;

  FOR i IN 1..12 LOOP
    IF i<=8 THEN
      INSERT INTO public.companies(workspace_id,name,domain,industry) VALUES(wk,org[i],'studio-'||i||'.example','Design & services') RETURNING id INTO co;
    ELSE
      SELECT id INTO co FROM public.companies WHERE workspace_id=wk AND name=org[i-8];
    END IF;
    INSERT INTO public.contacts(workspace_id,name,email,title,company_id,owner_member_id)
      VALUES(wk,names[i],'contact-'||i||'@clorix.example','Project lead',co,member) RETURNING id INTO person;
    INSERT INTO public.leads(workspace_id,name,email,company_name,status,source,owner_member_id)
      VALUES(wk,names[13-i]||' (inquiry)','lead-'||i||'@clorix.example',org[(i-1)%8+1],
        (ARRAY['new','contacted','qualified'])[1+(i-1)%3],(ARRAY['Website','Referral','Event'])[1+(i-1)%3],member) RETURNING id INTO lead;

    IF i<=10 THEN
      SELECT id INTO stage FROM public.pipeline_stages WHERE workspace_id=wk AND sort_order=(ARRAY[1,2,3,4,5,5,5,6,2,3])[i];
      INSERT INTO public.deals(workspace_id,title,stage_id,company_id,contact_id,owner_member_id,amount_minor,rank,expected_close_date,actual_closed_at,lost_reason)
        VALUES(wk,'Project with '||org[(i-1)%8+1],stage,co,person,member,
          (ARRAY[1250000,830000,1640000,2100000,975000,1320000,1640000,620000,380000,775000])[i],i*100,
          current_date+i*2,CASE WHEN i BETWEEN 5 AND 8 THEN date_trunc('month',now()) - (i-5)*interval '1 month' + interval '1 hour' END,
          CASE WHEN i=8 THEN 'Project deferred' END) RETURNING id INTO deal;
      INSERT INTO public.deal_stage_events(workspace_id,deal_id,to_stage_id,actor_member_id,to_status,amount_minor)
        SELECT wk,deal,s.id,member,s.kind,d.amount_minor FROM public.pipeline_stages s,public.deals d WHERE s.id=stage AND d.id=deal;
    END IF;
    IF i<=8 THEN
      INSERT INTO public.tasks(workspace_id,title,due_at,priority,owner_member_id,contact_id,company_id,deal_id,lead_id)
        VALUES(wk,(ARRAY['Send proposal notes','Review scope','Check in','Prepare discovery call'])[1+(i-1)%4]||' · '||org[i],
          now() + (i-3)*interval '1 day',CASE WHEN i<=3 THEN 'high' ELSE 'normal' END,member,person,co,deal,lead);
      INSERT INTO public.activities(workspace_id,kind,summary,actor_member_id,occurred_at,company_id,contact_id,deal_id,lead_id)
        VALUES(wk,(ARRAY['call','note','meeting','email'])[1+(i-1)%4],
          'Discussed next steps for a fictional project with '||org[i]||'.',member,now()-i*interval '1 day',co,person,deal,lead);
    END IF;
  END LOOP;
  RETURN wk;
END $$;

CREATE FUNCTION clorix_access.provision_guest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cfg clorix_access.sandbox_policy%ROWTYPE;
BEGIN
  IF NEW."isAnonymous" IS DISTINCT FROM true THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(620102544);
  SELECT * INTO STRICT cfg FROM clorix_access.sandbox_policy;
  IF (SELECT count(*) FROM public.workspaces WHERE kind='sandbox' AND expires_at>now())>=cfg.max_active THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='sandbox_capacity';
  END IF;
  PERFORM clorix_access.init_workspace(NEW.id,'Sandbox workspace','sandbox',now()+make_interval(hours=>cfg.ttl_hours));
  RETURN NEW;
END $$;
CREATE TRIGGER provision_guest AFTER INSERT ON public."user"
FOR EACH ROW WHEN (NEW."isAnonymous" IS TRUE) EXECUTE FUNCTION clorix_access.provision_guest();

CREATE FUNCTION clorix_access.cleanup_guests(p_batch int,p_dry boolean)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE total int;
BEGIN
  WITH candidates AS (
    SELECT w.created_by FROM public.workspaces w JOIN public."user" u ON u.id=w.created_by
    WHERE w.kind='sandbox' AND w.expires_at<=now() AND u."isAnonymous" IS TRUE
      AND NOT EXISTS (SELECT 1 FROM public.memberships m JOIN public.workspaces p ON p.id=m.workspace_id
                      WHERE m.user_id=u.id AND p.kind='private')
    ORDER BY w.expires_at,w.id LIMIT least(greatest(p_batch,1),50) FOR UPDATE OF w SKIP LOCKED
  ), removed AS (
    DELETE FROM public."user" u USING candidates c WHERE NOT p_dry AND u.id=c.created_by RETURNING u.id
  )
  SELECT CASE WHEN p_dry THEN (SELECT count(*) FROM candidates) ELSE (SELECT count(*) FROM removed) END INTO total;
  IF NOT p_dry THEN
    DELETE FROM clorix_access.quota WHERE scope IN (
      SELECT scope FROM clorix_access.quota WHERE expires_at<now() ORDER BY expires_at LIMIT 50
    );
  END IF;
  RETURN total;
END $$;

CREATE FUNCTION clorix_access.register_private(
  p_token text,p_email text,p_name text,p_password_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wk_name text; identity_id uuid:=gen_random_uuid();
BEGIN
  UPDATE clorix_access.registration SET used_at=now()
  WHERE token_hash=p_token AND intended_email=p_email AND used_at IS NULL AND expires_at>now()
  RETURNING workspace_name INTO wk_name;
  IF wk_name IS NULL THEN RETURN false; END IF;
  INSERT INTO public."user"(id,name,email,"emailVerified","createdAt","updatedAt","isAnonymous")
    VALUES(identity_id,p_name,p_email,false,now(),now(),false);
  INSERT INTO public.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
    VALUES(gen_random_uuid(),identity_id::text,'credential',identity_id,p_password_hash,now(),now());
  PERFORM clorix_access.init_workspace(identity_id,wk_name,'private',null);
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END $$;

CREATE FUNCTION clorix_access.accept_invite(p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE person public."user"%ROWTYPE; offer public.invites%ROWTYPE;
BEGIN
  SELECT * INTO person FROM public."user" WHERE id=clorix_access.actor() AND "isAnonymous" IS NOT TRUE;
  IF person.id IS NULL THEN RETURN null; END IF;
  SELECT i.* INTO offer FROM public.invites i JOIN public.workspaces w ON w.id=i.workspace_id AND w.kind='private'
  WHERE i.token_hash=p_hash AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
  AND (i.intended_email IS NULL OR i.intended_email=person.email) FOR UPDATE OF i;
  IF offer.id IS NULL THEN RETURN null; END IF;
  INSERT INTO public.memberships(workspace_id,user_id,role) VALUES(offer.workspace_id,person.id,offer.role)
  ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active' WHERE memberships.status='removed';
  UPDATE public.invites SET used_at=now() WHERE id=offer.id;
  RETURN offer.workspace_id;
END $$;

CREATE FUNCTION clorix_access.record_limit() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$ SELECT max_records FROM clorix_access.sandbox_policy $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA clorix_access FROM PUBLIC;
