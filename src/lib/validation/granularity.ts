import type { PlanValidationInput, ValidationIssue } from "./types";

/** V3 分解粒度（建议遵循，CONFIRM）：一周内的工作应分解到 maxLeafDays 个工作日以内 */
export function validateGranularity(input: PlanValidationInput): ValidationIssue[] {
  const threshold = input.project.maxLeafDays;
  const offenders = input.tasks.filter(
    (task) => task.taskType === "TASK" && task.durationDays > threshold,
  );
  if (offenders.length === 0) return [];

  return offenders.map((task) => {
    const withinWeek = task.durationDays <= 5;
    const message = withinWeek
      ? `${task.wbsCode} ${task.name} 工期 ${task.durationDays} 个工作日，属于一周内的工作，建议拆分到 ${threshold} 个工作日以内的粒度。`
      : `${task.wbsCode} ${task.name} 跨 ${task.durationDays} 个工作日，超出建议粒度较多，建议拆分为多个 ≤${threshold} 个工作日的子项。`;
    return {
      code: "V3_GRANULARITY" as const,
      level: "CONFIRM" as const,
      message,
      targetTaskIds: [task.id],
      suggestion: `拆分为若干 ≤${threshold} 个工作日的子任务，或确认该工作项确实不可再分。`,
      detail: { durationDays: task.durationDays, threshold },
      overridable: true,
    };
  });
}
