import { z } from "zod";
import type { Stage, RecordRow } from "@/lib/crm";
import { AppError } from "@/server/http";
import type { Context } from "@/server/workspace/context";

export type Report = {
  from:string;to:string; open_minor:string; won_minor:string; weighted_minor:string;
  active_leads:number; won_count:number; lost_count:number; overdue:number; upcoming:number;
  stages:Stage[]; trend:{month:string;amount_minor:string;count:number}[];
  recent:RecordRow[]; activity:RecordRow[]; follow_up:{id:string;entity:"tasks"|"deals"|"leads";title:string;reason:string;due_at:string|null}[];
};

export async function stageTotals({client,workspace}:Context) {
  return (await client.query<Stage>(`SELECT s.id,s.name,s.kind,s.sort_order,s.probability,
    count(d.id)::integer AS count,coalesce(sum(d.amount_minor),0)::text AS amount_minor
    FROM pipeline_stages s LEFT JOIN deals d ON d.workspace_id=s.workspace_id AND d.stage_id=s.id AND d.archived_at IS NULL
    WHERE s.workspace_id=$1 GROUP BY s.id ORDER BY s.sort_order`,[workspace.id])).rows;
}

export async function board(context:Context) {
  const stages=await stageTotals(context);
  const deals=(await context.client.query<RecordRow>(`SELECT d.*,c.name AS company_name,s.name AS stage_name,s.kind AS stage_kind
    FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id LEFT JOIN companies c ON c.id=d.company_id
    WHERE d.workspace_id=$1 AND d.archived_at IS NULL ORDER BY s.sort_order,d.rank,d.id LIMIT 1000`,[context.workspace.id])).rows;
  return {stages,deals};
}

export async function report(context:Context,query:URLSearchParams):Promise<Report> {
  const {client,workspace}=context;
  const from=z.iso.date().nullable().parse(query.get("from"));
  const to=z.iso.date().nullable().parse(query.get("to"));
  const {rows:[range]}=await client.query<{from:string;to:string;days:number}>(`WITH range AS (
    SELECT coalesce($1::date,(date_trunc('month',now() AT TIME ZONE $3)-interval '5 months')::date) AS first,
           coalesce($2::date,(now() AT TIME ZONE $3)::date) AS last)
    SELECT first::text AS "from",last::text AS "to",last-first AS days FROM range`,[from,to,workspace.timezone]);
  if (range.days<0 || range.days>730) throw new AppError(422,"date_range","Choose a valid date range of at most two years.");
  const params=[workspace.id,range.from,range.to,workspace.timezone];
  const {rows:[totals]}=await client.query<Omit<Report,"from"|"to"|"stages"|"trend"|"recent"|"activity"|"follow_up">>(`
    WITH span AS (SELECT $2::date::timestamp AT TIME ZONE $4 AS first,($3::date+1)::timestamp AT TIME ZONE $4 AS last),
    current_deals AS (
      SELECT d.amount_minor,s.kind,s.probability,(d.actual_closed_at>=span.first AND d.actual_closed_at<span.last) AS in_range
      FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id,span WHERE d.workspace_id=$1 AND d.archived_at IS NULL
    )
    SELECT coalesce(sum(amount_minor) FILTER(WHERE kind='open'),0)::text AS open_minor,
      coalesce(sum(amount_minor) FILTER(WHERE kind='won' AND in_range),0)::text AS won_minor,
      coalesce(sum((amount_minor*probability+50)/100) FILTER(WHERE kind='open'),0)::text AS weighted_minor,
      count(*) FILTER(WHERE kind='won' AND in_range)::int AS won_count,count(*) FILTER(WHERE kind='lost' AND in_range)::int AS lost_count,
      (SELECT count(*)::int FROM leads WHERE workspace_id=$1 AND archived_at IS NULL AND status IN ('new','contacted','qualified')) AS active_leads,
      (SELECT count(*)::int FROM tasks WHERE workspace_id=$1 AND archived_at IS NULL AND status='open' AND due_at<now()) AS overdue,
      (SELECT count(*)::int FROM tasks WHERE workspace_id=$1 AND archived_at IS NULL AND status='open' AND due_at>=now() AND due_at<now()+interval '7 days') AS upcoming
    FROM current_deals`,params);
  const trend=(await client.query<Report["trend"][number]>(`
    WITH months AS (
      SELECT generate_series(date_trunc('month',$2::date::timestamp),date_trunc('month',$3::date::timestamp),interval '1 month') AS month
    ), wins AS (
      SELECT date_trunc('month',d.actual_closed_at AT TIME ZONE $4) AS month,sum(d.amount_minor) AS amount,count(*) AS count
      FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id
      WHERE d.workspace_id=$1 AND d.archived_at IS NULL AND s.kind='won'
      AND d.actual_closed_at>=$2::date::timestamp AT TIME ZONE $4 AND d.actual_closed_at<($3::date+1)::timestamp AT TIME ZONE $4
      GROUP BY 1
    ) SELECT to_char(months.month,'YYYY-MM') AS month,coalesce(wins.amount,0)::text AS amount_minor,coalesce(wins.count,0)::int AS count
    FROM months LEFT JOIN wins USING(month) ORDER BY months.month`,params)).rows;
  const stages=await stageTotals(context);
  const recent=(await client.query<RecordRow>(`SELECT d.id,d.title,d.amount_minor,d.updated_at,s.name AS stage_name
    FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id
    WHERE d.workspace_id=$1 AND d.archived_at IS NULL ORDER BY d.updated_at DESC,d.id LIMIT 5`,[workspace.id])).rows;
  const activity=(await client.query<RecordRow>(`SELECT a.id,a.kind,a.summary,a.occurred_at,u.name AS actor_name
    FROM activities a JOIN memberships m ON m.id=a.actor_member_id JOIN "user" u ON u.id=m.user_id
    WHERE a.workspace_id=$1 ORDER BY a.occurred_at DESC,a.id LIMIT 5`,[workspace.id])).rows;
  const follow_up=(await client.query<Report["follow_up"][number]>(`
    SELECT id,entity,title,reason,due_at FROM (
      SELECT id,'tasks' AS entity,title,CASE WHEN due_at<now() THEN 'Overdue' ELSE 'Due in the next 7 days' END AS reason,due_at,
        CASE WHEN due_at<now() THEN 0 ELSE 1 END AS weight FROM tasks
      WHERE workspace_id=$1 AND archived_at IS NULL AND status='open' AND due_at<now()+interval '7 days'
      UNION ALL SELECT d.id,'deals',d.title,'No recent logged activity',NULL,2 FROM deals d JOIN pipeline_stages s ON s.id=d.stage_id
      WHERE d.workspace_id=$1 AND d.archived_at IS NULL AND s.kind='open' AND NOT EXISTS (
       SELECT 1 FROM activities a WHERE a.workspace_id=$1 AND a.deal_id=d.id AND a.kind<>'system' AND a.occurred_at>=now()-interval '7 days')
      UNION ALL SELECT l.id,'leads',l.name,'No recent logged activity',NULL,2 FROM leads l
      WHERE l.workspace_id=$1 AND l.archived_at IS NULL AND l.status IN ('new','contacted','qualified') AND NOT EXISTS (
       SELECT 1 FROM activities a WHERE a.workspace_id=$1 AND a.lead_id=l.id AND a.kind<>'system' AND a.occurred_at>=now()-interval '7 days')
    ) queue ORDER BY weight,due_at NULLS LAST,id LIMIT 20`,[workspace.id])).rows;
  return {from:range.from,to:range.to,...totals,stages,trend,recent,activity,follow_up};
}
