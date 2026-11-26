import Link from "next/link";
export const metadata={title:"Sandbox data and privacy"};

export default function Privacy(){
  return <main className="access-page"><section className="surface access-card">
    <Link href="/" className="back-link">Back to Clorix</Link>
    <h1>Sandbox data and privacy</h1>
    <p>Use fictional records in the sandbox and private evaluation workspaces. The sandbox creates an isolated workspace and keeps your session in an essential browser cookie.</p>
    <p>Sandbox workspaces expire after 24 hours and are eligible for automated cleanup. To limit abuse, Clorix stores keyed network counters without retaining the raw address in its quota tables.</p>
    <p>Clorix stores records in PostgreSQL. Activity logs remain inside your workspace, and follow-up recommendations run on saved records without an external AI service.</p>
  </section></main>;
}
