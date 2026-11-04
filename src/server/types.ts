import type { ImpactReport } from "@/lib/scheduler/impact";
import type { ValidationIssue } from "@/lib/validation";
import type { ConstraintType, TaskStatus, TaskType } from "@/lib/domain/types";

/** Server Action 统一返回结构（客户端据此渲染错误 / 确认框 / 影响提示） */
export interface ActionResult {
  ok: boolean;
  message?: string;
  /** 本次变更相关的校验结论（含未阻断的提示项） */
  issues?: ValidationIssue[];
  /** 影响报告（初验点是否受冲击） */
  impact?: ImpactReport;
  /** true 表示存在「建议遵循」级别的项，需要人工确认后重试 */
  needsConfirmation?: boolean;
  projectId?: string;
  taskId?: string;
}

// ============ Server Action 入参 ============

export interface CreateProjectInput {
  name: string;
  key?: string;
  description?: string;
  kickoffDate: string;
  preAcceptDate: string;
  workweekMask?: number;
  maxLeafDays?: number;
}

export interface UpdateProjectInput {
  projectId: string;
  name?: string;
  description?: string | null;
  status?: string;
  kickoffDate?: string;
  preAcceptDate?: string;
  workweekMask?: number;
  maxLeafDays?: number;
  /** 整表替换节假日（不传则不变更） */
  holidays?: string[];
  acknowledgedIssueCodes?: string[];
}

export interface CreateTaskInput {
  projectId: string;
  name: string;
  description?: string | null;
  taskType: TaskType;
  durationDays: number;
  assignee?: string | null;
  constraintType?: ConstraintType;
  constraintDate?: string | null;
  /** 前级依赖（至少 1 个；开工会与初验点除外） */
  predecessorIds?: string[];
  lagDays?: number;
  /**
   * 插入位置：新建为某任务的同级兄弟节点，并排在其下方。
   * 传入后由服务端自动定位层级、追加序号，并默认继承前级依赖（满足 V1）。
   */
  insertAfterTaskId?: string | null;
  acknowledgedIssueCodes?: string[];
}

export interface UpdateTaskInput {
  projectId: string;
  taskId: string;
  name?: string;
  description?: string | null;
  taskType?: TaskType;
  durationDays?: number;
  assignee?: string | null;
  status?: TaskStatus;
  progressPct?: number;
  progressNote?: string | null;
  constraintType?: ConstraintType;
  constraintDate?: string | null;
  /**
   * 强制指定起始日：命中校验规则 V4（建议遵循）。
   * 落地方式与「直接改写 plannedStart」不同——转为「不早于（MSO）」约束，
   * 派生字段仍由排期引擎推算，需人工确认后生效。
   */
  forcedStartDate?: string | null;
  acknowledgedIssueCodes?: string[];
}

export interface ProgressInput {
  projectId: string;
  taskId: string;
  progressPct: number;
  status?: TaskStatus;
  progressNote?: string | null;
  acknowledgedIssueCodes?: string[];
}

export type MoveDirection = "up" | "down" | "indent" | "outdent";

export interface MoveTaskInput {
  projectId: string;
  taskId: string;
  direction: MoveDirection;
  acknowledgedIssueCodes?: string[];
}

export interface DependencyInput {
  projectId: string;
  predId: string;
  succId: string;
  lagDays?: number;
  acknowledgedIssueCodes?: string[];
}

export interface UpdateDependencyInput {
  projectId: string;
  dependencyId: string;
  lagDays: number;
  acknowledgedIssueCodes?: string[];
}
