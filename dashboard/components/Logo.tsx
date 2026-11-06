export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-brand text-white"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.31) }}
    >
      <svg viewBox="0 0 20 20" width={size * 0.56} height={size * 0.56} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 2v16M14 2v16M6 6h8M6 10h8M6 14h8" />
      </svg>
    </span>
  );
}
