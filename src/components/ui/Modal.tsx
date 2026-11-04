"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({
  open,
  title,
  desc,
  onClose,
  children,
  footer,
  widthClass = "max-w-lg",
}: {
  open: boolean;
  title: ReactNode;
  desc?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className={`mt-[5vh] mb-8 w-full ${widthClass} rounded-xl border border-line bg-panel shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {desc ? <p className="mt-0.5 text-xs text-faint">{desc}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="pis-btn pis-btn-ghost size-7 rounded-md px-0 py-0 text-base leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
