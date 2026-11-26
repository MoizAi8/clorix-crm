import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DIRECT_DATABASE_URL) throw new Error("Set the direct admin connection.");
const pool = new pg.Pool({connectionString:process.env.DIRECT_DATABASE_URL,max:1,connectionTimeoutMillis:10000});
const [command,email,name] = process.argv.slice(2);
try {
  switch (command) {
    case "grant":
      await pool.query(await readFile(new URL("../db/schema/runtime-grants.sql",import.meta.url),"utf8"));
      console.log("Applied runtime role grants.");
      break;
    case "sandbox-policy": {
      const limits=[["SANDBOX_TTL_HOURS",1,72],["SANDBOX_MAX_ACTIVE",1,100],["SANDBOX_MAX_RECORDS",100,2000]];
      const values=limits.map(([key,min,max])=>{
        if(!process.env[key])return null;
        const value=Number(process.env[key]);
        if(!Number.isInteger(value)||value<min||value>max)throw new Error("Invalid "+key);
        return value;
      });
      const {rows:[policy]}=await pool.query(
        "UPDATE clorix_access.sandbox_policy SET ttl_hours=coalesce($1,ttl_hours),max_active=coalesce($2,max_active),max_records=coalesce($3,max_records) RETURNING ttl_hours,max_active,max_records",
        values);
      console.log(JSON.stringify(policy));
      break;
    }
    case "cleanup": {
      const dry = !process.argv.includes("--apply");
      const {rows} = await pool.query("SELECT clorix_access.cleanup_guests(25,$1) AS count",[dry]);
      console.log((dry?"Dry run, eligible expired sandboxes: ":"Removed expired sandboxes: ") + rows[0].count);
      break;
    }
    case "invite": {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name?.trim() || name.length>100) throw new Error("Usage: db:admin invite EMAIL WORKSPACE_NAME");
      const token = randomBytes(32).toString("base64url");
      const file = new URL("../artifacts/private/account-" + randomBytes(6).toString("hex") + ".txt",import.meta.url);
      const link = new URL("/register",process.env.APP_URL ?? "http://localhost:3000");
      link.hash = token;
      await pool.query("INSERT INTO clorix_access.registration(token_hash,intended_email,workspace_name,expires_at) VALUES($1,$2,$3,now()+interval '2 days')",
        [createHash("sha256").update(token).digest("hex"),email.toLowerCase(),name.trim()]);
      await mkdir(new URL("../artifacts/private/",import.meta.url),{recursive:true});
      await writeFile(file,link.href+"\n",{flag:"wx",mode:0o600});
      console.log("One-time link saved privately in " + file.pathname);
      break;
    }
    default:
      throw new Error("Choose grant, sandbox-policy, cleanup [--apply], or invite EMAIL WORKSPACE_NAME.");
  }
} catch (error) {
  console.error("Admin operation failed:",error.code ?? error.message);
  process.exitCode=1;
} finally {
  await pool.end();
}
