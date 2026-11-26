-- The operator creates the LOGIN separately and supplies credentials outside this file.
GRANT USAGE ON SCHEMA public, clorix_access TO clorix_engine;
GRANT SELECT ON workspaces,memberships,leads,contacts,companies,deals,pipeline_stages,
  deal_stage_events,tasks,activities TO clorix_engine;
GRANT EXECUTE ON FUNCTION clorix_access.actor(),clorix_access.tenant(),
  clorix_access.active_member(),clorix_access.authorized_member(uuid,boolean) TO clorix_engine;
