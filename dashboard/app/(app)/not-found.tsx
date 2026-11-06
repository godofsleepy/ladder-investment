import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card p-6">
      <h1 className="m-0 text-[20px] font-bold">That isn't in Ladder</h1>
      <p className="mt-1 text-[15px] text-muted">The asset, thesis or watchlist item may have a different name, or was never added.</p>
      <Link href="/" className="btn-soft mt-3">Back to Home</Link>
    </div>
  );
}
