import { db } from "@/lib/db";
import { compareDate, maxDate, type DateStr } from "@/lib/date";
import {
  computeSchedule,
  createCalendar,
  type ScheduledTask,
  type ScheduleResult,
  type SchedulerInput,
  type SchedulerTask,
} from "@/lib/scheduler";
import { buildImpactReport, type ImpactReport, type ScheduleSnapshot } from "@/lib/scheduler/impact";
import type { ConstraintType, TaskType } from "@/lib/domain/types";
import type {
  PlanValidationInput,
  PlanPatch,
  ValidationDependency,
  ValidationIssue,
  ValidationTask,
} from "@/lib/validation";
import { validatePlan } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";
import type { Dependency, Holiday, Project, Task } from "@/generated/prisma/client";

/** 事务内可用的 Prisma 客户端（PrismaClient 亦可直接传入） */
export type DbClient = Prisma.TransactionClient;

export interface PlanData {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
  holidays: Holiday[];
}

export async function loadPlan(projectId: string, client: DbClient = db): Promise<PlanData | null> {
  const [project, tasks, dependencies, holidays] = await Promise.all([
    client.project.findUnique({ where: { id: projectId } }),
    client.task.findMany({ where: { projectId } }),
    client.dependency.findMany({ where: { projectId } }),
    client.holiday.findMany({ where: { projectId } }),
  ]);
  if (!project) return null;
  return { project, tasks, dependencies, holidays };
}

// ============ 视图 / 校验 DTO 映射 ============

export function toSchedulerInput(plan: PlanData): SchedulerInput {
  return {
    kickoffDate: plan.project.kickoffDate,
    preAcceptDate: plan.project.preAcceptDate,
    workweekMask: plan.project.workweekMask,
    holidays: plan.holidays.map((h) => h.date),
    tasks: plan.tasks.map<SchedulerTask>((task) => ({
      id: task.id,
      parentId: task.parentId,
      wbsCode: task.wbsCode,
      name: task.name,
      taskType: task.taskType as TaskType,
      durationDays: task.durationDays,
      constraintType: task.constraintType as ConstraintType,
      constraintDate: task.constraintDate,
      isKickoff: task.isKickoff,
      isPreAccept: task.isPreAccept,
      progressPct: task.progressPct,
    })),
    dependencies: plan.dependencies.map((dep) => ({
      id: dep.id,
      predId: dep.predId,
      succId: dep.succId,
      lagDays: dep.lagDays,
    })),
  };
}

export function toValidationInput(plan: PlanData): PlanValidationInput {
  return {
    project: {
      maxLeafDays: plan.project.maxLeafDays,
      kickoffDate: plan.project.kickoffDate,
      preAcceptDate: plan.project.preAcceptDate,
    },
    tasks: plan.tasks.map<ValidationTask>((task) => ({
      id: task.id,
      parentId: task.parentId,
      wbsCode: task.wbsCode,
      name: task.name,
      taskType: task.taskType as TaskType,
      status: task.status as ValidationTask["status"],
      durationDays: task.durationDays,
      isKickoff: task.isKickoff,
      isPreAccept: task.isPreAccept,
      actualStart: task.actualStart,
    })),
    dependencies: plan.dependencies.map<ValidationDependency>((dep) => ({
      predId: dep.predId,
      succId: dep.succId,
      lagDays: dep.lagDays,
    })),
  };
}

/** 变更前快照：直接取库中已落库的派生字段（上一次重算结果） */
export function snapshotFromPlan(plan: PlanData): ScheduleSnapshot {
  const calendar = createCalendar(plan.project.workweekMask, plan.holidays.map((h) => h.date));
  const requiredFinish = calendar.snapForward(plan.project.preAcceptDate);
  let finish: DateStr | null = null;
  for (const task of plan.tasks) {
    if (task.taskType === "SUMMARY" || task.isPreAccept || !task.plannedEnd) continue;
    finish = finish === null ? task.plannedEnd : maxDate(finish, task.plannedEnd);
  }
  return {
    projectFinish: finish,
    slackDays: finish ? calendar.workdaysBetween(finish, requiredFinish) : 0,
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      wbsCode: task.wbsCode,
      name: task.name,
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      isCritical: task.isCritical,
      totalFloatDays: task.totalFloatDays,
    })),
  };
}

// ============ 重算与落库 ============

export function scheduledPatch(node: ScheduledTask) {
  return {
    plannedStart: node.plannedStart,
    plannedEnd: node.plannedEnd,
    isCritical: node.isCritical,
    totalFloatDays: node.totalFloatDays,
    scheduleSource: node.scheduleSource ? JSON.stringify(node.scheduleSource) : null,
  };
}

export async function persistSchedule(result: ScheduleResult, client: DbClient = db): Promise<void> {
  if (result.tasks.length === 0) return;
  await Promise.all(
    result.tasks.map((node) =>
      client.task.update({ where: { id: node.id }, data: scheduledPatch(node) }),
    ),
  );
}

export class PlanValidationFailure extends Error {
  constructor(
    readonly issues: ValidationIssue[],
    readonly blocked: boolean,
  ) {
    super(blocked ? "计划存在必须遵循的规则违规" : "存在待人工确认的建议项");
    this.name = "PlanValidationFailure";
  }
}

function issueKey(issue: ValidationIssue): string {
  return `${issue.code}::${[...issue.targetTaskIds].sort().join(",")}`;
}

export interface ChangeOutcome {
  impact: ImpactReport;
  issues: ValidationIssue[];
  result: ScheduleResult;
}

/**
 * 变更闭环（设计文档 4.2 / 7.5）：
 * 事务内 读取变更前状态 → 落库变更 → 校验 → 重算 → 写回派生字段 → 审计留痕
 * 校验不通过则抛 PlanValidationFailure 由事务整体回滚。
 *
 * 说明：只有「本次变更引入的」建议项才需要人工确认；变更前已存在的建议项不反复打断操作。
 */
export async function applyPlanChange(
  projectId: string,
  options: {
    action: string;
    targetType: string;
    targetId?: string | null;
    patch?: PlanPatch;
    acknowledgedIssueCodes?: string[];
    skipValidation?: boolean;
    mutate: (tx: DbClient) => Promise<void>;
  },
): Promise<ChangeOutcome> {
  return db.$transaction(
    async (tx) => {
      const before = await loadPlan(projectId, tx);
      if (!before) throw new Error("项目不存在");

      await options.mutate(tx);

      const after = await loadPlan(projectId, tx);
      if (!after) throw new Error("项目不存在");

      const issues = options.skipValidation
        ? []
        : validatePlan(toValidationInput(after), options.patch);
      const beforeIssues = options.skipValidation ? [] : validatePlan(toValidationInput(before));
      const existedBefore = new Set(beforeIssues.map(issueKey));

      const blocking = issues.filter((issue) => issue.level === "BLOCK");
      const acknowledged = new Set(options.acknowledgedIssueCodes ?? []);
      // V4（直接改日期）由本次变更本身决定，始终需要确认；其余建议项仅当本次新引入时才需确认。
      const introduced = issues.filter(
        (issue) =>
          issue.level === "CONFIRM" &&
          (issue.code === "V4_DIRECT_DATE_EDIT" || !existedBefore.has(issueKey(issue))),
      );
      const unconfirmed = introduced.filter((issue) => !acknowledged.has(issue.code));
      if (blocking.length > 0 || unconfirmed.length > 0) {
        throw new PlanValidationFailure([...blocking, ...unconfirmed], blocking.length > 0);
      }

      const input = toSchedulerInput(after);
      const result = computeSchedule(input);
      await persistSchedule(result, tx);

      const impact = buildImpactReport({
        before: snapshotFromPlan(before),
        after: result,
        afterTasks: input.tasks,
        calendar: createCalendar(input.workweekMask, input.holidays),
      });

      await tx.auditLog.create({
        data: {
          projectId,
          action: options.action,
          targetType: options.targetType,
          targetId: options.targetId ?? null,
          payload: JSON.stringify({
            acknowledgedIssueCodes: options.acknowledgedIssueCodes ?? [],
            slackDays: impact.slackDays,
            expectedFinish: impact.expectedFinish,
            deltaSlackDays: impact.deltaSlackDays,
            changedTasks: impact.changedTasks.slice(0, 30),
          }),
        },
      });

      return { impact, issues, result };
    },
    { timeout: 30000 },
  );
}

// ============ WBS 结构工具 ============

export function sortTasksForDisplay(tasks: Task[]): Task[] {
  const childrenOf = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const list = childrenOf.get(task.parentId);
    if (list) list.push(task);
    else childrenOf.set(task.parentId, [task]);
  }
  for (const list of childrenOf.values()) {
    list.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || compareDate(a.createdAt.toISOString(), b.createdAt.toISOString()),
    );
  }
  const result: Task[] = [];
  const walk = (parentId: string | null) => {
    for (const task of childrenOf.get(parentId) ?? []) {
      result.push(task);
      walk(task.id);
    }
  };
  walk(null);
  return result;
}

export async function renumberWbs(projectId: string, client: DbClient = db): Promise<void> {
  const tasks = await client.task.findMany({ where: { projectId } });
  const ordered = sortTasksForDisplay(tasks);
  const childrenOf = new Map<string | null, string[]>();
  for (const task of ordered) {
    const list = childrenOf.get(task.parentId);
    if (list) list.push(task.id);
    else childrenOf.set(task.parentId, [task.id]);
  }

  const updates: { id: string; wbsCode: string; sortOrder: number }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.forEach((id, index) => {
      const code = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      updates.push({ id, wbsCode: code, sortOrder: index });
      walk(id, code);
    });
  };
  walk(null, "");

  for (const item of updates) {
    const current = tasks.find((task) => task.id === item.id);
    if (!current) continue;
    if (current.wbsCode === item.wbsCode && current.sortOrder === item.sortOrder) continue;
    await client.task.update({
      where: { id: item.id },
      data: { wbsCode: item.wbsCode, sortOrder: item.sortOrder },
    });
  }
}

export function subtreeIds(tasks: Task[], rootId: string): string[] {
  const childrenOf = new Map<string | null, string[]>();
  for (const task of tasks) {
    const list = childrenOf.get(task.parentId);
    if (list) list.push(task.id);
    else childrenOf.set(task.parentId, [task.id]);
  }
  const ids: string[] = [];
  const walk = (id: string) => {
    ids.push(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return ids;
}
