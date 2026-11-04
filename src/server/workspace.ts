import { computeSchedule } from "@/lib/scheduler";
import type { ConstraintType, DepType, ProjectStatus, TaskStatus, TaskType } from "@/lib/domain/types";
import type {
  DependencyView,
  ProjectView,
  TaskView,
  WorkspaceData,
} from "@/lib/view/types";
import { loadPlan, sortTasksForDisplay, toSchedulerInput } from "@/server/plan";

/** 组装供页面渲染的工作区数据（服务端调用，不落库） */
export async function loadWorkspace(projectId: string): Promise<WorkspaceData | null> {
  const plan = await loadPlan(projectId);
  if (!plan) return null;

  const ordered = sortTasksForDisplay(plan.tasks);
  const input = toSchedulerInput(plan);
  const schedule = computeSchedule(input);

  const childCount = new Map<string, number>();
  for (const task of plan.tasks) {
    if (!task.parentId) continue;
    childCount.set(task.parentId, (childCount.get(task.parentId) ?? 0) + 1);
  }

  const predsOf = new Map<string, { ids: string[]; codes: string[] }>();
  const codeById = new Map(plan.tasks.map((task) => [task.id, task.wbsCode]));
  for (const dep of plan.dependencies) {
    const entry = predsOf.get(dep.succId) ?? { ids: [], codes: [] };
    entry.ids.push(dep.predId);
    entry.codes.push(codeById.get(dep.predId) ?? "?");
    predsOf.set(dep.succId, entry);
  }

  const depthById = new Map<string, number>();
  for (const task of ordered) {
    const parentDepth = task.parentId ? (depthById.get(task.parentId) ?? -1) : -1;
    depthById.set(task.id, parentDepth + 1);
  }

  const tasks: TaskView[] = ordered.map((task) => {
    const node = schedule.byId[task.id];
    const preds = predsOf.get(task.id);
    return {
      id: task.id,
      parentId: task.parentId,
      wbsCode: task.wbsCode,
      name: task.name,
      description: task.description,
      taskType: task.taskType as TaskType,
      status: task.status as TaskStatus,
      durationDays: node?.durationDays ?? task.durationDays,
      assignee: task.assignee,
      progressPct: task.progressPct,
      progressNote: task.progressNote,
      plannedStart: node?.plannedStart ?? task.plannedStart,
      plannedEnd: node?.plannedEnd ?? task.plannedEnd,
      actualStart: task.actualStart,
      actualEnd: task.actualEnd,
      isCritical: node?.isCritical ?? false,
      totalFloatDays: node?.totalFloatDays ?? null,
      isKickoff: task.isKickoff,
      isPreAccept: task.isPreAccept,
      constraintType: task.constraintType as ConstraintType,
      constraintDate: task.constraintDate,
      predecessorCodes: preds?.codes ?? [],
      predecessorIds: preds?.ids ?? [],
      depth: depthById.get(task.id) ?? 0,
      hasChildren: (childCount.get(task.id) ?? 0) > 0,
    };
  });

  const dependencies: DependencyView[] = plan.dependencies.map((dep) => ({
    id: dep.id,
    predId: dep.predId,
    succId: dep.succId,
    type: dep.type as DepType,
    lagDays: dep.lagDays,
  }));

  const project: ProjectView = {
    id: plan.project.id,
    key: plan.project.key,
    name: plan.project.name,
    description: plan.project.description,
    status: plan.project.status as ProjectStatus,
    kickoffDate: plan.project.kickoffDate,
    preAcceptDate: plan.project.preAcceptDate,
    workweekMask: plan.project.workweekMask,
    maxLeafDays: plan.project.maxLeafDays,
    aiScanEnabled: plan.project.aiScanEnabled,
  };

  return {
    project,
    tasks,
    dependencies,
    holidays: plan.holidays.map((holiday) => holiday.date),
    summary: {
      projectFinish: schedule.projectFinish,
      requiredFinish: schedule.requiredFinish,
      slackDays: schedule.slackDays,
      criticalTaskIds: schedule.criticalPath,
      warningMessages: schedule.warnings.map((warning) => warning.message),
    },
  };
}
