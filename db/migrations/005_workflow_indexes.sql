CREATE INDEX activity_lead_recent ON activities(workspace_id,lead_id,occurred_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX activity_deal_recent ON activities(workspace_id,deal_id,occurred_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX activity_contact_recent ON activities(workspace_id,contact_id,occurred_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX deal_contact_active ON deals(workspace_id,contact_id) WHERE contact_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX contact_company_active ON contacts(workspace_id,company_id) WHERE company_id IS NOT NULL AND archived_at IS NULL;
