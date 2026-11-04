"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "@/lib/domain/types";
import { addDays, todayStr } from "@/lib/date";
import type { DependencyView, TaskView } from "@/lib/view/types";
import type { MoveDirection } from "@/server/types";

interface TaskTableProps {
  tasks: TaskView[];
  dependencies: DependencyView[];
  exportName: string;
  selectedTaskId?: string | null;
  /** 新建后需要立即进入「项目描述」行内编辑的任务 id */
  autoEditTaskId?: string | null;
  /** 因本次计划调整（依赖 / 时长 / 新增任务）发生时间变化的任务，用于高亮关键列 */
  highlightTaskIds?: string[];
  onClearHighlight?: () => void;
  busy: boolean;
  onAutoEditConsumed?: () => void;
  onEdit: (task: TaskView) => void;
  onShowDetail: (task: TaskView) => void;
  onMove: (task: TaskView, direction: MoveDirection) => void;
  onDelete: (task: TaskView) => void;
  onProgress: (task: TaskView, pct: number) => void;
  onRename: (task: TaskView, name: string) => void;
  onChangeDuration: (task: TaskView, days: number) => void;
  onChangeAssignee: (task: TaskView, assignee: string) => void;
  onChangePredecessors: (task: TaskView, ids: string[]) => void;
  onInsertSibling: (task: TaskView) => void;
  onRenameAndInsertSibling?: (task: TaskView, name: string) => void;
  onAddTask: () => void;
  onOpenDependencies: () => void;
}

/** 可筛选列（Excel 式：标注在表头上，点击展开候选值 checkbox 列表） */
type FilterKey = "wbs" | "name" | "progress" | "assignee" | "status";

const COLUMNS: { label: string; filter?: FilterKey }[] = [
  { label: "" },
  { label: "序号", filter: "wbs" },
  { label: "项目描述", filter: "name" },
  { label: "是否里程碑" },
  { label: "进度", filter: "progress" },
  { label: "起始时间" },
  { label: "终止时间" },
  { label: "时长" },
  { label: "资源", filter: "assignee" },
  { label: "前级依赖" },
  { label: "状态", filter: "status" },
  { label: "操作" },
];

const FILTER_KEYS: FilterKey[] = ["wbs", "name", "progress", "assignee", "status"];

const FILTER_LABELS: Record<FilterKey, string> = {
  wbs: "序号",
  name: "项目描述",
  progress: "进度",
  assignee: "资源",
  status: "状态",
};

/** 空资源统一显示为「（空）」，便于在筛选中作为一个可选值 */
const EMPTY_ASSIGNEE = "（空）";

function emptyFilters(): Record<FilterKey, string[]> {
  return { wbs: [], name: [], progress: [], assignee: [], status: [] };
}

/** 某一列对应的「单元格取值」，筛选即在该取值上做多选匹配 */
function columnValue(key: FilterKey, task: TaskView): string {
  switch (key) {
    case "wbs":
      return task.wbsCode;
    case "name":
      return task.name;
    case "progress":
      return `${task.progressPct}%`;
    case "assignee":
      return task.assignee?.trim() || EMPTY_ASSIGNEE;
    case "status":
      return TASK_STATUS_LABELS[task.status];
  }
}

type EditField = "name" | "progress" | "duration" | "assignee";

type RowTone = "done" | "progress" | "nearDue" | "overdue" | "normal";

/** 行字体颜色口径（需求 7）：已完成绿 / 有进展蓝 / 临近延期黄 / 已延期红 */
const TONE_TEXT: Record<RowTone, string> = {
  done: "text-ok",
  progress: "text-accent",
  nearDue: "text-warn",
  overdue: "text-danger",
  normal: "text-muted",
};

const LEGEND: { tone: RowTone; dot: string; label: string }[] = [
  { tone: "done", dot: "bg-ok", label: "已完成" },
  { tone: "progress", dot: "bg-accent", label: "进行中（有进展）" },
  { tone: "nearDue", dot: "bg-warn", label: "临近延期（1 天内到期）" },
  { tone: "overdue", dot: "bg-danger", label: "已延期" },
];

/** 计划调整的连带影响：高亮「序号 / 项目描述 / 起始时间 / 终止时间」四列 */
const HIGHLIGHT_CELL = "bg-warn/[0.14] shadow-[inset_0_0_0_1px_rgba(251,191,36,0.42)]";

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rowToneOf(task: TaskView, today: string | null): RowTone {
  // 锚点是固定参照物，不参与「延期」判定
  if (task.isKickoff || task.isPreAccept) return "normal";
  if (task.status === "DONE" || task.progressPct >= 100) return "done";
  if (today && task.plannedEnd) {
    if (task.plannedEnd < today) return "overdue";
    if (task.plannedEnd <= addDays(today, 1)) return "nearDue";
  }
  if (task.progressPct > 0 || task.status === "IN_PROGRESS") return "progress";
  return "normal";
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function TaskTable({
  tasks,
  dependencies,
  exportName,
  selectedTaskId,
  autoEditTaskId,
  highlightTaskIds,
  onClearHighlight,
  busy,
  onAutoEditConsumed,
  onEdit,
  onShowDetail,
  onMove,
  onDelete,
  onProgress,
  onRename,
  onChangeDuration,
  onChangeAssignee,
  onChangePredecessors,
  onInsertSibling,
  onRenameAndInsertSibling,
  onAddTask,
  onOpenDependencies,
}: TaskTableProps) {
  const [editing, setEditing] = useState<{ taskId: string; field: EditField } | null>(null);
  const [depOpenId, setDepOpenId] = useState<string | null>(null);
  /** 行内「操作」下拉菜单（把 7 个动作收进菜单，portal + fixed 避免被滚动容器裁剪） */
  const [rowMenu, setRowMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  /** 前级依赖面板的「按序号直接添加」输入 */
  const [depQuery, setDepQuery] = useState("");
  const [depQueryError, setDepQueryError] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, string[]>>(emptyFilters);
  const [collapsedSummaryIds, setCollapsedSummaryIds] = useState<Set<string>>(new Set());
  const [openFilter, setOpenFilter] = useState<{ key: FilterKey; x: number; y: number } | null>(
    null,
  );
  const [filterSearch, setFilterSearch] = useState("");

  const clickTimer = useRef<number | null>(null);

  // 今日线：挂载后再取本地日期，避免 SSR / 客户端时区差异导致水合不一致
  useEffect(() => {
    setToday(todayStr());
  }, []);

  // 新建工作项后，直接在该行「项目描述」上进入编辑态
  useEffect(() => {
    if (!autoEditTaskId) return;
    if (!tasks.some((task) => task.id === autoEditTaskId)) return;
    setEditing({ taskId: autoEditTaskId, field: "name" });
    onAutoEditConsumed?.();
  }, [autoEditTaskId, tasks, onAutoEditConsumed]);

  useEffect(() => () => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);

  const filtered = useMemo(
    () =>
      tasks.filter((task) =>
        FILTER_KEYS.every((key) => {
          const selected = filters[key];
          if (selected.length === 0) return true;
          return selected.includes(columnValue(key, task));
        }),
      ),
    [tasks, filters],
  );

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const visibleTasks = useMemo(
    () =>
      filtered.filter((task) => {
        let parentId = task.parentId;
        while (parentId) {
          if (collapsedSummaryIds.has(parentId)) return false;
          parentId = taskById.get(parentId)?.parentId ?? null;
        }
        return true;
      }),
    [filtered, collapsedSummaryIds, taskById],
  );

  /** 当前展开列的全部候选值（去重排序），供 checkbox 列表与「全选」使用 */
  const filterOptions = useMemo(() => {
    if (!openFilter) return [] as string[];
    const values = new Set<string>();
    for (const task of tasks) values.add(columnValue(openFilter.key, task));
    return [...values].sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  }, [tasks, openFilter]);

  /** 候选值再经文字查询过滤后的可见项 */
  const visibleOptions = useMemo(() => {
    const keyword = filterSearch.trim().toLowerCase();
    if (!keyword) return filterOptions;
    return filterOptions.filter((option) => option.toLowerCase().includes(keyword));
  }, [filterOptions, filterSearch]);

  const hasActiveFilter = FILTER_KEYS.some((key) => filters[key].length > 0);

  const rowMenuTask = useMemo(
    () => (rowMenu ? (tasks.find((task) => task.id === rowMenu.taskId) ?? null) : null),
    [rowMenu, tasks],
  );

  // 面板为 fixed 定位，页面滚动 / 尺寸变化时直接关闭，避免与表头错位
  useEffect(() => {
    if (!openFilter) return;
    const close = () => setOpenFilter(null);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-pis-filter-panel]") || target?.closest("[data-pis-filter-trigger]")) {
        return;
      }
      setOpenFilter(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openFilter]);

  // 行内操作菜单：点击外部 / 滚动 / 尺寸变化时关闭
  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-pis-row-menu]") || target?.closest("[data-pis-row-menu-trigger]")) {
        return;
      }
      setRowMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [rowMenu]);

  // 切换依赖面板时清空「按序号添加」的输入与提示
  useEffect(() => {
    setDepQuery("");
    setDepQueryError(null);
  }, [depOpenId]);

  function openRowMenu(task: TaskView, trigger: HTMLElement) {
    if (rowMenu?.taskId === task.id) {
      setRowMenu(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const width = 176;
    const height = 252;
    const x = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 12));
    const y = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8));
    setRowMenu({ taskId: task.id, x, y });
  }

  /** 行内操作菜单项：7 个动作，均带中文名称 */
  function rowActions(task: TaskView) {
    return [
      { label: "上移", disabled: busy, run: () => onMove(task, "up") },
      { label: "下移", disabled: busy, run: () => onMove(task, "down") },
      { label: "缩进一级", disabled: busy, run: () => onMove(task, "indent") },
      { label: "升级一级", disabled: busy, run: () => onMove(task, "outdent") },
      {
        label: "在下方插入同级任务",
        disabled: busy || task.isPreAccept,
        run: () => onInsertSibling(task),
      },
      { label: "编辑详情", disabled: busy, run: () => onEdit(task) },
      {
        label: "删除",
        disabled: busy || !isEditable(task),
        danger: true,
        run: () => onDelete(task),
      },
    ];
  }

  function openFilterPanel(key: FilterKey, trigger: HTMLElement) {
    if (openFilter?.key === key) {
      setOpenFilter(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const panelWidth = 236;
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 12));
    setFilterSearch("");
    setOpenFilter({ key, x, y: rect.bottom + 6 });
  }

  function toggleOption(key: FilterKey, value: string) {
    setFilters((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  }

  function selectAllVisible() {
    const key = openFilter?.key;
    if (!key) return;
    setFilters((prev) => {
      const merged = new Set(prev[key]);
      for (const option of visibleOptions) merged.add(option);
      return { ...prev, [key]: [...merged] };
    });
  }

  /** 因本次计划调整而需要高亮的任务集合（需求 2） */
  const highlightSet = useMemo(() => new Set(highlightTaskIds ?? []), [highlightTaskIds]);

  /** 追加依赖边时会形成环路的候选（客户端预判，服务端 V2 仍会阻断） */
  const successorMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const dep of dependencies) {
      const list = map.get(dep.predId);
      if (list) list.push(dep.succId);
      else map.set(dep.predId, [dep.succId]);
    }
    return map;
  }, [dependencies]);

  /** 任意任务的全部后代 id（供「不能依赖自身后代」判断） */
  const descendantIdsOf = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const task of tasks) {
      if (!task.parentId) continue;
      const list = childrenOf.get(task.parentId);
      if (list) list.push(task.id);
      else childrenOf.set(task.parentId, [task.id]);
    }
    return (id: string): Set<string> => {
      const result = new Set<string>();
      const stack = [...(childrenOf.get(id) ?? [])];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        if (result.has(current)) continue;
        result.add(current);
        stack.push(...(childrenOf.get(current) ?? []));
      }
      return result;
    };
  }, [tasks]);

  function cyclicCandidates(taskId: string): Set<string> {
    const blocked = new Set<string>();
    const stack = [taskId];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const next of successorMap.get(current) ?? []) {
        if (!blocked.has(next)) {
          blocked.add(next);
          stack.push(next);
        }
      }
    }
    return blocked;
  }

  function isEditable(task: TaskView): boolean {
    return !task.isKickoff && !task.isPreAccept;
  }

  function handleNameClick(task: TaskView) {
    if (!isEditable(task)) return;
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      return;
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      setEditing({ taskId: task.id, field: "name" });
    }, 220);
  }

  function handleNameDoubleClick(task: TaskView) {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onShowDetail(task);
    onEdit(task);
  }

  function toggleSummary(taskId: string) {
    setCollapsedSummaryIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function commitEdit(value: string, insertSibling = false) {
    const current = editing;
    setEditing(null);
    if (!current) return;
    const task = tasks.find((item) => item.id === current.taskId);
    if (!task) return;
    const raw = value.trim();
    if (current.field === "name") {
      if (insertSibling) {
        if (raw && raw !== task.name && onRenameAndInsertSibling) {
          onRenameAndInsertSibling(task, raw);
          return;
        }
        if (raw && raw !== task.name) onRename(task, raw);
        onInsertSibling(task);
        return;
      }
      if (raw && raw !== task.name) onRename(task, raw);
      return;
    }
    if (current.field === "assignee") {
      if (raw !== (task.assignee ?? "")) onChangeAssignee(task, raw);
      return;
    }
    if (current.field === "duration") {
      const days = Math.round(Number(value));
      if (Number.isFinite(days) && days >= 1 && days !== task.durationDays) {
        onChangeDuration(task, days);
      }
      return;
    }
    if (current.field === "progress") {
      const pct = clampPct(Number(value));
      if (pct !== task.progressPct) onProgress(task, pct);
    }
  }

  function nudgeProgress(task: TaskView, delta: number) {
    const next = clampPct(task.progressPct + delta);
    if (next !== task.progressPct) onProgress(task, next);
  }

  function togglePredecessor(task: TaskView, predId: string) {
    const next = task.predecessorIds.includes(predId)
      ? task.predecessorIds.filter((id) => id !== predId)
      : [...task.predecessorIds, predId];
    onChangePredecessors(task, next);
  }

  function exportCsv() {
    const header = [
      "序号",
      "项目描述",
      "是否里程碑",
      "进度",
      "起始时间",
      "终止时间",
      "时长",
      "资源",
      "前级依赖",
      "状态",
    ];
    const rows = filtered.map((task) => [
      task.wbsCode,
      task.name,
      task.taskType === "TASK" ? "" : TASK_TYPE_LABELS[task.taskType],
      `${task.progressPct}%`,
      task.plannedStart ?? "",
      task.plannedEnd ?? "",
      task.taskType === "MILESTONE" ? "0" : String(task.durationDays),
      task.assignee ?? "",
      task.predecessorCodes.join(" "),
      TASK_STATUS_LABELS[task.status],
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}-任务表-${todayStr()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 前级依赖候选：允许依赖汇总节点（语义为「依赖其下全部工作完成」）；
   * 排除初验点锚点、自身及其后代（后代作为前级会形成自环，无意义）。
   */
  function depCandidatesFor(taskId: string): TaskView[] {
    const descendants = descendantIdsOf(taskId);
    return tasks.filter((item) => !item.isPreAccept && item.id !== taskId && !descendants.has(item.id));
  }

  /** 依赖候选按输入框关键字（序号 / 名称）过滤后的可见项 */
  function depVisibleFor(candidates: TaskView[]): TaskView[] {
    const keyword = depQuery.trim().toLowerCase();
    if (!keyword) return candidates;
    return candidates.filter(
      (item) =>
        item.wbsCode.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword),
    );
  }

  /** 需求 1：直接输入被依赖项目的序号（如 4.1）添加前级依赖 */
  function addPredecessorByCode(task: TaskView, candidates: TaskView[], cyclic: Set<string>) {
    const code = depQuery.trim();
    if (!code) return;
    const hit = candidates.find((item) => item.wbsCode.toLowerCase() === code.toLowerCase());
    if (!hit) {
      setDepQueryError(`未找到序号「${code}」`);
      return;
    }
    if (task.predecessorIds.includes(hit.id)) {
      setDepQueryError(`${hit.wbsCode} 已经是前级依赖`);
      return;
    }
    const selfSummary = hit.taskType === "SUMMARY" && descendantIdsOf(hit.id).has(task.id);
    if (cyclic.has(hit.id) || selfSummary) {
      setDepQueryError(`${hit.wbsCode} 会形成循环依赖，无法添加`);
      return;
    }
    setDepQuery("");
    setDepQueryError(null);
    togglePredecessor(task, hit.id);
  }

  return (
    <div className="pis-card overflow-hidden">
      {/* ===== 功能区 ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-3 py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-wide">任务表</h2>
          <span className="text-[11px] text-faint">
            共 {tasks.length} 项
            {filtered.length !== tasks.length ? ` · 筛选后 ${filtered.length} 项` : ""}
            {visibleTasks.length !== filtered.length ? ` · 当前展开 ${visibleTasks.length} 项` : ""}
          </span>
          {hasActiveFilter ? (
            <button
              type="button"
              className="text-[11px] text-accent transition hover:underline"
              onClick={() => setFilters(emptyFilters())}
            >
              清除筛选
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {highlightSet.size > 0 ? (
            <button
              type="button"
              className="text-[11px] text-warn transition hover:underline"
              title="取消本次计划调整的连带影响高亮"
              onClick={onClearHighlight}
            >
              清除影响显示（{highlightSet.size} 项）
            </button>
          ) : null}
          <button type="button" className="pis-btn px-2.5 py-1.5 text-xs" onClick={exportCsv}>
            导出 CSV
          </button>
          <button
            type="button"
            className="pis-btn px-2.5 py-1.5 text-xs"
            onClick={onOpenDependencies}
          >
            依赖关系
          </button>
          <button
            type="button"
            className="pis-btn pis-btn-primary px-2.5 py-1.5 text-xs"
            onClick={onAddTask}
          >
            + 新增工作项
          </button>
        </div>
      </div>

      {/* ===== 列筛选面板（Excel 式：portal + fixed，避免被滚动容器裁剪/被 backdrop-blur 改变定位基准） ===== */}
      {openFilter
        ? createPortal(
            <div
              data-pis-filter-panel
              className="fixed z-50 rounded-xl border border-line bg-elevated p-2 shadow-2xl shadow-black/50"
              style={{ left: openFilter.x, top: openFilter.y, width: 236 }}
            >
              <div className="flex items-center justify-between px-0.5 pb-1.5">
                <span className="text-[11px] font-medium text-fg">
                  筛选「{FILTER_LABELS[openFilter.key]}」
                </span>
                <button
                  type="button"
                  className="text-[11px] text-faint transition hover:text-fg"
                  onClick={() => setOpenFilter(null)}
                >
                  ✕
                </button>
              </div>
              <input
                autoFocus
                value={filterSearch}
                onChange={(event) => setFilterSearch(event.target.value)}
                placeholder="输入文字查询…"
                className="pis-input px-2 py-1 text-[11px]"
              />
              <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px] text-faint">
                <button
                  type="button"
                  className="transition hover:text-accent"
                  onClick={() => setFilters((prev) => ({ ...prev, [openFilter.key]: [] }))}
                >
                  清除本列
                </button>
                <button
                  type="button"
                  className="transition hover:text-accent"
                  onClick={selectAllVisible}
                >
                  全选当前 {visibleOptions.length} 项
                </button>
              </div>
              <div className="mt-1 max-h-52 overflow-auto rounded-lg border border-line-soft bg-panel/50">
                {visibleOptions.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[11px] text-faint">无匹配项</p>
                ) : (
                  visibleOptions.map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] text-muted hover:bg-white/[0.04]"
                    >
                      <input
                        type="checkbox"
                        className="accent-[#38bdf8]"
                        checked={filters[openFilter.key].includes(option)}
                        onChange={() => toggleOption(openFilter.key, option)}
                      />
                      <span className="truncate" title={option}>
                        {option}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1.5 px-0.5 text-[11px] text-faint">
                勾选即筛选（同列多选为「或」，不同列为「且」）。
              </p>
            </div>,
            document.body,
          )
        : null}

      {/* ===== 行内「操作」下拉菜单 ===== */}
      {rowMenu
        ? createPortal(
            <div
              data-pis-row-menu
              className="fixed z-50 w-44 overflow-hidden rounded-xl border border-line bg-elevated py-1 shadow-2xl shadow-black/50"
              style={{ left: rowMenu.x, top: rowMenu.y }}
            >
              {rowMenuTask
                ? rowActions(rowMenuTask).map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={action.disabled}
                      onClick={() => {
                        setRowMenu(null);
                        action.run();
                      }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition disabled:opacity-35 ${
                        "danger" in action && action.danger
                          ? "text-danger hover:bg-danger/10"
                          : "text-muted hover:bg-white/[0.05] hover:text-fg"
                      }`}
                    >
                      {action.label}
                    </button>
                  ))
                : null}
            </div>,
            document.body,
          )
        : null}

      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
        <table className="w-full min-w-max border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr>
              {COLUMNS.map((column, index) => (
                <th
                  key={column.label}
                  className={`border-b border-line py-2 font-medium whitespace-nowrap text-faint ${
                    index === 0
                      ? "w-3 px-0.5 text-center"
                      : index === 1
                        ? "px-2.5 text-right"
                        : "px-2.5 text-left"
                  }`}
                >
                  {column.filter ? (
                    <span className="inline-flex items-center gap-1">
                      <span>{column.label}</span>
                      <button
                        type="button"
                        data-pis-filter-trigger
                        title={`筛选「${column.label}」`}
                        aria-label={`筛选${column.label}`}
                        onClick={(event) => openFilterPanel(column.filter!, event.currentTarget)}
                        className={`grid size-4 place-items-center rounded transition hover:bg-elevated hover:text-accent ${
                          filters[column.filter].length > 0
                            ? "bg-accent/15 text-accent"
                            : "text-faint/80"
                        }`}
                      >
                        <span className="text-[8px] leading-none">▼</span>
                      </button>
                    </span>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((task) => {
              const editable = isEditable(task);
              const tone = rowToneOf(task, today);
              const depOpen = depOpenId === task.id;
              const cyclic = depOpen ? cyclicCandidates(task.id) : new Set<string>();
              const depCandidates = depOpen ? depCandidatesFor(task.id) : [];
              const depVisible = depOpen ? depVisibleFor(depCandidates) : [];
              const editingField = editing?.taskId === task.id ? editing.field : null;
              const hasChildren = tasks.some((item) => item.parentId === task.id);
              const isCollapsed = collapsedSummaryIds.has(task.id);
              // 本次计划调整的连带影响：高亮「序号 / 项目描述 / 起始时间 / 终止时间」
              const mark = highlightSet.has(task.id) ? HIGHLIGHT_CELL : "";
              return (
                <Fragment key={task.id}>
                  <tr
                    className={`border-b border-line-soft/50 transition hover:bg-white/[0.03] ${
                      TONE_TEXT[tone]
                    } ${selectedTaskId === task.id ? "bg-accent/10" : ""}`}
                  >
                    <td className="px-0.5 py-1.5 text-center align-middle whitespace-nowrap">
                      {task.taskType === "SUMMARY" && hasChildren ? (
                        <button
                          type="button"
                          title={isCollapsed ? "展开子任务" : "折叠子任务"}
                          onClick={() => toggleSummary(task.id)}
                          className="inline-flex size-4 items-center justify-center rounded border border-line bg-elevated/50 text-[9px] leading-none text-faint transition hover:border-accent/30 hover:text-accent"
                        >
                          {isCollapsed ? "＋" : "－"}
                        </button>
                      ) : (
                        <span className="inline-block size-4" />
                      )}
                    </td>
                    <td className={`px-2.5 py-1.5 text-right align-middle whitespace-nowrap ${mark}`}>
                      <span className="flex items-center justify-end gap-1.5">
                        {task.isCritical ? (
                          <span
                            className="size-1.5 rounded-full bg-critical"
                            title="关键路径任务"
                          />
                        ) : null}
                        <span className="font-mono text-[11px]">{task.wbsCode}</span>
                      </span>
                    </td>
                    <td className={`px-2.5 py-1.5 align-middle ${mark}`}>
                      {editingField === "name" ? (
                        <InlineInput
                          defaultValue={task.name}
                          className="min-w-[190px]"
                          onCommit={commitEdit}
                          enterAsInsertSibling
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleNameClick(task)}
                          onDoubleClick={() => handleNameDoubleClick(task)}
                          className={`block max-w-[320px] truncate text-left ${
                            editable ? "cursor-pointer hover:text-accent" : "cursor-default"
                          }`}
                          style={{ paddingLeft: task.depth * 14 }}
                          title={
                            editable
                              ? `${task.name}（单击修改项目描述，双击直接编辑详情）`
                              : `${task.name}（双击直接编辑详情）`
                          }
                        >
                          <span className={task.taskType === "SUMMARY" ? "font-semibold" : ""}>
                            {task.name}
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                      {task.taskType === "TASK" ? "—" : TASK_TYPE_LABELS[task.taskType]}
                    </td>
                    <td className="px-2.5 py-1.5 align-middle">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-elevated">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
                            style={{ width: `${clampPct(task.progressPct)}%` }}
                          />
                        </div>
                        {editingField === "progress" ? (
                          <InlineInput
                            defaultValue={String(task.progressPct)}
                            type="number"
                            min={0}
                            max={100}
                            className="w-14 text-center"
                            onCommit={commitEdit}
                            onCancel={() => setEditing(null)}
                          />
                        ) : editable ? (
                          <button
                            type="button"
                            className="min-w-9 rounded px-1 text-left font-mono text-[11px] hover:text-accent"
                            title="单击修改进度"
                            onClick={() => setEditing({ taskId: task.id, field: "progress" })}
                          >
                            {task.progressPct}%
                          </button>
                        ) : (
                          <span className="font-mono text-[11px]">{task.progressPct}%</span>
                        )}
                        {editable && editingField !== "progress" ? (
                          <span className="flex flex-col leading-none">
                            <button
                              type="button"
                              title="增加 10%"
                              disabled={busy}
                              onClick={() => nudgeProgress(task, 10)}
                              className="px-0.5 text-[8px] text-faint transition hover:text-accent disabled:opacity-30"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              title="减少 10%"
                              disabled={busy}
                              onClick={() => nudgeProgress(task, -10)}
                              className="px-0.5 text-[8px] text-faint transition hover:text-accent disabled:opacity-30"
                            >
                              ▼
                            </button>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={`px-2.5 py-1.5 align-middle font-mono whitespace-nowrap ${mark}`}>
                      {task.plannedStart ?? <span className="text-faint">—</span>}
                    </td>
                    <td className={`px-2.5 py-1.5 align-middle font-mono whitespace-nowrap ${mark}`}>
                      {task.plannedEnd ?? <span className="text-faint">—</span>}
                    </td>
                    <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                      {task.taskType !== "TASK" ? (
                        <span>{task.taskType === "MILESTONE" ? "0" : `${task.durationDays} 天`}</span>
                      ) : editingField === "duration" ? (
                        <InlineInput
                          defaultValue={String(task.durationDays)}
                          type="number"
                          min={1}
                          className="w-14 text-center"
                          onCommit={commitEdit}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="rounded px-1 hover:text-accent"
                          title="单击修改时长（工作日）"
                          onClick={() => setEditing({ taskId: task.id, field: "duration" })}
                        >
                          {task.durationDays} 天
                        </button>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                      {editable && editingField === "assignee" ? (
                        <InlineInput
                          defaultValue={task.assignee ?? ""}
                          className="w-20"
                          onCommit={commitEdit}
                          onCancel={() => setEditing(null)}
                        />
                      ) : editable ? (
                        <button
                          type="button"
                          className="rounded px-1 hover:text-accent"
                          title="单击修改资源"
                          onClick={() => setEditing({ taskId: task.id, field: "assignee" })}
                        >
                          {task.assignee || <span className="text-faint">—</span>}
                        </button>
                      ) : (
                        task.assignee || <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                      {editable ? (
                        <button
                          type="button"
                          className={`rounded px-1 font-mono text-[11px] hover:text-accent ${
                            depOpen ? "bg-accent/15 text-accent" : ""
                          }`}
                          title="单击修改前级依赖"
                          onClick={() => setDepOpenId(depOpen ? null : task.id)}
                        >
                          {task.predecessorCodes.length > 0 ? (
                            task.predecessorCodes.join(", ")
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </button>
                      ) : task.predecessorCodes.length > 0 ? (
                        <span className="font-mono text-[11px]">
                          {task.predecessorCodes.join(", ")}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${
                          task.status === "DONE"
                            ? "border-ok/40 bg-ok/10 text-ok"
                            : task.status === "IN_PROGRESS"
                              ? "border-accent/40 bg-accent/10 text-accent"
                              : task.status === "BLOCKED"
                                ? "border-danger/40 bg-danger/10 text-danger"
                                : "border-line bg-elevated/60 text-muted"
                        }`}
                      >
                        {TASK_STATUS_LABELS[task.status]}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 align-middle whitespace-nowrap">
                      <button
                        type="button"
                        data-pis-row-menu-trigger
                        disabled={busy}
                        onClick={(event) => openRowMenu(task, event.currentTarget)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated/50 px-2 py-1 text-[11px] text-muted transition hover:border-accent/30 hover:text-fg disabled:opacity-40"
                      >
                        操作
                        <span className="text-[9px]">▾</span>
                      </button>
                    </td>
                  </tr>
                  {depOpen ? (
                    <tr className="border-b border-line-soft/50 bg-elevated/30">
                      <td colSpan={COLUMNS.length} className="px-3 py-2">
                        <div className="flex flex-wrap items-start gap-3">
                          <span className="pis-label mb-0 shrink-0 pt-0.5">
                            {task.wbsCode} 的前级依赖
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2">
                              <input
                                value={depQuery}
                                onChange={(event) => {
                                  setDepQuery(event.target.value);
                                  setDepQueryError(null);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    addPredecessorByCode(task, depCandidates, cyclic);
                                  } else if (event.key === "Escape") {
                                    setDepQuery("");
                                    setDepQueryError(null);
                                  }
                                }}
                                placeholder="直接输入前级序号后回车，如 4.1"
                                className="pis-input w-56 px-2 py-1 text-[11px]"
                              />
                              <button
                                type="button"
                                className="pis-btn px-2 py-1 text-[11px]"
                                disabled={busy || depQuery.trim().length === 0}
                                onClick={() => addPredecessorByCode(task, depCandidates, cyclic)}
                              >
                                添加前级
                              </button>
                              {depQueryError ? (
                                <span className="text-[11px] text-danger">{depQueryError}</span>
                              ) : (
                                <span className="text-[11px] text-faint">也可在下方列表中勾选</span>
                              )}
                            </div>
                            <div className="grid max-h-40 gap-1 overflow-auto rounded-lg border border-line bg-panel/60 p-2 sm:grid-cols-2 lg:grid-cols-3">
                              {depVisible.length === 0 ? (
                                <p className="text-[11px] text-faint">
                                  {depCandidates.length === 0 ? "暂无可选前级任务。" : "无匹配项"}
                                </p>
                              ) : (
                                depVisible.map((candidate) => {
                                  const checked = task.predecessorIds.includes(candidate.id);
                                  // 汇总节点若包含当前任务自身，依赖它会形成自环
                                  const selfSummary =
                                    candidate.taskType === "SUMMARY" &&
                                    descendantIdsOf(candidate.id).has(task.id);
                                  const blocked =
                                    !checked && (cyclic.has(candidate.id) || selfSummary);
                                  return (
                                    <label
                                      key={candidate.id}
                                      title={
                                        blocked
                                          ? "该选择会形成循环依赖，已禁用"
                                          : candidate.name
                                      }
                                      className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] ${
                                        blocked
                                          ? "cursor-not-allowed text-faint/60"
                                          : "cursor-pointer text-muted hover:bg-white/[0.04]"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="accent-[#38bdf8]"
                                        checked={checked}
                                        disabled={busy || blocked}
                                        onChange={() => togglePredecessor(task, candidate.id)}
                                      />
                                      <span className="font-mono text-[11px] text-faint">
                                        {candidate.wbsCode}
                                      </span>
                                      <span className="truncate">
                                        {candidate.name}
                                        {blocked ? "（会形成循环依赖）" : ""}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-faint">
                              勾选即保存；除开工会外每个任务至少需要 1 个前级依赖。可选择汇总节点，
                              表示依赖其下全部工作完成。
                            </p>
                          </div>
                          <button
                            type="button"
                            className="pis-btn px-2 py-1 text-xs"
                            onClick={() => setDepOpenId(null)}
                          >
                            关闭
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {visibleTasks.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">
            {tasks.length === 0 ? "暂无任务，请先新增工作项。" : "没有符合筛选条件的任务。"}
          </p>
        ) : null}
      </div>

      {/* ===== 颜色图例 ===== */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-soft px-3 py-2 text-[11px] text-faint">
        <span>颜色图例：</span>
        {LEGEND.map((item) => (
          <span key={item.tone} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${item.dot}`} />
            <span className={TONE_TEXT[item.tone]}>{item.label}</span>
          </span>
        ))}
        <span className="text-faint/70">
          （期限判定基于「终止时间」与今日对比；开工会 / 初验点锚点不参与）
        </span>
      </div>
    </div>
  );
}

function InlineInput({
  defaultValue,
  type = "text",
  min,
  max,
  className = "",
  onCommit,
  enterAsInsertSibling = false,
  onCancel,
}: {
  defaultValue: string;
  type?: string;
  min?: number;
  max?: number;
  className?: string;
  onCommit: (value: string, insertSibling?: boolean) => void;
  enterAsInsertSibling?: boolean;
  onCancel: () => void;
}) {
  const cancelled = useRef(false);
  const handled = useRef(false);
  const [value, setValue] = useState(defaultValue);
  return (
    <input
      autoFocus
      value={value}
      type={type}
      min={min}
      max={max}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          handled.current = true;
          onCommit(value, enterAsInsertSibling);
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          cancelled.current = true;
          handled.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (cancelled.current) {
          onCancel();
          return;
        }
        if (!handled.current) onCommit(value);
      }}
      className={`rounded border border-accent/60 bg-elevated px-1 py-0.5 text-[11px] outline-none focus:border-accent ${className}`}
    />
  );
}
