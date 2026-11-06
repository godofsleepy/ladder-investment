"use client";
import { useEffect, useRef } from "react";

/** The canvas's sheet: Cancel, title, Save. A native dialog, so focus stays inside and Escape closes it. */
export function FormDialog({
  title,
  canSave,
  saving,
  onSave,
  onClose,
  children,
}: {
  title: string;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[440px] overflow-hidden rounded-[20px] bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(0,0,0,.18)] backdrop:bg-[#0b1f3a]/40"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-line-soft px-4 py-3.5">
        <button type="button" onClick={onClose} className="min-h-11 justify-self-start p-1 text-[15px] text-brand">Cancel</button>
        <span className="text-[16px] font-bold">{title}</span>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || saving}
          className="min-h-11 justify-self-end p-1 text-[15px] font-bold text-brand disabled:opacity-40"
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>
      <div className="flex max-h-[75dvh] flex-col gap-3.5 overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

export const fieldLabel = "flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2";
export const fieldInput = "h-[42px] w-full rounded-xl border border-line bg-surface px-3 text-sm font-normal text-ink box-border";

export function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onPick: (value: T) => void;
}) {
  return (
    <div className={fieldLabel}>
      {label}
      <div role="radiogroup" aria-label={label} className="flex h-[42px] rounded-xl bg-fill p-[3px]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            onClick={() => onPick(option.value)}
            className={`flex-1 rounded-[9px] text-sm font-semibold text-ink ${option.value === value ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,.12)]" : ""}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
