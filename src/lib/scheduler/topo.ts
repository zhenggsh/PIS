/**
 * 拓扑排序 + 环检测（设计文档 6.2）
 * 纯函数，返回拓扑序或环路任务链。
 */

export interface TopoEdge {
  predId: string;
  succId: string;
}

export interface TopoResult {
  order: string[];
  /** 非空表示存在环，值为环路任务链（首尾相接） */
  cycle: string[];
}

export function topoSort(nodeIds: string[], edges: TopoEdge[]): TopoResult {
  const nodes = new Set(nodeIds);
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
    indegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!nodes.has(edge.predId) || !nodes.has(edge.succId)) continue;
    adjacency.get(edge.predId)!.push(edge.succId);
    indegree.set(edge.succId, (indegree.get(edge.succId) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length === nodeIds.length) {
    return { order, cycle: [] };
  }

  // 剩余节点即处于环中或其下游，用 DFS 找出具体环路
  const ordered = new Set(order);
  const remaining = nodeIds.filter((id) => !ordered.has(id));
  return { order, cycle: findCycle(remaining, adjacency) };
}

function findCycle(nodeIds: string[], adjacency: Map<string, string[]>): string[] {
  const inStack = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const dfs = (id: string): string[] | null => {
    if (inStack.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    if (visited.has(id)) return null;
    visited.add(id);
    inStack.add(id);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const found = dfs(next);
      if (found) return found;
    }
    path.pop();
    inStack.delete(id);
    return null;
  };

  for (const id of nodeIds) {
    const found = dfs(id);
    if (found) return found;
  }
  return [];
}
