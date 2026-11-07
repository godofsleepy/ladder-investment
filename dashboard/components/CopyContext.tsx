"use client";
import { useEffect, useRef, useState } from "react";

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older or locked-down browsers: copy through a hidden field instead.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

const CopyIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);

const CheckIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/**
 * Copies a record as context for an AI assistant. Shows the record's id when it has one.
 * `wide` is the labelled button used for a whole page.
 */
export function CopyContext({
  text,
  label,
  id,
  wide = false,
}: {
  text: string;
  label: string;
  id?: number;
  wide?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await writeClipboard(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  const name = `Copy ${label} for Claude`;
  if (wide) {
    return (
      <>
        <button
          type="button"
          onClick={copy}
          title={name}
          aria-label={`Copy for Claude: ${label}`}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-fill px-4 text-sm font-semibold text-ink hover:bg-fill-strong"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy for Claude"}
        </button>
        <span role="status" className="sr-only">
          {copied ? "Copied" : ""}
        </span>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={copy}
        title={name}
        aria-label={name}
        className={`relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap tabular-nums after:absolute after:-inset-2.5 after:content-[''] ${
          copied
            ? "bg-good/12 text-good-strong"
            : "bg-fill text-ink-2 hover:bg-fill-strong hover:text-ink"
        }`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : id !== undefined ? `#${id}` : "Copy"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
