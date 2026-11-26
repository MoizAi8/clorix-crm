REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA clorix_access;
REVOKE ALL ON SCHEMA clorix_access FROM PUBLIC;

CREATE TABLE "user" (
  id uuid PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "isAnonymous" boolean DEFAULT false
);
CREATE TABLE session (
  id uuid PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text UNIQUE NOT NULL,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text,
  "userId" uuid NOT NULL REFERENCES "user" ON DELETE CASCADE
);
CREATE INDEX sessions_by_user ON session("userId");
CREATE TABLE account (
  id uuid PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES "user" ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user ON account("userId");
CREATE TABLE verification (
  id uuid PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','EUR','GBP','PKR','CAD','AUD')),
  timezone varchar(100) NOT NULL DEFAULT 'UTC',
  kind text NOT NULL CHECK (kind IN ('private','sandbox')), expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES "user" ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='sandbox') = (expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX sandbox_identity ON workspaces(created_by) WHERE kind='sandbox';
CREATE INDEX sandbox_expiry ON workspaces(expires_at) WHERE kind='sandbox';

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user" ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('owner','member')), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id,id), UNIQUE(workspace_id,user_id)
);
CREATE INDEX membership_lookup ON memberships(user_id,status,workspace_id);

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, intended_email varchar(254), role text NOT NULL CHECK(role IN ('owner','member')),
  expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES "user", created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clorix_access.registration (
  token_hash text PRIMARY KEY, intended_email varchar(254) NOT NULL, workspace_name varchar(100) NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE clorix_access.quota (
  scope text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX quotas_expiry ON clorix_access.quota(expires_at);
CREATE TABLE clorix_access.sandbox_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), ttl_hours int NOT NULL DEFAULT 24 CHECK (ttl_hours BETWEEN 1 AND 72),
  max_active int NOT NULL DEFAULT 30 CHECK (max_active BETWEEN 1 AND 100),
  max_records int NOT NULL DEFAULT 500 CHECK (max_records BETWEEN 100 AND 2000)
);
INSERT INTO clorix_access.sandbox_policy DEFAULT VALUES;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK(length(trim(name)) > 0), domain varchar(253), industry varchar(100), website varchar(500), notes varchar(2000),
  archived_at timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id,id)
);
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK(length(trim(name)) > 0), email varchar(254), phone varchar(40), title varchar(120),
  company_id uuid, owner_member_id uuid,
  archived_at timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,owner_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK(length(trim(name)) > 0), email varchar(254), phone varchar(40), company_name varchar(120),
  source varchar(80), status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','qualified','disqualified','converted')),
  owner_member_id uuid, converted_contact_id uuid, converted_deal_id uuid,
  archived_at timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,owner_member_id) REFERENCES memberships(workspace_id,id),
  FOREIGN KEY(workspace_id,converted_contact_id) REFERENCES contacts(workspace_id,id),
  CHECK ((status='converted') = (converted_contact_id IS NOT NULL AND converted_deal_id IS NOT NULL))
);
CREATE TABLE pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name varchar(80) NOT NULL, kind text NOT NULL CHECK(kind IN ('open','won','lost')),
  sort_order int NOT NULL, probability int NOT NULL CHECK(probability BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,sort_order)
);
CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  title varchar(120) NOT NULL CHECK(length(trim(title)) > 0), stage_id uuid NOT NULL, company_id uuid, contact_id uuid, lead_id uuid,
  owner_member_id uuid, amount_minor bigint NOT NULL DEFAULT 0 CHECK(amount_minor BETWEEN 0 AND 9999999999999),
  expected_close_date date, actual_closed_at timestamptz, lost_reason varchar(500), rank int NOT NULL DEFAULT 0,
  archived_at timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,lead_id),
  FOREIGN KEY(workspace_id,stage_id) REFERENCES pipeline_stages(workspace_id,id),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY(workspace_id,owner_member_id) REFERENCES memberships(workspace_id,id)
);
ALTER TABLE leads ADD CONSTRAINT converted_deal_fk FOREIGN KEY(workspace_id,converted_deal_id) REFERENCES deals(workspace_id,id);
CREATE TABLE deal_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  deal_id uuid NOT NULL, from_stage_id uuid, to_stage_id uuid NOT NULL, actor_member_id uuid NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(), from_status text, to_status text NOT NULL,
  amount_minor bigint NOT NULL, reason varchar(500),
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id),
  FOREIGN KEY(workspace_id,from_stage_id) REFERENCES pipeline_stages(workspace_id,id),
  FOREIGN KEY(workspace_id,to_stage_id) REFERENCES pipeline_stages(workspace_id,id),
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  title varchar(120) NOT NULL CHECK(length(trim(title)) > 0), description varchar(2000), owner_member_id uuid,
  due_at timestamptz, priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')), completed_at timestamptz,
  lead_id uuid, contact_id uuid, company_id uuid, deal_id uuid,
  archived_at timestamptz, version int NOT NULL DEFAULT 1, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id,id), CHECK((status='done') = (completed_at IS NOT NULL)),
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id),
  FOREIGN KEY(workspace_id,owner_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('call','meeting','email','note','system')), summary varchar(2000) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), actor_member_id uuid NOT NULL,
  lead_id uuid, contact_id uuid, company_id uuid, deal_id uuid, task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id),
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id),
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id),
  FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);
CREATE TABLE idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE, operation text NOT NULL, key_hash text NOT NULL,
  request_hash text NOT NULL, result jsonb NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
  PRIMARY KEY(workspace_id,operation,key_hash)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  actor_member_id uuid NOT NULL, event_type varchar(80) NOT NULL, resource_type varchar(80) NOT NULL,
  resource_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,actor_member_id) REFERENCES memberships(workspace_id,id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','contacts','leads','deals','tasks'] LOOP
    EXECUTE format('CREATE INDEX ON %I(workspace_id,updated_at DESC,id) WHERE archived_at IS NULL',t);
  END LOOP;
END $$;
CREATE INDEX lead_email ON leads(workspace_id,email) WHERE archived_at IS NULL;
CREATE INDEX contact_email ON contacts(workspace_id,email) WHERE archived_at IS NULL;
CREATE INDEX deals_pipeline ON deals(workspace_id,stage_id,rank,id) WHERE archived_at IS NULL;
CREATE INDEX deals_closed ON deals(workspace_id,actual_closed_at) WHERE archived_at IS NULL;
CREATE INDEX tasks_due ON tasks(workspace_id,due_at) WHERE status='open' AND archived_at IS NULL;
CREATE INDEX activity_timeline ON activities(workspace_id,occurred_at DESC,id);
CREATE INDEX deal_event_timeline ON deal_stage_events(workspace_id,deal_id,event_at DESC);
