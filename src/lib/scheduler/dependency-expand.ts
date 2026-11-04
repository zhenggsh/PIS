/**
 * 汇总节点依赖展开（设计文档 6.2 排期口径）
 * 允许「后续任务依赖于某个汇总节点」，语义等价于「依赖该汇总节点下全部叶子任务的完成」。
 * 排期与环检测统一在此展开后的「叶子级」依赖图上进行。
 */

export interface ExpandableTask {
  id: string;
  parentId: string | null;
  taskType: string;
}

export interface ExpandableDependency {
  predId: string;
  succId: string;
}

export interface ExpandedEdges<T> {
  /** 展开到叶子层后的依赖边：predId 一定是可排期任务 */
  edges: { dep: T; predId: string }[];
  /** 汇总节点被当作后续任务：无法参与排期，忽略 */
  invalidSucc: T[];
  /** 汇总节点下没有任何叶子任务：无法解析，忽略 */
  unresolvedPred: T[];
}

export function expandSummaryPredecessors<T extends ExpandableDependency>(
  tasks: ExpandableTask[],
  dependencies: T[],
): ExpandedEdges<T> {
  const summaryIds = new Set(tasks.filter((task) => task.taskType === "SUMMARY").map((task) => task.id));

  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const list = childrenOf.get(task.parentId);
    if (list) list.push(task.id);
    else childrenOf.set(task.parentId, [task.id]);
  }

  const cache = new Map<string, string[]>();
  const leafDescendants = (id: string): string[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    const result: string[] = [];
    const stack = [...(childrenOf.get(id) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (summaryIds.has(current)) stack.push(...(childrenOf.get(current) ?? []));
      else result.push(current);
    }
    cache.set(id, result);
    return result;
  };

  const edges: { dep: T; predId: string }[] = [];
  const invalidSucc: T[] = [];
  const unresolvedPred: T[] = [];

  for (const dep of dependencies) {
    if (summaryIds.has(dep.succId)) {
      invalidSucc.push(dep);
      continue;
    }
    if (summaryIds.has(dep.predId)) {
      const leaves = leafDescendants(dep.predId);
      if (leaves.length === 0) {
        unresolvedPred.push(dep);
        continue;
      }
      for (const predId of leaves) edges.push({ dep, predId });
      continue;
    }
    edges.push({ dep, predId: dep.predId });
  }

  return { edges, invalidSucc, unresolvedPred };
}
