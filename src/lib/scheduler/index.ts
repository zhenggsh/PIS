import { compareDate, maxDate, minDate, type DateStr } from "@/lib/date";
import type { ConstraintType, TaskType } from "@/lib/domain/types";
import { createCalendar, type Calendar } from "./calendar";
import { expandSummaryPredecessors } from "./dependency-expand";
import { topoSort, type TopoEdge } from "./topo";

/**
 * 排期引擎（设计文档 6.2）：纯函数、零 IO、零框架依赖，前后端同构。
 * 正推（FS + lagDays）→ 以初验点逆推 → 关键路径 → 汇总节点 roll-up → 冲击余量
 */

export interface SchedulerTask {
  id: string;
  parentId: string | null;
  wbsCode: string;
  name: string;
  taskType: TaskType;
  durationDays: number;
  constraintType: ConstraintType;
  constraintDate: DateStr | null;
  isKickoff: boolean;
  isPreAccept: boolean;
  progressPct: number;
}

export interface SchedulerDependency {
  id: string;
  predId: string;
  succId: string;
  lagDays: number;
}

export interface SchedulerInput {
  kickoffDate: DateStr;
  preAcceptDate: DateStr;
  workweekMask: number;
  holidays: DateStr[];
  tasks: SchedulerTask[];
  dependencies: SchedulerDependency[];
}

export type ScheduleSource =
  | { kind: "KICKOFF" }
  | { kind: "PRE_ACCEPT" }
  | { kind: "DEPENDENCY"; predId: string; predWbsCode: string; lagDays: number }
  | { kind: "CONSTRAINT"; date: DateStr }
  | { kind: "ROLLUP"; childIds: string[] };

export interface ScheduledTask {
  id: string;
  plannedStart: DateStr | null;
  plannedEnd: DateStr | null;
  /** 实际用于排期的工期（工作日）：里程碑为 0，其余 ≥1 */
  durationDays: number;
  progressPct: number;
  isCritical: boolean;
  totalFloatDays: number | null;
  scheduleSource: ScheduleSource | null;
}

export interface ScheduleWarning {
  code:
    | "CYCLE"
    | "SUMMARY_DEPENDENCY"
    | "MISSING_TASK"
    | "PRE_ACCEPT_BEFORE_KICKOFF"
    | "DANGLING_TASK";
  message: string;
  taskIds: string[];
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  byId: Record<string, ScheduledTask>;
  criticalPath: string[];
  projectFinish: DateStr | null;
  requiredFinish: DateStr;
  slackDays: number;
  hasCycle: boolean;
  cycle: string[];
  warnings: ScheduleWarning[];
}

export function computeSchedule(input: SchedulerInput): ScheduleResult {
  const calendar = createCalendar(input.workweekMask, input.holidays);
  const warnings: ScheduleWarning[] = [];
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));

  const requiredFinish = calendar.snapForward(input.preAcceptDate);
  const anchor = calendar.snapForward(input.kickoffDate);

  if (compareDate(input.preAcceptDate, input.kickoffDate) < 0) {
    warnings.push({
      code: "PRE_ACCEPT_BEFORE_KICKOFF",
      message: "初验点早于开工会起点，计划时间口径不成立。",
      taskIds: [],
    });
  }

  const leafIds = input.tasks.filter((t) => t.taskType !== "SUMMARY").map((t) => t.id);
  const edges: TopoEdge[] = [];
  const predsOf = new Map<string, SchedulerDependency[]>();
  const succsOf = new Map<string, SchedulerDependency[]>();
  const edgeKeys = new Set<string>();

  // 「依赖汇总节点」等价于「依赖其下全部叶子任务」，统一展开后再建图
  const expansion = expandSummaryPredecessors(input.tasks, input.dependencies);
  for (const dep of expansion.invalidSucc) {
    warnings.push({
      code: "SUMMARY_DEPENDENCY",
      message: `汇总节点不能作为后续任务：${taskById.get(dep.predId)?.wbsCode ?? dep.predId} → ${
        taskById.get(dep.succId)?.wbsCode ?? dep.succId
      }`,
      taskIds: [dep.predId, dep.succId],
    });
  }
  for (const dep of expansion.unresolvedPred) {
    warnings.push({
      code: "SUMMARY_DEPENDENCY",
      message: `汇总节点下没有可排期的任务：${taskById.get(dep.predId)?.wbsCode ?? dep.predId}`,
      taskIds: [dep.predId, dep.succId],
    });
  }

  for (const { dep, predId } of expansion.edges) {
    const pred = taskById.get(predId);
    const succ = taskById.get(dep.succId);
    if (!pred || !succ) {
      warnings.push({
        code: "MISSING_TASK",
        message: "存在指向已删除任务的依赖边，已忽略。",
        taskIds: [predId, dep.succId],
      });
      continue;
    }
    const key = `${predId}->${dep.succId}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const normalized: SchedulerDependency = {
      id: dep.id,
      predId,
      succId: dep.succId,
      lagDays: dep.lagDays,
    };
    edges.push({ predId, succId: dep.succId });
    pushMap(predsOf, dep.succId, normalized);
    pushMap(succsOf, predId, normalized);
  }

  const { order, cycle } = topoSort(leafIds, edges);
  const hasCycle = cycle.length > 0;
  if (hasCycle) {
    warnings.push({
      code: "CYCLE",
      message: `存在循环依赖：${cycle.map((id) => taskById.get(id)?.wbsCode ?? id).join(" → ")}`,
      taskIds: cycle,
    });
  }

  // 初验点：默认锚定在目标初验日（不参与前推）；一旦配置了前级依赖，
  // 则由前级驱动排期（依赖其真实完成时间），目标日期仍作为逆推锚点。
  const preAcceptId = input.tasks.find((t) => t.isPreAccept)?.id ?? null;
  const preAcceptDriven = preAcceptId !== null && (predsOf.get(preAcceptId)?.length ?? 0) > 0;

  const sched = new Map<string, ScheduledTask>();

  // ===== 正推 =====
  for (const id of order) {
    const task = taskById.get(id)!;

    // 初验点锚定在目标日期上（未配置前级依赖时）
    if (task.isPreAccept && !preAcceptDriven) {
      sched.set(id, {
        id,
        plannedStart: requiredFinish,
        plannedEnd: requiredFinish,
        durationDays: 0,
        progressPct: task.progressPct,
        isCritical: false,
        totalFloatDays: null,
        scheduleSource: { kind: "PRE_ACCEPT" },
      });
      continue;
    }

    let start = anchor;
    let source: ScheduleSource = { kind: "KICKOFF" };

    for (const dep of predsOf.get(id) ?? []) {
      const pred = sched.get(dep.predId);
      if (!pred?.plannedEnd) continue;
      const candidate = calendar.addWorkdays(pred.plannedEnd, 1 + dep.lagDays);
      if (compareDate(candidate, start) > 0) {
        start = candidate;
        source = {
          kind: "DEPENDENCY",
          predId: dep.predId,
          predWbsCode: taskById.get(dep.predId)?.wbsCode ?? "",
          lagDays: dep.lagDays,
        };
      }
    }

    if (task.constraintType === "MSO" && task.constraintDate) {
      const candidate = calendar.snapForward(task.constraintDate);
      if (compareDate(candidate, start) > 0) {
        start = candidate;
        source = { kind: "CONSTRAINT", date: task.constraintDate };
      }
    }

    const isMilestone = task.taskType === "MILESTONE";
    const duration = isMilestone ? 0 : Math.max(1, task.durationDays);
    const end = isMilestone ? start : calendar.addWorkdays(start, duration - 1);

    sched.set(id, {
      id,
      plannedStart: start,
      plannedEnd: end,
      durationDays: duration,
      progressPct: task.progressPct,
      isCritical: false,
      totalFloatDays: null,
      scheduleSource: source,
    });
  }

  // ===== 项目预计完工 / 余量（初验点为锚点，不参与完工计算）=====
  let projectFinish: DateStr | null = null;
  for (const id of leafIds) {
    const task = taskById.get(id)!;
    // 锚定态（未配置前级依赖）的初验点不参与完工统计，避免目标日期虚增完工时间
    if (task.isPreAccept && !preAcceptDriven) continue;
    const node = sched.get(id);
    if (!node?.plannedEnd) continue;
    projectFinish = projectFinish === null ? node.plannedEnd : maxDate(projectFinish, node.plannedEnd);
  }
  const slackDays = projectFinish ? calendar.workdaysBetween(projectFinish, requiredFinish) : 0;

  // ===== 逆推（以初验点为项目完工约束）=====
  const lsMap = new Map<string, DateStr>();
  for (const id of [...order].reverse()) {
    const task = taskById.get(id)!;
    const node = sched.get(id)!;

    if (task.isPreAccept) {
      // 初验点的最晚开始 = 目标初验日；被前级驱动时，余量按「实际排期 vs 目标」计算
      lsMap.set(id, requiredFinish);
      const float = preAcceptDriven
        ? calendar.workdaysBetween(node.plannedStart ?? requiredFinish, requiredFinish)
        : slackDays;
      node.totalFloatDays = float;
      node.isCritical = float <= 0;
      continue;
    }

    const successors = succsOf.get(id) ?? [];

    let latestFinish: DateStr | null = null;
    for (const dep of successors) {
      const succLs = lsMap.get(dep.succId);
      if (!succLs) continue;
      const candidate = calendar.addWorkdays(succLs, -(1 + dep.lagDays));
      latestFinish = latestFinish === null ? candidate : minDate(latestFinish, candidate);
    }
    if (latestFinish === null) latestFinish = requiredFinish;

    const latestStart =
      task.taskType === "MILESTONE"
        ? latestFinish
        : calendar.addWorkdays(latestFinish, -(node.durationDays - 1));
    lsMap.set(id, latestStart);

    const float = calendar.workdaysBetween(node.plannedStart!, latestStart);
    node.totalFloatDays = float;
    node.isCritical = float <= 0;
  }

  // ===== 汇总节点 roll-up =====
  const childrenOf = new Map<string, SchedulerTask[]>();
  for (const task of input.tasks) {
    if (!task.parentId) continue;
    pushMap(childrenOf, task.parentId, task);
  }
  const rollup = new Map<string, ScheduledTask>();
  const summaries = input.tasks
    .filter((t) => t.taskType === "SUMMARY")
    .sort((a, b) => depthOf(b, taskById) - depthOf(a, taskById));

  for (const summary of summaries) {
    const children = childrenOf.get(summary.id) ?? [];
    let start: DateStr | null = null;
    let end: DateStr | null = null;
    let weightSum = 0;
    let progressSum = 0;
    let floatMin: number | null = null;
    let critical = false;

    for (const child of children) {
      const node = rollup.get(child.id) ?? sched.get(child.id);
      if (!node?.plannedStart || !node.plannedEnd) continue;
      start = start === null ? node.plannedStart : minDate(start, node.plannedStart);
      end = end === null ? node.plannedEnd : maxDate(end, node.plannedEnd);
      const weight = Math.max(1, node.durationDays);
      weightSum += weight;
      progressSum += weight * node.progressPct;
      if (node.totalFloatDays !== null) {
        floatMin = floatMin === null ? node.totalFloatDays : Math.min(floatMin, node.totalFloatDays);
      }
      critical = critical || node.isCritical;
    }

    rollup.set(summary.id, {
      id: summary.id,
      plannedStart: start,
      plannedEnd: end,
      durationDays: start && end ? calendar.workdaysInclusive(start, end) : 0,
      progressPct: weightSum > 0 ? Math.round(progressSum / weightSum) : summary.progressPct,
      isCritical: critical,
      totalFloatDays: floatMin,
      scheduleSource: children.length > 0 ? { kind: "ROLLUP", childIds: children.map((c) => c.id) } : null,
    });
  }

  // ===== 组装结果 =====
  const tasks: ScheduledTask[] = input.tasks.map(
    (task) =>
      sched.get(task.id) ??
      rollup.get(task.id) ?? {
        id: task.id,
        plannedStart: null,
        plannedEnd: null,
        durationDays: task.durationDays,
        progressPct: task.progressPct,
        isCritical: false,
        totalFloatDays: null,
        scheduleSource: null,
      },
  );
  const byId: Record<string, ScheduledTask> = {};
  for (const node of tasks) byId[node.id] = node;

  const scheduledLeaves = leafIds
    .map((id) => sched.get(id))
    .filter((node): node is ScheduledTask => Boolean(node?.plannedEnd));

  const dangling = leafIds.filter((id) => {
    const task = taskById.get(id)!;
    return !task.isKickoff && !task.isPreAccept && (predsOf.get(id)?.length ?? 0) === 0;
  });
  if (dangling.length > 0) {
    warnings.push({
      code: "DANGLING_TASK",
      message: `${dangling
        .map((id) => taskById.get(id)?.wbsCode)
        .join("、")} 无前级依赖，已按开工日排期（校验规则 V1 将阻断保存）。`,
      taskIds: dangling,
    });
  }

  const criticalPath = scheduledLeaves
    .filter((node) => node.isCritical)
    .sort((a, b) => compareDate(a.plannedStart!, b.plannedStart!))
    .map((node) => node.id);

  return {
    tasks,
    byId,
    criticalPath,
    projectFinish,
    requiredFinish,
    slackDays,
    hasCycle,
    cycle,
    warnings,
  };
}

export { createCalendar };
export type { Calendar };

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function depthOf(task: SchedulerTask, byId: Map<string, SchedulerTask>): number {
  let depth = 0;
  let cursor: SchedulerTask | undefined = task;
  while (cursor?.parentId && depth < 100) {
    cursor = byId.get(cursor.parentId);
    depth += 1;
  }
  return depth;
}
