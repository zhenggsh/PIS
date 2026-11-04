import type { DateStr } from "@/lib/date";
import type { ConstraintType, TaskStatus, TaskType } from "@/lib/domain/types";

/**
 * 三级校验模型（设计文档 7.1）
 * BLOCK 必须遵循 / CONFIRM 建议遵循（确认后可绕过）/ INFO 自动扫描提示
 */
export type IssueLevel = "BLOCK" | "CONFIRM" | "INFO";

export type IssueCode =
  | "V1_NO_PREDECESSOR"
  | "V2_DEP_CYCLE"
  | "V3_GRANULARITY"
  | "V4_DIRECT_DATE_EDIT"
  | "V5_NOT_PARALLEL"
  | "V6_NOT_COMPLETE";

export interface ValidationIssue {
  code: IssueCode;
  level: IssueLevel;
  message: string;
  targetTaskIds: string[];
  suggestion?: string;
  detail?: unknown;
  overridable: boolean;
}

export interface ValidationTask {
  id: string;
  parentId: string | null;
  wbsCode: string;
  name: string;
  taskType: TaskType;
  status: TaskStatus;
  durationDays: number;
  isKickoff: boolean;
  isPreAccept: boolean;
  actualStart: DateStr | null;
}

export interface ValidationDependency {
  predId: string;
  succId: string;
  lagDays: number;
}

export interface PlanValidationInput {
  project: {
    maxLeafDays: number;
    kickoffDate: DateStr;
    preAcceptDate: DateStr;
  };
  tasks: ValidationTask[];
  dependencies: ValidationDependency[];
}

/** 本次变更的描述（用于 V4 判定"是否直接改日期"） */
export interface PlanPatch {
  taskId?: string;
  fields?: {
    plannedStart?: DateStr | null;
    plannedEnd?: DateStr | null;
    durationDays?: number;
    taskType?: TaskType;
    constraintType?: ConstraintType;
    constraintDate?: DateStr | null;
    status?: TaskStatus;
  };
}
