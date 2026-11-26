"use client";

import { useState,type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight,FlaskConical } from "lucide-react";
import { api,messageOf,RequestError } from "@/lib/client";
import { ErrorNotice } from "@/components/ui/primitives";

const modes={
  sandbox:{title:"Try the live sandbox",subtitle:"Explore Clorix in your own workspace with fictional records."},
  login:{title:"Sign in",subtitle:"Open your private evaluation workspace."},
  register:{title:"Create your account",subtitle:"Use the email and one-time link from your account invitation."},
  join:{title:"Join a workspace",subtitle:"Accept the team invitation with your Clorix account."},
};

export function AccessForm({mode}:{mode:keyof typeof modes}) {
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [signedOut,setSignedOut]=useState(false);
  const [expired,setExpired]=useState(false);
  const item=modes[mode];

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form=new FormData(event.currentTarget);
    setError("");setBusy(true);setSignedOut(false);setExpired(false);
    try {
      if (mode==="join") {
        const result=await api<{id:string}>("invites/accept",{method:"POST",body:{token:window.location.hash.slice(1)}});
        window.location.replace("/workspace?space="+encodeURIComponent(result.data.id)+"&view=settings");
        return;
      }
      const body=mode==="sandbox"?{synthetic:form.has("synthetic")}:
        {email:String(form.get("email")).trim(),password:String(form.get("password")),
          ...(mode==="register"?{name:String(form.get("name")),token:window.location.hash.slice(1)||String(form.get("token")??"").trim()}: {})};
      const {data}=await api<{path:string}>("access/"+mode,{method:"POST",body});
      const next=window.location.hash;
      if (mode==="login" && /^#join=[A-Za-z0-9_-]{43}$/.test(next)) window.location.replace("/join#"+next.slice(6));
      else window.location.replace(data.path);
    } catch (caught) {
      setError(messageOf(caught));
      setSignedOut(caught instanceof RequestError && caught.status===401);
      setExpired(caught instanceof RequestError && caught.status===410);
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try { await api("access/logout",{method:"POST",body:{}});setExpired(false);setError(""); }
    catch (caught) {setError(messageOf(caught));}
    finally {setBusy(false);}
  }

  return <main className="access-page">
    <div className="access-brand"><Link href="/" className="brand"><span className="brand-mark"/><span>Clorix<span>.</span></span></Link></div>
    <form className="surface access-card" onSubmit={submit}>
      {mode==="sandbox"&&<div className="access-icon"><FlaskConical size={24}/></div>}
      <h1>{item.title}</h1><p>{item.subtitle}</p>
      {mode==="sandbox"&&<>
        <ul className="sandbox-facts"><li>Changes persist in this browser session.</li><li>The workspace expires after 24 hours.</li><li>Keep real customer and personal information out of the sandbox.</li></ul>
        <label className="check"><input type="checkbox" name="synthetic" required/>I’ll use fictional data only.</label>
      </>}
      {(mode==="login"||mode==="register")&&<>
        {mode==="register"&&<label>Name<input name="name" required maxLength={100} autoComplete="name"/></label>}
        <label>Email<input name="email" required maxLength={254} type="email" autoComplete="email"/></label>
        <label>Password<input name="password" required minLength={12} maxLength={128} type="password" autoComplete={mode==="register"?"new-password":"current-password"}/></label>
      </>}
      {error&&<ErrorNotice message={error}/>}
      {signedOut&&mode==="join"&&<Link className="button secondary" href={"/sign-in#join="+(typeof window==="undefined"?"":window.location.hash.slice(1))}>Sign in to accept</Link>}
      {expired?<button type="button" className="button secondary" onClick={logout} disabled={busy}>Sign out of expired sandbox</button>:
        <button className="button primary" disabled={busy}>{busy?"Please wait…":mode==="sandbox"?"Start sandbox":mode==="login"?"Sign in":mode==="register"?"Create account":"Accept invite"}<ArrowUpRight size={17}/></button>}
      <Link className="back-link" href={mode==="login"?"/sandbox":"/"}>{mode==="login"?"Try the public sandbox":"Back to Clorix"}</Link>
    </form>
  </main>;
}
