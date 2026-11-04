import { WEEKDAY_OPTIONS } from "@/lib/domain/types";

/** 工作日选择（位掩码：1=周一 … 64=周日） */
export function WeekdayPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (mask: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_OPTIONS.map((option) => {
        const active = (value & option.bit) !== 0;
        return (
          <button
            key={option.bit}
            type="button"
            onClick={() => onChange(active ? value & ~option.bit : value | option.bit)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              active
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-line bg-elevated/60 text-muted hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
