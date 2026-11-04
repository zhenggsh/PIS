"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { isDateStr } from "@/lib/date";
import { computeSchedule } from "@/lib/scheduler";
import { DEFAULT_WORKWEEK_MASK, isProjectStatus } from "@/lib/domain/types";
import { loadPlan, persistSchedule, toSchedulerInput } from "@/server/plan";
import type { Prisma } from "@/generated/prisma/client";
import { fail, runChange } from "./shared";
import type { ActionResult, CreateProjectInput, UpdateProjectInput } from "@/server/types";

function autoKey(): string {
  return `PIS-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/** 新建项目：同时落两个锚点任务——开工会（起始）与初验点（目标） */
export async function createProjectAction(input: CreateProjectInput): Promise<ActionResult> {
  const name = input.name?.trim();
  if (!name) return fail("请填写项目名称");
  if (!isDateStr(input.kickoffDate) || !isDateStr(input.preAcceptDate)) {
    return fail("请填写合法的开工会起点与初验点日期");
  }
  if (input.preAcceptDate < input.kickoffDate) {
    return fail("初验点不能早于开工会起点");
  }

  const key = input.key?.trim() || autoKey();
  const duplicate = await db.project.findUnique({ where: { key } });
  if (duplicate) return fail(`项目代号「${key}」已存在，请更换`);

  const project = await db.project.create({
    data: {
      key,
      name,
      description: input.description?.trim() || null,
      kickoffDate: input.kickoffDate,
      preAcceptDate: input.preAcceptDate,
      workweekMask: input.workweekMask ?? DEFAULT_WORKWEEK_MASK,
      maxLeafDays: input.maxLeafDays ?? 3,
    },
  });

  await db.task.create({
    data: {
      projectId: project.id,
      wbsCode: "1",
      sortOrder: 0,
      name: "项目开工会",
      description: "项目启动会（起始里程碑，全项目第一个任务）",
      taskType: "MILESTONE",
      durationDays: 0,
      isKickoff: true,
    },
  });
  await db.task.create({
    data: {
      projectId: project.id,
      wbsCode: "2",
      sortOrder: 1,
      name: "项目初验点",
      description: "项目初验（目标里程碑，排期锚点）",
      taskType: "MILESTONE",
      durationDays: 0,
      isPreAccept: true,
    },
  });

  const plan = await loadPlan(project.id);
  if (plan) await persistSchedule(computeSchedule(toSchedulerInput(plan)));

  revalidatePath("/");
  return { ok: true, projectId: project.id, message: `项目「${name}」已创建` };
}

/** 项目设置变更（含工作日历与节假日），走同一套校验 + 重算闭环 */
export async function updateProjectAction(input: UpdateProjectInput): Promise<ActionResult> {
  if (input.kickoffDate && !isDateStr(input.kickoffDate)) return fail("开工会起点日期不合法");
  if (input.preAcceptDate && !isDateStr(input.preAcceptDate)) return fail("初验点日期不合法");
  if (input.holidays?.some((date) => !isDateStr(date))) return fail("节假日日期不合法");
  if (input.status && !isProjectStatus(input.status)) return fail("项目状态取值不合法");

  const data: Prisma.ProjectUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.kickoffDate !== undefined) data.kickoffDate = input.kickoffDate;
  if (input.preAcceptDate !== undefined) data.preAcceptDate = input.preAcceptDate;
  if (input.workweekMask !== undefined) data.workweekMask = input.workweekMask;
  if (input.maxLeafDays !== undefined) data.maxLeafDays = input.maxLeafDays;

  const holidays = input.holidays;

  const result = await runChange(input.projectId, {
    action: "PROJECT_UPDATE",
    targetType: "Project",
    targetId: input.projectId,
    acknowledgedIssueCodes: input.acknowledgedIssueCodes,
    mutate: async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.project.update({ where: { id: input.projectId }, data });
      }
      if (holidays) {
        await tx.holiday.deleteMany({ where: { projectId: input.projectId } });
        for (const date of [...new Set(holidays)].sort()) {
          await tx.holiday.create({ data: { projectId: input.projectId, date } });
        }
      }
    },
  });

  if (result.ok) revalidatePath(`/projects/${input.projectId}`);
  return result;
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  const exists = await db.project.findUnique({ where: { id: projectId } });
  if (!exists) return fail("项目不存在");
  await db.project.delete({ where: { id: projectId } });
  revalidatePath("/");
  return { ok: true, message: "项目已删除" };
}
