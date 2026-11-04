/**
 * 领域取值与展示口径（同构）
 * 说明：SQLite 不支持 Prisma enum，故枚举以字符串落库，取值集中在此处定义。
 */

export const TASK_TYPES = ["SUMMARY", "TASK", "MILESTONE"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CONSTRAINT_TYPES = ["ASAP", "MSO"] as const;
export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "CLOSED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const DEP_TYPES = ["FS", "SS", "FF", "SF"] as const;
export type DepType = (typeof DEP_TYPES)[number];

export const ROLES = ["OWNER", "PM", "MEMBER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  SUMMARY: "汇总",
  TASK: "工作项",
  MILESTONE: "里程碑",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  BLOCKED: "阻塞",
  DONE: "已完成",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "规划中",
  ACTIVE: "执行中",
  ON_HOLD: "暂停",
  CLOSED: "已关闭",
};

export const WEEKDAY_OPTIONS = [
  { label: "周一", bit: 1 },
  { label: "周二", bit: 2 },
  { label: "周三", bit: 4 },
  { label: "周四", bit: 8 },
  { label: "周五", bit: 16 },
  { label: "周六", bit: 32 },
  { label: "周日", bit: 64 },
] as const;

export const DEFAULT_WORKWEEK_MASK = 31;

export function isTaskType(value: unknown): value is TaskType {
  return TASK_TYPES.includes(value as TaskType);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

export function isConstraintType(value: unknown): value is ConstraintType {
  return CONSTRAINT_TYPES.includes(value as ConstraintType);
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus);
}

/** 汇总节点不参与依赖图（设计文档 5.2 第 2 点） */
export function participatesInDependencyGraph(taskType: TaskType): boolean {
  return taskType !== "SUMMARY";
}
