import { z } from "zod";
import { activityKinds, entities, leadStatuses, priorities } from "@/lib/crm";

export const identifier=z.uuid();
export const entityType=z.enum(entities);
export const version=z.number().int().positive();
const text=(max:number)=>z.string().trim().min(1).max(max);
const maybe=<T extends z.ZodType>(schema:T)=>schema.nullable().optional();
const phone=z.string().trim().max(40).regex(/^\+?[0-9][0-9 ().-]{5,38}$/, "Enter a valid phone number.");
const email=z.email().max(254).transform(value=>value.toLowerCase());
const reason=text(500);
const name=text(120);
const owner={owner_member_id:maybe(identifier)};
const lead={lead_id:maybe(identifier)};
const contact={contact_id:maybe(identifier)};
const company={company_id:maybe(identifier)};
const deal={deal_id:maybe(identifier)};
const relations={...lead,...contact,...company,...deal};
export const moneyInput=z.string().regex(/^\d{1,13}$/,"Enter a nonnegative amount in minor units.")
  .transform(value=>BigInt(value).toString());
export const timeZone=z.string().max(100).refine(zone=>{
  try { new Intl.DateTimeFormat("en",{timeZone:zone}); return true; } catch { return false; }
},"Choose a valid IANA time zone.");

export const schemas={
  leads:z.strictObject({ name,email:maybe(email),phone:maybe(phone),company_name:maybe(name),
    source:maybe(text(80)),status:z.enum(leadStatuses).optional(),...owner }),
  contacts:z.strictObject({ name,email:maybe(email),phone:maybe(phone),title:maybe(name),...company,...owner }),
  companies:z.strictObject({ name,domain:maybe(z.hostname().max(253).transform(v=>v.toLowerCase())),industry:maybe(text(100)),
    website:maybe(z.url({protocol:/^https?$/}).max(500)),notes:maybe(text(2000)) }),
  deals:z.strictObject({ title:name,stage_id:identifier.optional(),amount_minor:moneyInput.optional(),
    expected_close_date:maybe(z.iso.date()),...company,...contact,...owner }),
  tasks:z.strictObject({ title:name,description:maybe(text(2000)),due_at:maybe(z.iso.datetime({offset:true})),
    priority:z.enum(priorities).optional(),status:z.enum(["open","done"]).optional(),...relations,...owner }),
  activities:z.strictObject({ kind:z.enum(activityKinds),summary:text(2000),occurred_at:z.iso.datetime({offset:true}).optional(),
    task_id:maybe(identifier),...relations }),
};

export const moveInput=z.strictObject({
  stage_id:identifier,expected_version:version,reason:maybe(reason),before_id:maybe(identifier),
});
export const convertInput=z.strictObject({
  expected_version:version,key:z.uuid(),title:name,amount_minor:moneyInput,company_id:maybe(identifier),
  contact_id:maybe(identifier),create_contact_if_duplicate:z.boolean().optional(),
});

export const settingsInput=z.strictObject({
  name:text(100),expected_version:version,timezone:timeZone,currency:z.enum(["USD","EUR","GBP","PKR","CAD","AUD"]),
});

export const inviteInput=z.strictObject({email:maybe(email),role:z.enum(["owner","member"])});
export const membershipInput=z.strictObject({role:z.enum(["owner","member"]),status:z.enum(["active","removed"])});
