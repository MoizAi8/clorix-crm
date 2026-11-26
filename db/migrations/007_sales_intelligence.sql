CREATE TABLE sales_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(80) NOT NULL CHECK(length(trim(name))>0), version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX sales_pipeline_name ON sales_pipelines(workspace_id,lower(name));
ALTER TABLE pipeline_stages ADD COLUMN pipeline_id uuid;
ALTER TABLE pipeline_stages ADD COLUMN version int NOT NULL DEFAULT 1;
ALTER TABLE pipeline_stages ADD CONSTRAINT stage_pipeline_fk
  FOREIGN KEY(workspace_id,pipeline_id) REFERENCES sales_pipelines(workspace_id,id);
ALTER TABLE pipeline_stages DROP CONSTRAINT pipeline_stages_workspace_id_sort_order_key;
ALTER TABLE pipeline_stages ADD CONSTRAINT stage_position UNIQUE NULLS NOT DISTINCT
  (workspace_id,pipeline_id,sort_order) DEFERRABLE INITIALLY IMMEDIATE;
CREATE UNIQUE INDEX stage_name_per_pipeline ON pipeline_stages(workspace_id,pipeline_id,lower(name)) NULLS NOT DISTINCT;

ALTER TABLE deal_stage_events ADD COLUMN from_stage_name varchar(80);
ALTER TABLE deal_stage_events ADD COLUMN to_stage_name varchar(80);
ALTER TABLE deal_stage_events ADD COLUMN stage_probability int;
UPDATE deal_stage_events e SET from_stage_name=s.name
  FROM pipeline_stages s WHERE s.workspace_id=e.workspace_id AND s.id=e.from_stage_id;
UPDATE deal_stage_events e SET to_stage_name=s.name,stage_probability=s.probability
  FROM pipeline_stages s WHERE s.workspace_id=e.workspace_id AND s.id=e.to_stage_id;
CREATE FUNCTION clorix_access.snapshot_stage() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  SELECT name INTO NEW.from_stage_name FROM public.pipeline_stages
    WHERE id=NEW.from_stage_id AND workspace_id=NEW.workspace_id;
  SELECT name,probability INTO NEW.to_stage_name,NEW.stage_probability FROM public.pipeline_stages
    WHERE id=NEW.to_stage_id AND workspace_id=NEW.workspace_id;
  RETURN NEW;
END $$;
CREATE TRIGGER snapshot_stage BEFORE INSERT ON deal_stage_events
FOR EACH ROW EXECUTE FUNCTION clorix_access.snapshot_stage();

CREATE TABLE scoring_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces ON DELETE CASCADE, version int NOT NULL DEFAULT 1,
  lead_weights jsonb NOT NULL, health_weights jsonb NOT NULL, modified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lead_profiles (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  lead_id uuid NOT NULL, priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  tags text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK(cardinality(tags)<=12), version int NOT NULL DEFAULT 1,
  PRIMARY KEY(workspace_id,lead_id), FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX lead_profile_tags ON lead_profiles USING gin(tags);
CREATE TABLE customer_profiles (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  company_id uuid NOT NULL, lifecycle text NOT NULL DEFAULT 'prospect' CHECK(lifecycle IN ('prospect','onboarding','active','renewal','former')),
  renewal_date date, notes varchar(1500) NOT NULL DEFAULT '', tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  version int NOT NULL DEFAULT 1,
  PRIMARY KEY(workspace_id,company_id),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
  CHECK(cardinality(tags)<=12)
);
CREATE TABLE sales_targets (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  month date NOT NULL CHECK(EXTRACT(DAY FROM month)=1),
  amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=9999999999999), version int NOT NULL DEFAULT 1,
  PRIMARY KEY(workspace_id,month)
);

CREATE TABLE engine_mutations (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE, actor_id uuid NOT NULL,
  operation varchar(80) NOT NULL, request_key uuid NOT NULL, request_hash char(64) NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,actor_id,operation,request_key)
);
CREATE INDEX engine_mutations_age ON engine_mutations(workspace_id,created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_pipelines','scoring_settings','lead_profiles','customer_profiles','sales_targets','engine_mutations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING (true) WITH CHECK (true)',t,current_user);
    EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member())) WITH CHECK (workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()))',t);
  END LOOP;
END $$;
