import Link from "next/link";
import {
  Activity,ArrowDownRight,ArrowRight,ArrowUpRight,BriefcaseBusiness,Building2,ChartNoAxesCombined,
  Check,ClipboardCheck,Columns3,FileUp,LayoutDashboard,Search,Users,UserRoundPlus,Menu,
} from "lucide-react";
import { RevealJourney,Walkthrough } from "@/components/marketing/walkthrough";

const journey=[
  ["Capture","Bring inbound inquiries and referrals into a single lead list.",UserRoundPlus],
  ["Qualify","Record conversations and turn qualified leads into contacts and deals.",Users],
  ["Close","Move real opportunities through your pipeline and log the outcome.",BriefcaseBusiness],
  ["Retain","Keep account history and the next follow-up together.",ClipboardCheck],
] as const;

function Logo(){return <Link className="brand" href="/" aria-label="Clorix home"><span className="brand-mark"/><span>Clorix<span>.</span></span></Link>;}

function ProductPreview(){
  return <div className="hero-art" aria-label="Illustration of the Clorix dashboard using sample values">
    <div className="halo halo-one"/><div className="halo halo-two"/>
    <div className="hero-product">
      <div className="preview-nav">
        <div className="preview-brand"><span className="brand-mark"/>Clorix.</div>
        {[["Overview",LayoutDashboard],["Leads",Users],["Deals",BriefcaseBusiness],["Pipeline",Columns3],["Tasks",ClipboardCheck]].map(([label,Icon])=>{
          const Glyph=Icon as typeof Users;
          return <div key={String(label)}><Glyph size={13}/>{String(label)}</div>;
        })}
      </div>
      <div className="preview-main">
        <div className="preview-top"><Search size={13}/> Search workspace <span>Illustrative data</span></div>
        <strong className="preview-title">Business overview</strong>
        <div className="preview-kpis"><div><span>Open pipeline</span><strong>$54,200</strong></div>
          <div><span>Active leads</span><strong>24</strong></div><div><span>Deals won</span><strong>8</strong></div></div>
        <div className="preview-panels"><div className="preview-chart"><strong>Won deal value</strong>
          <svg width="100%" height="104" viewBox="0 0 270 104" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 27H270M0 57H270M0 87H270" stroke="#dce5e0" fill="none"/>
            <path d="M0 91L48 73L95 80L140 43L183 55L225 30L270 13V104H0Z" fill="#eaf8f0"/>
            <path d="M0 91L48 73L95 80L140 43L183 55L225 30L270 13" stroke="#205b49" strokeWidth="3" fill="none"/>
          </svg></div>
          <div className="preview-stages"><strong>Pipeline stages</strong>{["New","Qualified","Proposal","Won"].map((name,index)=>
            <div key={name}><span>{name}</span><i style={{width:(95-index*18)+"%"}}/></div>)}</div></div>
        <div className="preview-table"><strong>Recent deals</strong><div><span>Juniper project</span><b>Proposal</b></div><div><span>Riverglass discovery</span><b>Qualified</b></div></div>
      </div>
    </div>
    <div className="hero-notification"><span><Check size={18}/></span><div><strong>Deal moved to Closed Won</strong><small>Example workspace activity</small></div></div>
  </div>;
}

export default function Home(){
  return <main className="marketing">
    <div className="hero-shell marketing-dark">
      <header className="marketing-header container"><Logo/><nav aria-label="Main navigation">
        <a href="#product">Product</a><a href="#features">Features</a><a href="#journey">How it works</a>
      </nav><details className="marketing-mobile-nav"><summary aria-label="Show marketing navigation"><Menu size={22}/></summary><nav aria-label="Mobile marketing navigation"><a href="#product">Product</a><a href="#features">Features</a><a href="#journey">How it works</a></nav></details><div className="actions"><Link href="/sign-in" className="sign-in-link">Sign in</Link>
        <Link href="/sandbox" className="button primary header-cta">Try live sandbox <ArrowUpRight size={16}/></Link></div></header>
      <section className="hero container" aria-labelledby="hero-heading">
        <div className="hero-copy"><h1 id="hero-heading">From lead<br/>to <em>loyalty.</em></h1>
          <p>Track every opportunity, keep customer history in reach, and know exactly who needs a follow-up.</p>
          <div className="actions"><Link href="/sandbox" className="button primary">Try live sandbox <ArrowUpRight size={18}/></Link>
            <a href="#journey" className="button outline">See how it works <ArrowDownRight size={17}/></a></div>
          <small>Fictional data · No invitation required</small>
        </div><ProductPreview/>
      </section>
    </div>
    <section id="journey" className="marketing-section white"><div className="container">
      <h2>Every relationship, one connected journey.</h2>
      <RevealJourney>{journey.map(([name,description,Icon])=><article key={name}><span className="feature-icon"><Icon size={22}/></span>
        <h3>{name}</h3><p>{description}</p></article>)}</RevealJourney>
    </div></section>
    <section id="features" className="marketing-section soft"><div className="container">
      <h2>Everything you need to move a deal forward.</h2>
      <div className="bento">
        {[
          [Building2,"Connected customer records","See contacts, companies, deals and tasks together on relationship pages."],
          [Columns3,"A pipeline you can move","Drag deals between stages or use the accessible move menu."],
          [Activity,"Context for the next conversation","Log calls, meetings, emails and notes in a shared timeline."],
          [ChartNoAxesCombined,"Reports grounded in your records","Review won value, win rate and a weighted forecast from saved deals."],
          [Search,"Find a record in seconds","Open workspace search with Ctrl or Cmd + K."],
          [FileUp,"Bring your records with you","Preview lead and contact CSVs, resolve errors and export scoped records."],
        ].map(([Icon,title,body])=>{
          const Glyph=Icon as typeof Users;
          return <article key={String(title)}><span className="feature-icon"><Glyph size={22}/></span><h3>{String(title)}</h3><p>{String(body)}</p></article>;
        })}
      </div>
    </div></section>
    <section id="product" className="marketing-section product-dark"><div className="container"><Walkthrough/></div></section>
    <section id="questions" className="marketing-section white"><div className="container faq"><div><h2>Before you start</h2>
      <p>Clorix is a personal evaluation CRM for exploring sales workflows with fictional data.</p></div>
      <div><details><summary>Do I need an account?</summary><p>The live sandbox starts without an invitation. Private workspaces use an account invitation.</p></details>
        <details><summary>How long do my changes last?</summary><p>Your sandbox saves records to its own workspace and expires after 24 hours. Keep the same browser session to return.</p></details>
        <details><summary>Does Clorix send email or text messages?</summary><p>Activity records capture notes about conversations and messages. Clorix provides no external delivery.</p></details></div>
    </div></section>
    <section className="marketing-section closing"><div className="container"><h2>From lead to loyalty.</h2>
      <Link href="/sandbox" className="button primary">Try live sandbox <ArrowRight size={19}/></Link></div></section>
    <footer className="marketing-footer"><div className="container"><Logo/><div><Link href="/privacy">Sandbox data and privacy</Link><Link href="/accessibility">Accessibility</Link><a href="https://github.com/MoizAi8/clorix-crm">Source on GitHub</a></div></div></footer>
  </main>;
}
