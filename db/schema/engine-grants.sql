-- The operator creates the LOGIN separately and supplies credentials outside this file.
GRANT USAGE ON SCHEMA public, clorix_access TO clorix_engine;
GRANT SELECT ON workspaces,memberships,leads,contacts,companies,deals,pipeline_stages,
  deal_stage_events,tasks,activities TO clorix_engine;
GRANT EXECUTE ON FUNCTION clorix_access.actor(),clorix_access.tenant(),
  clorix_access.active_member(),clorix_access.authorized_member(uuid,boolean) TO clorix_engine;
GRANT SELECT,INSERT,UPDATE ON sales_pipelines,scoring_settings,lead_profiles,customer_profiles,sales_targets TO clorix_engine;
GRANT INSERT,UPDATE(name,probability,sort_order,version,updated_at) ON pipeline_stages TO clorix_engine;
GRANT SELECT,INSERT,DELETE ON engine_mutations TO clorix_engine;
GRANT INSERT ON audit_events TO clorix_engine;
GRANT SELECT,INSERT,UPDATE ON automation_workflows,automation_runs,notification_preferences TO clorix_engine;
GRANT SELECT,INSERT,UPDATE,DELETE ON automation_events,in_app_notifications TO clorix_engine;
GRANT UPDATE(owner_member_id,updated_at,version) ON leads,deals TO clorix_engine;
GRANT INSERT ON tasks,activities TO clorix_engine;
GRANT EXECUTE ON FUNCTION clorix_access.record_limit() TO clorix_engine;
GRANT SELECT,INSERT,UPDATE ON catalog_items,billing_documents TO clorix_engine;
GRANT SELECT,INSERT,DELETE ON billing_lines TO clorix_engine;
GRANT SELECT,INSERT ON billing_revisions,recorded_payments TO clorix_engine;
GRANT SELECT,INSERT,UPDATE ON support_tickets,calendar_events,member_sales_targets TO clorix_engine;
GRANT SELECT,INSERT ON support_history TO clorix_engine;
GRANT EXECUTE ON FUNCTION clorix_access.team_directory() TO clorix_engine;
GRANT SELECT ON copilot_reviewers TO clorix_engine;
GRANT SELECT,INSERT,DELETE ON copilot_conversations TO clorix_engine;
GRANT SELECT,INSERT,UPDATE(status,response,completed_at) ON copilot_messages TO clorix_engine;
GRANT EXECUTE ON FUNCTION clorix_access.consume_quota(text,int,int) TO clorix_engine;

GRANT SELECT,INSERT,UPDATE ON campaigns,email_templates,custom_field_definitions,custom_field_values,saved_workspace_presets TO clorix_engine;
GRANT SELECT,INSERT,UPDATE,DELETE ON campaign_attribution TO clorix_engine;
GRANT SELECT,INSERT ON email_drafts TO clorix_engine;
GRANT SELECT ON audit_events TO clorix_engine;
DROP POLICY IF EXISTS engine_audit_owner ON audit_events;
CREATE POLICY engine_audit_owner ON audit_events AS RESTRICTIVE FOR SELECT TO clorix_engine
  USING (clorix_access.authorized_member(workspace_id,true));
