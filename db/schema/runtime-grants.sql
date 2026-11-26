GRANT USAGE ON SCHEMA public,clorix_access TO clorix_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON "user",session,account,verification TO clorix_runtime;
GRANT SELECT ON workspaces,memberships,pipeline_stages,invites,companies,contacts,leads,deals,tasks,activities,deal_stage_events,idempotency_keys,audit_events TO clorix_runtime;
GRANT UPDATE ON workspaces,memberships TO clorix_runtime;
GRANT INSERT,UPDATE ON invites,companies,contacts,leads,deals,tasks TO clorix_runtime;
GRANT INSERT ON activities,deal_stage_events,idempotency_keys,audit_events TO clorix_runtime;
GRANT DELETE ON idempotency_keys TO clorix_runtime;
GRANT EXECUTE ON FUNCTION clorix_access.actor(),clorix_access.tenant(),clorix_access.consume_quota(text,int,int),
  clorix_access.cleanup_guests(int,boolean),clorix_access.register_private(text,text,text,text),
  clorix_access.accept_invite(text),clorix_access.record_limit() TO clorix_runtime;
GRANT EXECUTE ON FUNCTION clorix_access.active_member() TO clorix_runtime;
GRANT DELETE ON leads TO clorix_runtime;
GRANT EXECUTE ON FUNCTION clorix_access.authorized_member(uuid,boolean) TO clorix_runtime;
GRANT SELECT ON sales_pipelines TO clorix_runtime;
GRANT EXECUTE ON FUNCTION clorix_access.admit_sandbox(text,text,text,int,text) TO clorix_runtime;
