"use client";

import { useState,type FormEvent } from "react";
import { Building2,Copy,Link2,Shield,UserRound } from "lucide-react";
import { api,messageOf } from "@/lib/client";
import { labelFor } from "@/lib/crm";
import { dateTime,Empty,ErrorNotice,Loading,Title,useLoad } from "@/components/ui/primitives";
import type { Shared } from "./contracts";

type SettingsData={
  profile:{name:string;email:string|null};
  members:{id:string;name:string;email?:string;role:string;status:string}[];
  invites:{id:string;intended_email?:string;role:string;expires_at:string;used_at?:string;revoked_at?:string}[];
};

export function Settings({workspace,refresh,revision,notify}:Shared) {
  const {data,error}=useLoad<SettingsData>("settings",workspace.id,revision);
  const [failure,setFailure]=useState("");
  const [busy,setBusy]=useState(false);
  const [inviteLink,setInviteLink]=useState("");
  const editable=workspace.kind==="private"&&workspace.role==="owner";

  async function save(path:string,method:string,body:unknown,message:string) {
    setBusy(true);setFailure("");
    try {
      const {data}=await api<{link?:string}>(path,{method,body,workspace:workspace.id});
      if(data.link)setInviteLink(data.link);
      notify(message);refresh();
    } catch(caught){setFailure(messageOf(caught));}
    finally {setBusy(false);}
  }

  function values(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();return new FormData(event.currentTarget);
  }

  return <>
    <Title title="Settings" description="Review your profile and workspace access."/>
    {failure&&<ErrorNotice message={failure}/>}
    {error?<ErrorNotice message={error} action={refresh}/>:!data?<Loading label="Loading settings…"/>:<>
      <div className="details-grid">
        <article className="surface report-card">
          <div className="card-title"><h2>Profile</h2><UserRound size={19}/></div>
          {workspace.kind==="sandbox"?<p className="muted">{data.profile.name} · Synthetic evaluation profile</p>:
            <form className="editor" key={data.profile.name} onSubmit={event=>{const form=values(event);void save("profile","PATCH",{name:String(form.get("name"))},"Profile updated.");}}>
              <label>Name<input name="name" defaultValue={data.profile.name} required maxLength={100}/></label>
              <label>Email<input readOnly value={data.profile.email??""}/></label>
              <button className="button primary" disabled={busy}>Save profile</button>
            </form>}
        </article>
        <article className="surface report-card">
          <div className="card-title"><h2>Workspace</h2><Building2 size={19}/></div>
          <form className="editor" key={workspace.version} onSubmit={event=>{
            const form=values(event);if(!editable)return;
            void save("settings","PATCH",{name:form.get("name"),timezone:form.get("timezone"),currency:form.get("currency"),expected_version:workspace.version},"Workspace updated.");
          }}>
            <label>Name<input name="name" defaultValue={workspace.name} readOnly={!editable} required maxLength={100}/></label>
            <label>Time zone<input name="timezone" defaultValue={workspace.timezone} readOnly={!editable} required maxLength={100} placeholder="America/New_York"/></label>
            <label>Currency<select name="currency" defaultValue={workspace.currency} disabled={!editable}>{["USD","EUR","GBP","PKR","CAD","AUD"].map(currency=><option key={currency}>{currency}</option>)}</select></label>
            {editable&&<button className="button primary" disabled={busy}>Save workspace</button>}
            {workspace.expires_at&&<p className="muted">Expires {dateTime(workspace.expires_at,workspace.timezone,true)} ({workspace.timezone}).</p>}
          </form>
        </article>
      </div>
      <article className="surface report-card">
        <div className="card-title"><div><h2>Members</h2><p>Owners manage workspace access. Members can work with CRM records.</p></div><Shield size={20}/></div>
        <div className="member-list">{data.members.map(member=><div className="member-row" key={member.id}>
          <div><strong>{member.name}</strong>{member.email&&<small>{member.email}</small>}</div>
          {editable?<form key={member.role+member.status} onSubmit={event=>{
            const form=values(event);void save("members/"+member.id,"PATCH",{role:form.get("role"),status:form.get("status")},"Membership updated.");
          }}>
            <label><span className="sr-only">{member.name} role</span><select name="role" defaultValue={member.role}><option value="owner">Owner</option><option value="member">Member</option></select></label>
            <label><span className="sr-only">{member.name} access</span><select name="status" defaultValue={member.status}><option value="active">Active</option><option value="removed">Removed</option></select></label>
            <button className="button secondary" disabled={busy}>Update access</button>
          </form>:<span className="pill">{labelFor(member.role)}</span>}
        </div>)}</div>
      </article>
      {editable&&<article className="surface report-card">
        <div className="card-title"><div><h2>Team invitations</h2><p>Share a one-time link with someone who already has a Clorix account.</p></div><Link2 size={20}/></div>
        <form className="record-filters invite-form" onSubmit={event=>{
          const form=values(event);void save("invites","POST",{email:String(form.get("email")).trim()||null,role:form.get("role")},"Invitation created.");
        }}>
          <label>Restrict to email<input type="email" name="email" maxLength={254} placeholder="Optional"/></label>
          <label>Role<select name="role" defaultValue="member"><option value="member">Member</option><option value="owner">Owner</option></select></label>
          <button className="button primary" disabled={busy}>Create invitation</button>
        </form>
        {inviteLink&&<div className="invite-link"><label>One-time invite link<input readOnly value={inviteLink}
          onFocus={event=>event.target.select()}/></label><button className="button secondary" onClick={async()=>{
            try{await navigator.clipboard.writeText(inviteLink);notify("Invite link copied.");}
            catch{setFailure("Clipboard unavailable. Select and copy the link manually.");}
          }}><Copy size={16}/>Copy link</button></div>}
        {data.invites.length?<div className="member-list">{data.invites.map(offer=><div className="member-row" key={offer.id}>
          <div><strong>{offer.intended_email??"Any eligible account"}</strong><small>{labelFor(offer.role)} · expires {dateTime(offer.expires_at,workspace.timezone)}</small></div>
          {offer.used_at||offer.revoked_at?<span className="pill">{offer.used_at?"Used":"Revoked"}</span>:
            <button className="button secondary" disabled={busy} onClick={()=>{setInviteLink("");void save("invites/"+offer.id,"DELETE",{},"Invitation revoked.");}}>Revoke link</button>}
        </div>)}</div>:<Empty title="No recent invitations"/>}
      </article>}
    </>}
  </>;
}
