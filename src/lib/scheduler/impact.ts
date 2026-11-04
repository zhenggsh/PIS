import { compareDate, type DateStr } from "@/lib/date";
import type { Calendar } from "./calendar";
import type { ScheduledTask, ScheduleResult, SchedulerTask } from "./index";

/**
 * 初验点冲击分析（设计文档 6.3）
 * 变更前快照（数据库中已落库的派生字段）vs 变更后重算结果，输出可读的影响报告。
 */

export interface TaskScheduleSnapshot {
  id: string;
  wbsCode: string;
  name: string;
  plannedStart: DateStr | null;
  plannedEnd: DateStr | null;
  isCritical: boolean;
  totalFloatDays: number | null;
}

export interface ScheduleSnapshot {
  projectFinish: DateStr | null;
  slackDays: number;
  tasks: TaskScheduleSnapshot[];
}

export interface ImpactTaskChange {
  taskId: string;
  wbsCode: string;
  name: string;
  oldStart: DateStr | null;
  newStart: DateStr | null;
  oldEnd: DateStr | null;
  newEnd: DateStr | null;
  deltaDays: number;
}

export interface ImpactCriticalEntry {
  taskId: string;
  wbsCode: string;
  name: string;
  start: DateStr;
  end: DateStr;
}

export interface ImpactReport {
  expectedFinish: DateStr | null;
  requiredFinish: DateStr;
  slackDays: number;
  slackBefore: number;
  deltaSlackDays: number;
  isDelayed: boolean;
  newlyDelayed: boolean;
  criticalPath: ImpactCriticalEntry[];
  changedTasks: ImpactTaskChange[];
  newlyCritical: ImpactCriticalEntry[];
  noLongerCritical: { taskId: string; wbsCode: string; name: string }[];
  warnings: string[];
  hasChanges: boolean;
}

export function buildImpactReport(params: {
  before: ScheduleSnapshot;
  after: ScheduleResult;
  afterTasks: SchedulerTask[];
  calendar: Calendar;
}): ImpactReport {
  const { before, after, afterTasks, calendar } = params;
  const metaById = new Map(afterTasks.map((t) => [t.id, t]));
  const beforeById = new Map(before.tasks.map((t) => [t.id, t]));
  const afterById = new Map<string, ScheduledTask>(after.tasks.map((t) => [t.id, t]));

  const describe = (id: string) => {
    const meta = metaById.get(id);
    return { wbsCode: meta?.wbsCode ?? beforeById.get(id)?.wbsCode ?? "", name: meta?.name ?? beforeById.get(id)?.name ?? "" };
  };

  const changedTasks: ImpactTaskChange[] = [];
  for (const [id, node] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) continue;
    const sameStart = prev.plannedStart === node.plannedStart;
    const sameEnd = prev.plannedEnd === node.plannedEnd;
    if (sameStart && sameEnd) continue;
    const deltaDays =
      prev.plannedStart && node.plannedStart
        ? calendar.workdaysBetween(prev.plannedStart, node.plannedStart)
        : 0;
    changedTasks.push({
      taskId: id,
      ...describe(id),
      oldStart: prev.plannedStart,
      newStart: node.plannedStart,
      oldEnd: prev.plannedEnd,
      newEnd: node.plannedEnd,
      deltaDays,
    });
  }
  changedTasks.sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays));

  const criticalPath: ImpactCriticalEntry[] = [];
  const newlyCritical: ImpactCriticalEntry[] = [];
  const noLongerCritical: { taskId: string; wbsCode: string; name: string }[] = [];

  for (const node of afterById.values()) {
    const meta = metaById.get(node.id);
    if (meta?.taskType === "SUMMARY") continue;
    const prev = beforeById.get(node.id);
    if (node.isCritical && node.plannedStart && node.plannedEnd) {
      const entry: ImpactCriticalEntry = {
        taskId: node.id,
        ...describe(node.id),
        start: node.plannedStart,
        end: node.plannedEnd,
      };
      criticalPath.push(entry);
      if (prev && !prev.isCritical) newlyCritical.push(entry);
    } else if (prev?.isCritical) {
      noLongerCritical.push({ taskId: node.id, ...describe(node.id) });
    }
  }
  criticalPath.sort((a, b) => compareDate(a.start, b.start));

  const deltaSlackDays = after.slackDays - before.slackDays;

  return {
    expectedFinish: after.projectFinish,
    requiredFinish: after.requiredFinish,
    slackDays: after.slackDays,
    slackBefore: before.slackDays,
    deltaSlackDays,
    isDelayed: after.slackDays < 0,
    newlyDelayed: before.slackDays >= 0 && after.slackDays < 0,
    criticalPath,
    changedTasks,
    newlyCritical,
    noLongerCritical,
    warnings: after.warnings.map((w) => w.message),
    hasChanges: changedTasks.length > 0,
  };
}

/** 面向用户的一句话结论（设计文档 6.3 判定表） */
export function summarizeImpact(report: ImpactReport): {
  tone: "ok" | "warn" | "danger";
  text: string;
} {
  if (report.isDelayed) {
    return {
      tone: "danger",
      text: `初验点将推迟 ${Math.abs(report.slackDays)} 个工作日（预计 ${report.expectedFinish ?? "—"} 完成，目标 ${report.requiredFinish}）`,
    };
  }
  if (report.slackDays === 0) {
    return {
      tone: "warn",
      text: `初验点无余量，关键路径上任一任务延期都会直接推迟初验（预计 ${report.expectedFinish ?? "—"} 完成）`,
    };
  }
  return {
    tone: "ok",
    text: `初验点不受影响，尚有余量 ${report.slackDays} 个工作日（预计 ${report.expectedFinish ?? "—"} 完成）`,
  };
}
