import type { PlanPatch, PlanValidationInput, ValidationIssue, ValidationTask } from "./types";

/**
 * V4 过程中的任务不得直接修改起止时间（建议遵循，CONFIRM）
 * 判定口径（设计文档 7.3.2）：只有 patch 中显式出现 plannedStart / plannedEnd 才算"直接改日期"；
 * 仅调整 durationDays / 依赖 / 约束时不触发。
 */

export function isTaskInProgress(task: ValidationTask): boolean {
  return task.status !== "NOT_STARTED" || task.actualStart !== null;
}

export function validateImmutability(
  input: PlanValidationInput,
  patch?: PlanPatch,
): ValidationIssue[] {
  if (!patch?.taskId || !patch.fields) return [];
  const { plannedStart, plannedEnd } = patch.fields;
  if (plannedStart === undefined && plannedEnd === undefined) return [];

  const task = input.tasks.find((t) => t.id === patch.taskId);
  if (!task || task.taskType === "SUMMARY" || !isTaskInProgress(task)) return [];

  return [
    {
      code: "V4_DIRECT_DATE_EDIT",
      level: "CONFIRM",
      message: `${task.wbsCode} ${task.name} 已开工（或已有实际进展），计划起止时间应由"工期 + 前级依赖"推算，不建议直接修改。`,
      targetTaskIds: [task.id],
      suggestion: "如需固定开始日，可改用「不早于约束（MSO）」，使其可被后续工期/依赖变化正确重算。",
      detail: { plannedStart, plannedEnd },
      overridable: true,
    },
  ];
}
