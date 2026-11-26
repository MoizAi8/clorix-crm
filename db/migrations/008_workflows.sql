CREATE TABLE automation_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(100) NOT NULL, trigger_type varchar(50) NOT NULL, enabled boolean NOT NULL DEFAULT false,
  conditions jsonb NOT NULL, actions jsonb NOT NULL, version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE INDEX subscribed_workflows ON automation_workflows(workspace_id,trigger_type) WHERE enabled;
CREATE TABLE automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  trigger_type varchar(50) NOT NULL, entity_type varchar(30) NOT NULL, entity_id uuid NOT NULL,
  event_key varchar(160) NOT NULL, facts jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,event_key)
);
CREATE INDEX pending_automation_events ON automation_events(workspace_id,created_at,id) WHERE processed_at IS NULL;
CREATE TABLE automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  workflow_id uuid NOT NULL, event_id uuid NOT NULL,
  status varchar(15) NOT NULL CHECK(status IN ('completed','skipped','failed')),
  attempts int NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3), detail varchar(250) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,workflow_id,event_id),
  FOREIGN KEY(workspace_id,workflow_id) REFERENCES automation_workflows(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,event_id) REFERENCES automation_events(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX recent_automation_runs ON automation_runs(workspace_id,updated_at DESC,id);
CREATE TABLE in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  recipient_id uuid NOT NULL, category varchar(30) NOT NULL, title varchar(150) NOT NULL,
  entity_type varchar(30), entity_id uuid, dedupe_key varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  UNIQUE(workspace_id,recipient_id,dedupe_key),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES memberships(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX inbox_recent ON in_app_notifications(workspace_id,recipient_id,created_at DESC);
CREATE TABLE notification_preferences (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE, recipient_id uuid NOT NULL,
  categories text[] NOT NULL, version int NOT NULL DEFAULT 1,
  PRIMARY KEY(workspace_id,recipient_id),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES memberships(workspace_id,id) ON DELETE CASCADE
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_workflows','automation_events','automation_runs','in_app_notifications','notification_preferences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING(true) WITH CHECK(true)',t,current_user);
    EXECUTE format('CREATE POLICY tenant ON %I USING(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member())) WITH CHECK(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()))',t);
  END LOOP;
END $$;

CREATE FUNCTION clorix_access.queue_crm_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE event_name text; state text; stage_name text; key_suffix text; snapshot jsonb:='{}';
BEGIN
  IF current_setting('clorix.automation',true)='1' OR clorix_access.actor() IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='leads' THEN
    IF TG_OP='INSERT' THEN event_name='lead_created';
    ELSIF NEW.status='qualified' AND OLD.status<>NEW.status THEN event_name='lead_qualified';
    END IF;
    snapshot=jsonb_build_object('source',NEW.source,'owner_member_id',NEW.owner_member_id);
  ELSIF TG_TABLE_NAME='deals' THEN
    IF TG_OP='INSERT' THEN event_name='deal_created';
    ELSIF OLD.stage_id<>NEW.stage_id THEN
      event_name='deal_stage_changed';
    END IF;
    SELECT kind,name INTO state,stage_name FROM public.pipeline_stages WHERE id=NEW.stage_id AND workspace_id=NEW.workspace_id;
    snapshot=jsonb_build_object('stage',stage_name,'amount_minor',NEW.amount_minor,'owner_member_id',NEW.owner_member_id);
    IF TG_OP='INSERT' THEN state=NULL; END IF;
  ELSIF TG_TABLE_NAME='tasks' AND TG_OP='UPDATE' THEN
    IF NEW.status='done' AND OLD.status<>NEW.status THEN event_name='task_completed'; END IF;
    snapshot=jsonb_build_object('priority',NEW.priority,'owner_member_id',NEW.owner_member_id);
  END IF;
  IF event_name IS NULL THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM public.automation_events WHERE workspace_id=NEW.workspace_id AND processed_at IS NULL)>=500 AND EXISTS (
    SELECT 1 FROM public.automation_workflows WHERE workspace_id=NEW.workspace_id AND trigger_type IN (event_name,'deal_won','deal_lost') AND enabled
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='workflow_capacity'; END IF;
  key_suffix=NEW.id::text||':'||NEW.version::text;
  INSERT INTO public.automation_events(workspace_id,trigger_type,entity_type,entity_id,event_key,facts)
  SELECT NEW.workspace_id,candidate,TG_TABLE_NAME,NEW.id,candidate||':'||key_suffix,snapshot
  FROM unnest(ARRAY[event_name,
    CASE WHEN state='won' THEN 'deal_won' WHEN state='lost' THEN 'deal_lost' END]) candidate
  WHERE candidate IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.automation_workflows
    WHERE workspace_id=NEW.workspace_id AND trigger_type=candidate AND enabled
  )
  ON CONFLICT(workspace_id,event_key) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION clorix_access.queue_crm_event() FROM PUBLIC;
CREATE TRIGGER automatic_lead_event AFTER INSERT OR UPDATE OF status ON leads
FOR EACH ROW EXECUTE FUNCTION clorix_access.queue_crm_event();
CREATE TRIGGER automatic_deal_event AFTER INSERT OR UPDATE OF stage_id ON deals
FOR EACH ROW EXECUTE FUNCTION clorix_access.queue_crm_event();
CREATE TRIGGER automatic_task_event AFTER UPDATE OF status ON tasks
FOR EACH ROW EXECUTE FUNCTION clorix_access.queue_crm_event();
