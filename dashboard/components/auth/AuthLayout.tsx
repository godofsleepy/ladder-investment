import { Logo } from "../Logo";

const POINTS = [
  "Your data is yours: each account sees only its own portfolio",
  "No broker login needed, you log trades yourself",
  "Export everything as CSV at any time",
];

/** The sign-in frame from the design. The left panel keeps its dark ink in both themes. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-wrap bg-page text-ink">
      <section className="hidden flex-[1_1_420px] flex-col justify-between gap-10 bg-[#0b1f3a] p-12 text-white md:flex">
        <div className="flex items-center gap-2.5">
          <Logo size={36} />
          <span className="text-[20px] font-bold tracking-[-0.3px]">Ladder</span>
        </div>
        <div className="flex max-w-[460px] flex-col gap-4">
          <h1 className="m-0 text-[40px] leading-[1.15] font-bold tracking-[-1px] text-balance">Every holding, and why you own it.</h1>
          <p className="m-0 text-[16px] leading-[1.55] text-[#c9d3e0]">
            Track BTC, US and IDX stocks, gold and bonds in rupiah. Keep your macro views and buy zones in one place.
          </p>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-[#c9d3e0]">
          {POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2.5">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#7fd1a7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5l3 3 7-7" />
              </svg>
              {point}
            </li>
          ))}
        </ul>
      </section>
      <main className="flex flex-[1_1_520px] flex-col items-center justify-center px-6 py-12">
        <div className="mb-8 flex items-center gap-2.5 self-center md:hidden">
          <Logo size={36} />
          <span className="text-[20px] font-bold tracking-[-0.3px]">Ladder</span>
        </div>
        <div className="flex w-full max-w-[420px] flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
