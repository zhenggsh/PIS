import { expandSummaryPredecessors } from "@/lib/scheduler/dependency-expand";
import { topoSort } from "@/lib/scheduler/topo";
import type { PlanValidationInput, ValidationIssue } from "./types";

/** V1 前级依赖完整性 + V2 循环依赖（必须遵循，BLOCK） */
export function validateGraph(input: PlanValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const executable = input.tasks.filter((t) => t.taskType !== "SUMMARY");

  // ---- V2：循环依赖（依赖汇总节点时展开为其下全部叶子任务后再判环）----
  const expansion = expandSummaryPredecessors(input.tasks, input.dependencies);
  const { cycle } = topoSort(
    executable.map((t) => t.id),
    expansion.edges.map((edge) => ({ predId: edge.predId, succId: edge.dep.succId })),
  );
  if (cycle.length > 0) {
    const chain = cycle.map((id) => taskById.get(id)?.wbsCode ?? id).join(" → ");
    issues.push({
      code: "V2_DEP_CYCLE",
      level: "BLOCK",
      message: `检测到循环依赖：${chain}`,
      targetTaskIds: cycle,
      suggestion: "请移除环路中的某一条依赖边后重试。",
      detail: { cycle },
      overridable: false,
    });
  }

  // ---- V1：除开工会（根任务）与初验点锚点外，其余可执行任务必须有前级依赖 ----
  const hasPredecessor = new Set(input.dependencies.map((d) => d.succId));
  const offenders = executable.filter(
    (task) => !task.isKickoff && !task.isPreAccept && !hasPredecessor.has(task.id),
  );
  if (offenders.length > 0) {
    issues.push({
      code: "V1_NO_PREDECESSOR",
      level: "BLOCK",
      message: `${offenders
        .map((t) => `${t.wbsCode} ${t.name}`)
        .join("、")} 缺少前级依赖。除开工会（第一个任务）外，所有任务与里程碑都必须有前级依赖。`,
      targetTaskIds: offenders.map((t) => t.id),
      suggestion: "为其选择前级依赖；新增任务时可默认继承上一个同级任务作为前级。",
      detail: { offenders: offenders.map((t) => t.id) },
      overridable: false,
    });
  }

  return issues;
}
