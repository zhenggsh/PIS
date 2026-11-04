import { validateGraph } from "./graph";
import { validateGranularity } from "./granularity";
import { validateImmutability } from "./immutability";
import type { PlanPatch, PlanValidationInput, ValidationIssue } from "./types";

export * from "./types";
export { validateGraph, validateGranularity, validateImmutability };

/**
 * 统一校验入口（设计文档 7.5）
 * 纯函数、零 IO：前端即时校验与服务端提交校验共用同一份规则。
 * input 必须反映「变更后」的计划状态；patch 用于判定 V4 的变更来源。
 */
export function validatePlan(input: PlanValidationInput, patch?: PlanPatch): ValidationIssue[] {
  return [
    ...validateGraph(input),
    ...validateGranularity(input),
    ...validateImmutability(input, patch),
  ];
}

export function issuesOfLevel(issues: ValidationIssue[], level: ValidationIssue["level"]) {
  return issues.filter((issue) => issue.level === level);
}

export function blockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issuesOfLevel(issues, "BLOCK");
}

export function confirmIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issuesOfLevel(issues, "CONFIRM");
}

/** 未被本次确认凭据覆盖的 CONFIRM 项（服务端以此拒绝落库） */
export function unacknowledgedConfirmIssues(
  issues: ValidationIssue[],
  acknowledged: readonly string[] = [],
): ValidationIssue[] {
  const acked = new Set(acknowledged);
  return confirmIssues(issues).filter((issue) => !acked.has(issue.code));
}

export function canProceed(issues: ValidationIssue[], acknowledged: readonly string[] = []): boolean {
  return blockingIssues(issues).length === 0 && unacknowledgedConfirmIssues(issues, acknowledged).length === 0;
}
