import { z } from "zod";
import type { SearchResult } from "@/lib/crm";
import type { Context } from "@/server/workspace/context";
import { escapeLike } from "@/server/crm/records";

export async function search(context:Context,raw:string) {
  const value=z.string().trim().max(100).parse(raw);
  if (value.length<2) return [];
  const result=await context.client.query<SearchResult>(`
    (SELECT id,'leads' AS entity,name AS label FROM leads WHERE workspace_id=$1 AND archived_at IS NULL
     AND (name ILIKE $2 OR email ILIKE $2 OR company_name ILIKE $2) ORDER BY name,id LIMIT 6)
    UNION ALL (SELECT id,'contacts',name FROM contacts WHERE workspace_id=$1 AND archived_at IS NULL
     AND (name ILIKE $2 OR email ILIKE $2) ORDER BY name,id LIMIT 6)
    UNION ALL (SELECT id,'companies',name FROM companies WHERE workspace_id=$1 AND archived_at IS NULL
     AND (name ILIKE $2 OR domain ILIKE $2) ORDER BY name,id LIMIT 6)
    UNION ALL (SELECT id,'deals',title FROM deals WHERE workspace_id=$1 AND archived_at IS NULL AND title ILIKE $2 ORDER BY title,id LIMIT 6)
    UNION ALL (SELECT id,'tasks',title FROM tasks WHERE workspace_id=$1 AND archived_at IS NULL AND title ILIKE $2 ORDER BY title,id LIMIT 6)
    UNION ALL (SELECT id,'activities',summary FROM activities WHERE workspace_id=$1 AND summary ILIKE $2 ORDER BY occurred_at DESC,id LIMIT 6)
    ORDER BY entity,label,id`,[context.workspace.id,"%"+escapeLike(value)+"%"]);
  return result.rows;
}
