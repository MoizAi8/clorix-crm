CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(120) NOT NULL, channel varchar(60) NOT NULL, objective varchar(1200) NOT NULL DEFAULT '',
  starts_on date NOT NULL, ends_on date NOT NULL, status varchar(15) NOT NULL
    CHECK(status IN ('planned','active','completed','cancelled')),
  budget_minor bigint NOT NULL CHECK(budget_minor BETWEEN 0 AND 9999999999999),
  cost_minor bigint NOT NULL CHECK(cost_minor BETWEEN 0 AND 9999999999999),
  version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), CHECK(ends_on>=starts_on)
);
CREATE UNIQUE INDEX campaign_unique_name ON campaigns(workspace_id,lower(name));
CREATE TABLE campaign_attribution (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE, campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL, attributed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,lead_id),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX campaign_attributed_leads ON campaign_attribution(workspace_id,campaign_id,lead_id);

CREATE TABLE email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(100) NOT NULL,category varchar(60) NOT NULL,subject varchar(200) NOT NULL,body varchar(5000) NOT NULL,
  version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX unique_email_template ON email_templates(workspace_id,lower(name));
CREATE TABLE email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  template_id uuid NOT NULL,contact_id uuid NOT NULL,deal_id uuid,
  subject varchar(350) NOT NULL,body varchar(9000) NOT NULL,
  actor_member_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,template_id) REFERENCES email_templates(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id),
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE INDEX email_draft_history ON email_drafts(workspace_id,created_at DESC);

CREATE TABLE custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  entity varchar(12) NOT NULL CHECK(entity IN ('leads','contacts','companies','deals')),
  name varchar(80) NOT NULL, data_type varchar(14) NOT NULL
    CHECK(data_type IN ('text','number','date','boolean','single_select','multi_select')),
  options text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK(cardinality(options)<=15),
  active boolean NOT NULL DEFAULT true,version int NOT NULL DEFAULT 1,
  UNIQUE(workspace_id,id,entity)
);
CREATE UNIQUE INDEX unique_custom_field ON custom_field_definitions(workspace_id,entity,lower(name));
CREATE TABLE custom_field_values (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,definition_id uuid NOT NULL,
  entity varchar(12) NOT NULL,lead_id uuid,contact_id uuid,company_id uuid,deal_id uuid,
  value jsonb NOT NULL,version int NOT NULL DEFAULT 1,
  CONSTRAINT unique_custom_value UNIQUE NULLS NOT DISTINCT
    (workspace_id,definition_id,lead_id,contact_id,company_id,deal_id),
  FOREIGN KEY(workspace_id,definition_id,entity) REFERENCES custom_field_definitions(workspace_id,id,entity),
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id) ON DELETE CASCADE,
  CHECK(num_nonnulls(lead_id,contact_id,company_id,deal_id)=1),
  CHECK((lead_id IS NOT NULL)=(entity='leads') AND (contact_id IS NOT NULL)=(entity='contacts')
    AND (company_id IS NOT NULL)=(entity='companies') AND (deal_id IS NOT NULL)=(entity='deals'))
);

CREATE TABLE saved_workspace_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user" ON DELETE CASCADE,kind varchar(10) NOT NULL CHECK(kind IN ('report','view')),
  name varchar(80) NOT NULL, specification jsonb NOT NULL, version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX saved_workspace_preset_name ON saved_workspace_presets(workspace_id,user_id,kind,lower(name));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaigns','campaign_attribution','email_templates','email_drafts','custom_field_definitions','custom_field_values','saved_workspace_presets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING(true) WITH CHECK(true)',t,current_user);
    IF t='saved_workspace_presets' THEN
      EXECUTE format('CREATE POLICY tenant ON %I USING(workspace_id=clorix_access.tenant() AND user_id=clorix_access.actor() AND (SELECT clorix_access.active_member())) WITH CHECK(workspace_id=clorix_access.tenant() AND user_id=clorix_access.actor() AND (SELECT clorix_access.active_member()))',t);
    ELSE
      EXECUTE format('CREATE POLICY tenant ON %I USING(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member())) WITH CHECK(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()))',t);
    END IF;
  END LOOP;
END $$;

CREATE INDEX audit_events_recent ON audit_events(workspace_id,created_at DESC,id DESC);
