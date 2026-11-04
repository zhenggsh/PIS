import type { DateStr } from "@/lib/date";
import type { ConstraintType, DepType, ProjectStatus, TaskStatus, TaskType } from "@/lib/domain/types";

/** 面向前端的视图模型（纯数据，可安全跨越 Server/Client 边界） */

export interface ProjectView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  kickoffDate: DateStr;
  preAcceptDate: DateStr;
  workweekMask: number;
  maxLeafDays: number;
  aiScanEnabled: boolean;
}

export interface TaskView {
  id: string;
  parentId: string | null;
  /** 序号（WBS 编码） */
  wbsCode: string;
  /** 项目描述 */
  name: string;
  description: string | null;
  /** 是否里程碑（含汇总） */
  taskType: TaskType;
  status: TaskStatus;
  /** 时长（工作日） */
  durationDays: number;
  /** 资源 */
  assignee: string | null;
  /** 进度 0~100 */
  progressPct: number;
  /** 进展描述 */
  progressNote: string | null;
  /** 起始时间（由依赖 + 工期推算） */
  plannedStart: DateStr | null;
  /** 终止时间（由依赖 + 工期推算） */
  plannedEnd: DateStr | null;
  actualStart: DateStr | null;
  actualEnd: DateStr | null;
  isCritical: boolean;
  totalFloatDays: number | null;
  isKickoff: boolean;
  isPreAccept: boolean;
  constraintType: ConstraintType;
  constraintDate: DateStr | null;
  /** 前级依赖（展示用编码） */
  predecessorCodes: string[];
  /** 前级依赖（编辑用 id） */
  predecessorIds: string[];
  /** 树深度，用于缩进 */
  depth: number;
  hasChildren: boolean;
}

export interface DependencyView {
  id: string;
  predId: string;
  succId: string;
  type: DepType;
  lagDays: number;
}

export interface WorkspaceSummary {
  /** 项目预计完工（非初验点任务的最晚 plannedEnd） */
  projectFinish: DateStr | null;
  /** 初验点目标日（工作日口径快照） */
  requiredFinish: DateStr;
  /** 余量（工作日）：正数表示初验点尚有余量 */
  slackDays: number;
  criticalTaskIds: string[];
  warningMessages: string[];
}

export interface WorkspaceData {
  project: ProjectView;
  tasks: TaskView[];
  dependencies: DependencyView[];
  holidays: DateStr[];
  summary: WorkspaceSummary;
}
