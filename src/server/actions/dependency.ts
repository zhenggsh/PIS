"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { subtreeIds } from "@/server/plan";
import { fail, runChange } from "./shared";
import type { ActionResult, DependencyInput, UpdateDependencyInput } from "@/server/types";

export async function addDependencyAction(input: DependencyInput): Promise<ActionResult> {
  if (!input.predId || !input.succId) return fail("请选择前置任务与后续任务");
  if (input.predId === input.succId) return fail("前置任务与后续任务不能是同一个任务");

  const [pred, succ] = await Promise.all([
    db.task.findFirst({ where: { id: input.predId, projectId: input.projectId } }),
    db.task.findFirst({ where: { id: input.succId, projectId: input.projectId } }),
  ]);
  if (!pred || !succ) return fail("任务不存在或不属于该项目");
  if (succ.taskType === "SUMMARY") {
    return fail("汇总节点不能作为后续任务；可将其作为前置任务，表示依赖其下全部工作完成。");
  }
  if (pred.taskType === "SUMMARY") {
    const tasks = await db.task.findMany({ where: { projectId: input.projectId } });
    if (subtreeIds(tasks, pred.id).includes(succ.id)) {
      return fail("不能依赖包含自身的汇总节点，会形成循环依赖。");
    }
  }

  const duplicate = await db.dependency.findFirst({
    where: { predId: input.predId, succId: input.succId },
  });
  if (duplicate) return fail(`${pred.wbsCode} → ${succ.wbsCode} 的依赖已存在`);

  const result = await runChange(input.projectId, {
    action: "DEP_ADD",
    targetType: "Dependency",
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      await tx.dependency.create({
        data: {
          projectId: input.projectId,
          predId: input.predId,
          succId: input.succId,
          lagDays: Math.round(input.lagDays ?? 0),
        },
      });
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

/** 整体替换某任务的前级依赖集合（UI 中维护更直观） */
export async function setTaskPredecessorsAction(input: {
  projectId: string;
  taskId: string;
  predecessorIds: string[];
  lagDays?: number;
  acknowledgedIssueCodes?: string[];
}): Promise<ActionResult> {
  const ids = [...new Set(input.predecessorIds)].filter((id) => id && id !== input.taskId);

  const result = await runChange(input.projectId, {
    action: "DEP_SET",
    targetType: "Task",
    targetId: input.taskId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
      });
      if (!task) throw new Error("任务不存在");
      if (task.taskType === "SUMMARY") throw new Error("汇总节点不参与依赖关系");
      const allTasks = await tx.task.findMany({ where: { projectId: input.projectId } });
      await tx.dependency.deleteMany({
        where: { projectId: input.projectId, succId: input.taskId },
      });
      for (const predId of ids) {
        const pred = await tx.task.findFirst({
          where: { id: predId, projectId: input.projectId },
        });
        if (!pred) throw new Error("前级任务不存在");
        if (pred.taskType === "SUMMARY" && subtreeIds(allTasks, predId).includes(input.taskId)) {
          throw new Error("不能依赖包含自身的汇总节点，会形成循环依赖");
        }
        await tx.dependency.create({
          data: {
            projectId: input.projectId,
            predId,
            succId: input.taskId,
            lagDays: Math.round(input.lagDays ?? 0),
          },
        });
      }
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function updateDependencyAction(input: UpdateDependencyInput): Promise<ActionResult> {
  const lagDays = Math.round(input.lagDays);
  if (!Number.isFinite(lagDays)) return fail("滞后量不合法");
  const exists = await db.dependency.findFirst({
    where: { id: input.dependencyId, projectId: input.projectId },
  });
  if (!exists) return fail("依赖关系不存在");

  const result = await runChange(input.projectId, {
    action: "DEP_UPDATE",
    targetType: "Dependency",
    targetId: input.dependencyId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      await tx.dependency.update({ where: { id: input.dependencyId }, data: { lagDays } });
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function removeDependencyAction(input: {
  projectId: string;
  dependencyId: string;
  acknowledgedIssueCodes?: string[];
}): Promise<ActionResult> {
  const exists = await db.dependency.findFirst({
    where: { id: input.dependencyId, projectId: input.projectId },
  });
  if (!exists) return fail("依赖关系不存在");

  const result = await runChange(input.projectId, {
    action: "DEP_REMOVE",
    targetType: "Dependency",
    targetId: input.dependencyId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      await tx.dependency.delete({ where: { id: input.dependencyId } });
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}
