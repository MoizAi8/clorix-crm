import pg from "pg";

const url=process.env.DATABASE_URL;
if(!url)throw Error("Runtime connection required.");
const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:10000});
try {
  const {rows:[result]}=await pool.query(`
    SELECT current_user AS runtime_role,r.rolsuper,r.rolbypassrls,
      has_schema_privilege(current_user,'public','CREATE') AS can_create,
      has_function_privilege(current_user,'clorix_access.init_workspace(uuid,text,text,timestamptz)','EXECUTE') AS can_bootstrap_any_workspace,
      (SELECT count(*)::int FROM leads) AS leads_without_context,
      (SELECT count(*)::int FROM memberships) AS memberships_without_context,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner<>r.oid) AS forced_nonowner_tables
    FROM pg_roles r WHERE r.rolname=current_user`);
  if(result.runtime_role!=="clorix_runtime"||result.rolsuper||result.rolbypassrls||result.can_create||
    result.can_bootstrap_any_workspace||result.leads_without_context||result.memberships_without_context||result.forced_nonowner_tables!==13) {
    throw new Error("Unexpected runtime privileges.");
  }
  console.log(JSON.stringify(result));
} catch(error) {
  console.error("Runtime verification failed:",error.code??error.message);
  process.exitCode=1;
} finally {
  await pool.end();
}
