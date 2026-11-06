"use client";
import { useState } from "react";

export function PasswordField({
  name = "password",
  autoComplete,
  placeholder,
  invalid,
}: {
  name?: string;
  autoComplete: string;
  placeholder: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={name}
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={`input pr-[76px] text-[15px] ${invalid ? "border-bad" : ""}`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute top-1.5 right-1.5 h-8 rounded-lg bg-fill px-2.5 text-xs font-semibold text-ink-2"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
