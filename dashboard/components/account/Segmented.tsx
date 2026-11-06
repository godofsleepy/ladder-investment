"use client";

export function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
  role = "radio",
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onPick: (value: T) => void;
  role?: "radio" | "tab";
}) {
  return (
    <div role={role === "radio" ? "radiogroup" : "tablist"} aria-label={label} className="flex flex-wrap gap-1 rounded-[11px] bg-fill p-[3px]">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={role}
            aria-checked={role === "radio" ? on : undefined}
            aria-selected={role === "tab" ? on : undefined}
            onClick={() => onPick(option.value)}
            className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap text-ink sm:min-h-8 ${on ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
