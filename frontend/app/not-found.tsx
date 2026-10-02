import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <div className="not-found-brand"><span className="not-found-mark">h.</span><b>hire<span>swarm</span></b></div>
        <p className="not-found-kicker">404 · PAGE NOT FOUND</p>
        <h1 id="not-found-title">That workspace page<br />isn&apos;t here.</h1>
        <p>It may have moved, or the link may be incomplete. Your application work stays on the workspace — nothing has been submitted or changed.</p>
        <div className="not-found-actions">
          <Link href="/workspace">Return to workspace <span>→</span></Link>
          <Link className="not-found-secondary" href="/applications">View applications</Link>
        </div>
        <small>You approve everything · Source-linked work examples · No automatic applications</small>
      </section>
    </main>
  );
}
