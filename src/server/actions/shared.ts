import { applyPlanChange, PlanValidationFailure, type DbClient } from "@/server/plan";
import type { ActionResult } from "@/server/types";
import type { PlanPatch } from "@/lib/validation";

/**
 * 变更执行器：把 applyPlanChange 的异常翻译成 ActionResult。
 * 非 "use server" 模块，供各 action 复用。
 */
export async function runChange(
  projectId: string,
  options: {
    action: string;
    targetType: string;
    targetId?: string | null;
    patch?: PlanPatch;
    acknowledgedIssueCodes?: string[];
    mutate: (tx: DbClient) => Promise<void>;
  },
): Promise<ActionResult> {
  try {
    const outcome = await applyPlanChange(projectId, options);
    return {
      ok: true,
      issues: outcome.issues,
      impact: outcome.impact,
      projectId,
      taskId: options.targetId ?? undefined,
    };
  } catch (error) {
    if (error instanceof PlanValidationFailure) {
      const blocking = error.issues.some((issue) => issue.level === "BLOCK");
      return {
        ok: false,
        needsConfirmation: !blocking && error.issues.length > 0,
        message: blocking
          ? "存在必须遵循的规则违规，无法保存。"
          : "存在建议遵循的规则项，请确认后重试。",
        issues: error.issues,
        projectId,
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "操作失败",
      projectId,
    };
  }
}

export function fail(message: string, projectId?: string): ActionResult {
  return { ok: false, message, projectId };
}
