"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="card p-6">
      <h1 className="m-0 text-[20px] font-bold">Ladder can't read its database</h1>
      <p className="mt-1 text-[15px] text-muted">
        Postgres is probably stopped. In the ladder folder, run <code>docker compose up -d</code>, then try again.
      </p>
      <button type="button" onClick={reset} className="btn-soft mt-3">Try again</button>
    </div>
  );
}
