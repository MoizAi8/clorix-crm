CREATE TABLE record_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  entity varchar(12) NOT NULL,lead_id uuid,contact_id uuid,company_id uuid,deal_id uuid,
  filename varchar(100) NOT NULL,media_type varchar(30) NOT NULL
    CHECK(media_type IN ('application/pdf','image/png','image/jpeg','text/plain')),
  contents bytea NOT NULL, size_bytes integer GENERATED ALWAYS AS (octet_length(contents)) STORED,
  uploader_member_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,lead_id) REFERENCES leads(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,deal_id) REFERENCES deals(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,uploader_member_id) REFERENCES memberships(workspace_id,id),
  CHECK(size_bytes BETWEEN 1 AND 262144),
  CHECK(entity IN ('leads','contacts','companies','deals') AND num_nonnulls(lead_id,contact_id,company_id,deal_id)=1),
  CHECK((lead_id IS NOT NULL)=(entity='leads') AND (contact_id IS NOT NULL)=(entity='contacts')
    AND (company_id IS NOT NULL)=(entity='companies') AND (deal_id IS NOT NULL)=(entity='deals'))
);
CREATE INDEX record_attachment_workspace ON record_attachments(workspace_id,created_at DESC,id);
ALTER TABLE record_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_attachments FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  EXECUTE format('CREATE POLICY migrator ON record_attachments TO %I USING(true) WITH CHECK(true)',current_user);
END $$;
CREATE POLICY private_attachments ON record_attachments
  USING(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()) AND
    EXISTS(SELECT 1 FROM workspaces WHERE id=workspace_id AND kind='private'))
  WITH CHECK(workspace_id=clorix_access.tenant() AND (SELECT clorix_access.active_member()) AND
    EXISTS(SELECT 1 FROM workspaces WHERE id=workspace_id AND kind='private'));
CREATE POLICY attachments_delete_policy ON record_attachments AS RESTRICTIVE FOR DELETE
  USING(clorix_access.authorized_member(workspace_id,true) OR
    EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=record_attachments.workspace_id
      AND m.id=record_attachments.uploader_member_id AND m.user_id=clorix_access.actor() AND m.status='active')
    OR current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='record_attachments'::regclass));
