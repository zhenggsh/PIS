"use client";

import { Badge } from "@/components/ui/primitives";
import { summarizeImpact } from "@/lib/scheduler/impact";
import type { ValidationIssue } from "@/lib/validation";
import type { ActionResult } from "@/server/types";

const LEVEL_LABEL: Record<ValidationIssue["level"], string> = {
  BLOCK: "必须遵循",
  CONFIRM: "建议遵循",
  INFO: "提示",
};

const LEVEL_TONE: Record<ValidationIssue["level"], "danger" | "warn" | "accent"> = {
  BLOCK: "danger",
  CONFIRM: "warn",
  INFO: "accent",
};

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="flex gap-2">
          <Badge tone={LEVEL_TONE[issue.level]}>{LEVEL_LABEL[issue.level]}</Badge>
          <div className="min-w-0">
            <p className="text-xs text-fg/90">{issue.message}</p>
            {issue.suggestion ? (
              <p className="mt-0.5 text-[11px] text-faint">建议：{issue.suggestion}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ResultPanel({
  result,
  onDismiss,
}: {
  result: ActionResult;
  onDismiss: () => void;
}) {
  const ok = result.ok;
  const tone = ok
    ? result.impact
      ? summarizeImpact(result.impact).tone
      : "ok"
    : "danger";

  const border =
    tone === "ok"
      ? "border-ok/40 bg-ok/[0.07]"
      : tone === "warn"
        ? "border-warn/40 bg-warn/[0.07]"
        : "border-danger/40 bg-danger/[0.07]";

  const impact = result.impact;
  const summaryText = impact ? summarizeImpact(impact).text : (result.message ?? "");

  const visibleIssues = (result.issues ?? []).filter(
    (issue) => issue.level !== "CONFIRM" || !ok,
  );

  return (
    <section className={`rounded-xl border px-4 py-3 ${border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg">
            {ok ? (result.message ?? "操作成功") : (result.message ?? "操作未完成")}
            {ok && result.message && summaryText ? " · " : ""}
            {summaryText}
          </p>

          {impact && ok ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <Badge tone={impact.isDelayed ? "danger" : impact.slackDays === 0 ? "warn" : "ok"}>
                余量 {impact.slackDays} 天
              </Badge>
              <span className="text-faint">
                预计完工 <span className="font-mono text-muted">{impact.expectedFinish ?? "—"}</span>
              </span>
              <span className="text-faint">
                初验目标 <span className="font-mono text-muted">{impact.requiredFinish}</span>
              </span>
              {impact.newlyDelayed ? <Badge tone="danger">本次变更导致初验推迟</Badge> : null}
              {impact.newlyCritical.length > 0 ? (
                <Badge tone="warn">
                  新增 {impact.newlyCritical.length} 个关键任务：
                  {impact.newlyCritical
                    .slice(0, 5)
                    .map((entry) => entry.wbsCode)
                    .join("、")}
                </Badge>
              ) : null}
            </div>
          ) : null}

          {impact && ok && impact.changedTasks.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-faint">
              {impact.changedTasks.slice(0, 5).map((change) => (
                <li key={change.taskId} className="font-mono">
                  {change.wbsCode} {change.name}：{change.oldStart ?? "—"} → {change.newStart ?? "—"}
                  {change.deltaDays !== 0 ? (
                    <span className={change.deltaDays > 0 ? "text-danger" : "text-ok"}>
                      （{change.deltaDays > 0 ? "+" : ""}
                      {change.deltaDays} 天）
                    </span>
                  ) : null}
                </li>
              ))}
              {impact.changedTasks.length > 5 ? (
                <li>… 其余 {impact.changedTasks.length - 5} 项受影响</li>
              ) : null}
            </ul>
          ) : null}

          {visibleIssues.length > 0 ? (
            <div className="mt-2 border-t border-line-soft pt-2">
              <IssueList issues={visibleIssues} />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="pis-btn pis-btn-ghost size-6 shrink-0 px-0 py-0 text-sm"
          onClick={onDismiss}
          aria-label="关闭提示"
        >
          ×
        </button>
      </div>
    </section>
  );
}
