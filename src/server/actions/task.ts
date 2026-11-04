"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { isDateStr, todayStr } from "@/lib/date";
import { isTaskStatus, isTaskType, type TaskStatus } from "@/lib/domain/types";
import { renumberWbs, sortTasksForDisplay, type DbClient } from "@/server/plan";
import type { PlanPatch } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";
import { fail, runChange } from "./shared";
import type {
  ActionResult,
  CreateTaskInput,
  MoveTaskInput,
  ProgressInput,
  UpdateTaskInput,
} from "@/server/types";

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function derivedStatus(pct: number, fallback: TaskStatus): TaskStatus {
  if (pct >= 100) return "DONE";
  if (pct > 0) return "IN_PROGRESS";
  return fallback === "BLOCKED" ? "BLOCKED" : "NOT_STARTED";
}

/** 按显示顺序重排某父节点下的兄弟节点 sortOrder */
async function reindexChildren(tx: DbClient, projectId: string, parentId: string | null) {
  const siblings = (
    await tx.task.findMany({ where: { projectId, parentId } })
  ).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  for (let index = 0; index < siblings.length; index += 1) {
    const item = siblings[index];
    if (item.sortOrder === index) continue;
    await tx.task.update({ where: { id: item.id }, data: { sortOrder: index } });
  }
}

/** 保证依赖边存在；若已存在则复用，避免唯一键冲突。 */
async function ensureDependency(
  tx: DbClient,
  projectId: string,
  predId: string,
  succId: string,
  lagDays: number,
) {
  if (predId === succId) return;
  const exists = await tx.dependency.findFirst({ where: { predId, succId } });
  if (exists) {
    if (exists.lagDays !== lagDays) {
      await tx.dependency.update({ where: { id: exists.id }, data: { lagDays } });
    }
    return;
  }
  await tx.dependency.create({ data: { projectId, predId, succId, lagDays } });
}

/**
 * 某个可执行任务在「缩进」时会被提升为 SUMMARY。
 * SUMMARY 不参与依赖图，因此需要把它原有的依赖边转接到新插入的子任务上，
 * 否则后续任务会突然失去前级，触发 V1。
 */
async function rewireDependenciesForPromotedSummary(
  tx: DbClient,
  projectId: string,
  promotedTaskId: string,
  childTaskId: string,
) {
  const deps = await tx.dependency.findMany({
    where: { projectId, OR: [{ predId: promotedTaskId }, { succId: promotedTaskId }] },
  });

  for (const dep of deps) {
    if (dep.predId === promotedTaskId) {
      await ensureDependency(tx, projectId, childTaskId, dep.succId, dep.lagDays);
    }
    if (dep.succId === promotedTaskId) {
      await ensureDependency(tx, projectId, dep.predId, childTaskId, dep.lagDays);
    }
  }

  await tx.dependency.deleteMany({
    where: { projectId, OR: [{ predId: promotedTaskId }, { succId: promotedTaskId }] },
  });
}

/**
 * 插入同级任务时，自动继承「显示顺序中位于插入点之前、最近的一个依赖图任务」作为前级，
 * 以满足规则 V1（除开工会外必须有前级依赖）。开工会恒为显示顺序的第一项，故必然可解析到。
 */
async function resolveAutoPredecessor(
  tx: DbClient,
  projectId: string,
  anchorId: string,
): Promise<string | null> {
  const tasks = await tx.task.findMany({ where: { projectId } });
  const ordered = sortTasksForDisplay(tasks);
  const index = ordered.findIndex((task) => task.id === anchorId);
  if (index < 0) return null;
  for (let i = index; i >= 0; i -= 1) {
    const item = ordered[i];
    if (item.taskType !== "SUMMARY" && !item.isPreAccept) return item.id;
  }
  return null;
}

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult> {
  const name = input.name?.trim();
  if (!name) return fail("请填写任务名称");
  if (!isTaskType(input.taskType)) return fail("任务类型不合法");
  if (input.constraintType === "MSO" && input.constraintDate && !isDateStr(input.constraintDate)) {
    return fail("「不早于」约束日期不合法");
  }

  const isMilestone = input.taskType === "MILESTONE";
  const durationDays = isMilestone ? 0 : Math.max(1, Math.round(input.durationDays || 1));
  const predecessorIds = [...new Set(input.predecessorIds ?? [])].filter(Boolean);
  const lagDays = Math.round(input.lagDays ?? 0);
  const insertAfterTaskId = input.insertAfterTaskId ?? null;
  let createdId: string | null = null;

  const result = await runChange(input.projectId, {
    action: insertAfterTaskId ? "TASK_INSERT_SIBLING" : "TASK_CREATE",
    targetType: "Task",
    targetId: insertAfterTaskId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      let parentId: string | null = null;
      let sortOrder: number;
      let autoPredId: string | null = null;

      if (insertAfterTaskId) {
        const anchor = await tx.task.findFirst({
          where: { id: insertAfterTaskId, projectId: input.projectId },
        });
        if (!anchor) throw new Error("定位任务不存在");
        parentId = anchor.parentId;
        const siblings = await tx.task.findMany({
          where: { projectId: input.projectId, parentId },
        });
        for (const sibling of siblings) {
          if (sibling.sortOrder > anchor.sortOrder) {
            await tx.task.update({
              where: { id: sibling.id },
              data: { sortOrder: sibling.sortOrder + 1 },
            });
          }
        }
        sortOrder = anchor.sortOrder + 1;
        autoPredId = await resolveAutoPredecessor(tx, input.projectId, anchor.id);
      } else {
        sortOrder = await tx.task.count({ where: { projectId: input.projectId, parentId: null } });
      }

      const task = await tx.task.create({
        data: {
          projectId: input.projectId,
          parentId,
          wbsCode: "0",
          sortOrder,
          name,
          description: input.description?.trim() || null,
          taskType: input.taskType,
          durationDays,
          assignee: input.assignee?.trim() || null,
          constraintType: input.constraintType ?? "ASAP",
          constraintDate: input.constraintType === "MSO" ? (input.constraintDate ?? null) : null,
        },
      });
      createdId = task.id;

      const predIds =
        predecessorIds.length > 0 ? predecessorIds : autoPredId ? [autoPredId] : [];
      for (const predId of predIds) {
        if (predId === task.id) continue;
        const pred = await tx.task.findFirst({ where: { id: predId, projectId: input.projectId } });
        if (!pred) throw new Error("前级任务不存在或不属于该项目");
        await tx.dependency.create({
          data: { projectId: input.projectId, predId, succId: task.id, lagDays },
        });
      }

      await renumberWbs(input.projectId, tx);
    },
  });

  if (result.ok) {
    result.taskId = createdId ?? undefined;
    revalidatePath(`/projects/${input.projectId}`);
  }
  return result;
}

export async function updateTaskAction(input: UpdateTaskInput): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) return fail("任务名称不能为空");
  if (input.taskType !== undefined && !isTaskType(input.taskType)) return fail("任务类型不合法");
  if (input.status !== undefined && !isTaskStatus(input.status)) return fail("任务状态不合法");
  if (input.constraintDate && !isDateStr(input.constraintDate)) return fail("约束日期不合法");
  if (input.forcedStartDate && !isDateStr(input.forcedStartDate)) {
    return fail("强制指定起始日日期不合法");
  }

  const data: Prisma.TaskUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.assignee !== undefined) data.assignee = input.assignee?.trim() || null;
  if (input.progressNote !== undefined) data.progressNote = input.progressNote?.trim() || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.progressPct !== undefined) data.progressPct = clampPct(input.progressPct);
  if (input.taskType !== undefined) data.taskType = input.taskType;
  if (input.constraintType !== undefined) data.constraintType = input.constraintType;
  if (input.constraintType === "ASAP") data.constraintDate = null;
  else if (input.constraintDate !== undefined) data.constraintDate = input.constraintDate || null;

  if (input.taskType !== undefined) {
    data.durationDays =
      input.taskType === "MILESTONE" ? 0 : Math.max(1, Math.round(input.durationDays ?? 1));
  } else if (input.durationDays !== undefined) {
    data.durationDays = Math.max(1, Math.round(input.durationDays));
  }

  // 强制指定起始日（规则 V4，建议遵循）：不写 plannedStart，而是转为「不早于（MSO）」约束。
  // 传入 patch 使其命中 V4，需人工确认（acknowledgedIssueCodes 含 V4_DIRECT_DATE_EDIT）后生效。
  const forcedStartDate = input.forcedStartDate ?? null;
  if (forcedStartDate) {
    data.constraintType = "MSO";
    data.constraintDate = forcedStartDate;
  }

  if (Object.keys(data).length === 0) return fail("没有需要更新的内容");

  const patch: PlanPatch | undefined = forcedStartDate
    ? { taskId: input.taskId, fields: { plannedStart: forcedStartDate } }
    : undefined;

  const result = await runChange(input.projectId, {
    action: forcedStartDate ? "TASK_FORCE_START_DATE" : "TASK_UPDATE",
    targetType: "Task",
    targetId: input.taskId,
    patch,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      const exists = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
      });
      if (!exists) throw new Error("任务不存在");
      await tx.task.update({ where: { id: input.taskId }, data });
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function setTaskProgressAction(input: ProgressInput): Promise<ActionResult> {
  const progressPct = clampPct(input.progressPct);
  const explicitStatus = input.status && isTaskStatus(input.status) ? input.status : undefined;
  const today = todayStr();

  const result = await runChange(input.projectId, {
    action: "TASK_PROGRESS",
    targetType: "Task",
    targetId: input.taskId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
      });
      if (!task) throw new Error("任务不存在");
      const status = explicitStatus ?? derivedStatus(progressPct, task.status as TaskStatus);
      const data: Prisma.TaskUpdateInput = {
        progressPct,
        status,
        progressUpdatedAt: new Date(),
      };
      if (input.progressNote !== undefined) data.progressNote = input.progressNote?.trim() || null;
      if (progressPct > 0 && !task.actualStart) data.actualStart = today;
      if (progressPct >= 100) data.actualEnd = task.actualEnd ?? today;
      else data.actualEnd = null;
      await tx.task.update({ where: { id: input.taskId }, data });
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function moveTaskAction(input: MoveTaskInput): Promise<ActionResult> {
  const result = await runChange(input.projectId, {
    action: `TASK_MOVE_${input.direction.toUpperCase()}`,
    targetType: "Task",
    targetId: input.taskId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
      });
      if (!task) throw new Error("任务不存在");

      if (input.direction === "indent") {
        const siblings = (
          await tx.task.findMany({ where: { projectId: input.projectId, parentId: task.parentId } })
        ).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
        const index = siblings.findIndex((item) => item.id === task.id);
        const prev = siblings[index - 1];
        if (!prev) throw new Error("同级第一个任务无法缩进，请先调整顺序");

        if (prev.taskType !== "SUMMARY") {
          await tx.task.update({ where: { id: prev.id }, data: { taskType: "SUMMARY" } });
          await rewireDependenciesForPromotedSummary(tx, input.projectId, prev.id, task.id);
        }
        const childCount = await tx.task.count({
          where: { projectId: input.projectId, parentId: prev.id },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { parentId: prev.id, sortOrder: childCount },
        });
        await reindexChildren(tx, input.projectId, task.parentId);
        await reindexChildren(tx, input.projectId, prev.id);
        await renumberWbs(input.projectId, tx);
        return;
      }

      if (input.direction === "outdent") {
        if (!task.parentId) throw new Error("已经是顶层任务，无法升级");
        const parent = await tx.task.findUnique({ where: { id: task.parentId } });
        if (!parent) throw new Error("父任务不存在");
        const newSiblings = (
          await tx.task.findMany({
            where: { projectId: input.projectId, parentId: parent.parentId },
          })
        ).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
        const parentIndex = newSiblings.findIndex((item) => item.id === parent.id);
        await tx.task.update({
          where: { id: task.id },
          data: {
            parentId: parent.parentId,
            sortOrder: (parentIndex >= 0 ? parentIndex : newSiblings.length) + 1,
          },
        });
        await reindexChildren(tx, input.projectId, parent.parentId);
        await reindexChildren(tx, input.projectId, parent.id);
        await renumberWbs(input.projectId, tx);
        return;
      }

      const siblings = (
        await tx.task.findMany({ where: { projectId: input.projectId, parentId: task.parentId } })
      ).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
      const index = siblings.findIndex((item) => item.id === task.id);
      const target = input.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= siblings.length) throw new Error("已到边界，无法继续移动");
      const reordered = [...siblings];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      for (let i = 0; i < reordered.length; i += 1) {
        await tx.task.update({ where: { id: reordered[i].id }, data: { sortOrder: i } });
      }
      await reindexChildren(tx, input.projectId, task.parentId);
      await renumberWbs(input.projectId, tx);
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function deleteTaskAction(input: {
  projectId: string;
  taskId: string;
  acknowledgedIssueCodes?: string[];
}): Promise<ActionResult> {
  const task = await db.task.findFirst({
    where: { id: input.taskId, projectId: input.projectId },
  });
  if (!task) return fail("任务不存在");
  if (task.isKickoff || task.isPreAccept) {
    return fail("开工会与初验点锚点任务不可删除，请在「项目设置」中调整日期。");
  }

  const result = await runChange(input.projectId, {
    action: "TASK_DELETE",
    targetType: "Task",
    targetId: input.taskId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      await tx.task.delete({ where: { id: input.taskId } });
      await renumberWbs(input.projectId, tx);
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}
