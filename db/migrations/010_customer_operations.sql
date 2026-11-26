CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  serial int NOT NULL CHECK(serial>0),company_id uuid NOT NULL,contact_id uuid,assignee_id uuid,
  subject varchar(120) NOT NULL,description varchar(2500) NOT NULL,category varchar(80) NOT NULL,
  priority varchar(10) NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
  status varchar(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
  resolution varchar(2000) NOT NULL DEFAULT '',first_response_at timestamptz,resolved_at timestamptz,
  version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),UNIQUE(workspace_id,serial),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,assignee_id) REFERENCES memberships(workspace_id,id),
  CHECK((status IN ('resolved','closed'))=(resolved_at IS NOT NULL))
);
CREATE INDEX tickets_company_state ON support_tickets(workspace_id,company_id,status);
CREATE INDEX support_recent ON support_tickets(workspace_id,updated_at DESC,id);

CREATE TABLE support_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  ticket_id uuid NOT NULL,actor_member_id uuid NOT NULL,
  action varchar(35) NOT NULL,body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,ticket_id) REFERENCES support_tickets(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX support_timeline ON support_history(workspace_id,ticket_id,created_at DESC,id);
CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  title varchar(120) NOT NULL,kind varchar(15) NOT NULL CHECK(kind IN ('meeting','call','follow_up')),
  starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,description varchar(2000) NOT NULL DEFAULT '',
  assignee_id uuid NOT NULL,company_id uuid,lead_id uuid,deal_id uuid,cancelled boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  CHECK(ends_at>starts_at AND ends_at-starts_at<=interval '1 day'),
  FOREIGN KEY(workspace_id,assignee_id) REFERENCES memberships(workspace_id,id),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id)
);
CREATE INDEX calendar_by_start ON calendar_events(workspace_id,starts_at,id) WHERE NOT cancelled;
CREATE TABLE member_sales_targets (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE, member_id uuid NOT NULL,
  month date NOT NULL CHECK(EXTRACT(DAY FROM month)=1),
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 9999999999999),version int NOT NULL DEFAULT 1,
  PRIMARY KEY(workspace_id,member_id,month),
  FOREIGN KEY(workspace_id,member_id) REFERENCES memberships(workspace_id,id) ON DELETE CASCADE
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets','support_history','calendar_events','member_sales_targets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING(true) WITH CHECK(true)',t,current_user);
    EXECUTE format('CREATE POLICY tenant ON %I USING(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member())) WITH CHECK(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()))',t);
  END LOOP;
END $$;

CREATE FUNCTION clorix_access.team_directory() RETURNS TABLE(member_id uuid, display_name text, member_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT m.id,u.name,m.role FROM public.memberships m JOIN public."user" u ON u.id=m.user_id
  WHERE m.workspace_id=clorix_access.tenant() AND m.status='active' AND clorix_access.active_member()
$$;
REVOKE ALL ON FUNCTION clorix_access.team_directory() FROM PUBLIC;

CREATE OR REPLACE FUNCTION clorix_access.guard_commercial_currency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.currency<>OLD.currency AND (
    EXISTS (SELECT 1 FROM public.catalog_items WHERE workspace_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.billing_documents WHERE workspace_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.sales_targets WHERE workspace_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.member_sales_targets WHERE workspace_id=OLD.id)
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='commercial_currency'; END IF;
  RETURN NEW;
END $$;
