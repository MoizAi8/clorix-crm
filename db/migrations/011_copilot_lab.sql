CREATE TABLE copilot_reviewers (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user" ON DELETE CASCADE,
  jurisdiction char(2) NOT NULL CHECK(jurisdiction IN ('PK','US','CA','AU','NZ','JP','SG','IN','BR')),
  approved_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE copilot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user" ON DELETE CASCADE,
  fixture varchar(35) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),UNIQUE(workspace_id,id,user_id)
);
CREATE INDEX copilot_threads_by_user ON copilot_conversations(workspace_id,user_id,created_at DESC);
CREATE TABLE copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  conversation_id uuid NOT NULL,user_id uuid NOT NULL,
  request_key uuid NOT NULL,request_hash char(64) NOT NULL,action varchar(45) NOT NULL,
  status varchar(15) NOT NULL CHECK(status IN ('pending','completed','failed')),
  response jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
  CONSTRAINT copilot_message_owner FOREIGN KEY(workspace_id,conversation_id,user_id)
    REFERENCES copilot_conversations(workspace_id,id,user_id) ON DELETE CASCADE,
  UNIQUE(workspace_id,user_id,request_key)
);
CREATE INDEX copilot_thread_messages ON copilot_messages(workspace_id,conversation_id,created_at,id);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['copilot_reviewers','copilot_conversations','copilot_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY migrator ON %I TO %I USING(true) WITH CHECK(true)',t,current_user);
    EXECUTE format('CREATE POLICY own_conversations ON %I USING(workspace_id=clorix_access.tenant() AND user_id=clorix_access.actor() AND (SELECT clorix_access.active_member())) WITH CHECK(workspace_id=clorix_access.tenant() AND user_id=clorix_access.actor() AND (SELECT clorix_access.active_member()))',t);
  END LOOP;
END $$;
