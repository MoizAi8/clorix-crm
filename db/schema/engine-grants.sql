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
