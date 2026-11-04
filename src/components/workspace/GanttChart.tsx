"use client";

import { useMemo } from "react";
import { addDays, enumerateDates, todayStr, weekdayIndex, WEEKDAY_LABELS, type DateStr } from "@/lib/date";
import type { ProjectView, TaskView, WorkspaceSummary } from "@/lib/view/types";

const DAY_W = 30;
const ROW_H = 34;
const LABEL_W = 320;
const HEADER_H = 56;

interface GanttProps {
  project: ProjectView;
  tasks: TaskView[];
  dependencies: { id: string; predId: string; succId: string; lagDays: number }[];
  summary: WorkspaceSummary;
  holidays: string[];
  selectedTaskId?: string | null;
  onSelectTask: (task: TaskView) => void;
}

export function GanttChart({
  project,
  tasks,
  dependencies,
  summary,
  holidays,
  selectedTaskId,
  onSelectTask,
}: GanttProps) {
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const today = todayStr();

  const { days, dayIndex, months, rangeStart } = useMemo(() => {
    const anchors: DateStr[] = [project.kickoffDate, project.preAcceptDate];
    for (const task of tasks) {
      if (task.plannedStart) anchors.push(task.plannedStart);
      if (task.plannedEnd) anchors.push(task.plannedEnd);
    }
    let min = anchors[0];
    let max = anchors[0];
    for (const value of anchors) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const start = addDays(min, -2);
    const end = addDays(max, 3);
    const list = enumerateDates(start, end);
    const index = new Map<string, number>();
    list.forEach((date, position) => index.set(date, position));

    const groups: { key: string; label: string; span: number }[] = [];
    for (const date of list) {
      const key = date.slice(0, 7);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.span += 1;
      else groups.push({ key, label: `${Number(key.slice(5, 7))}月`, span: 1 });
    }
    return { days: list, dayIndex: index, months: groups, rangeStart: start };
  }, [project.kickoffDate, project.preAcceptDate, tasks]);

  const rowIndexOf = useMemo(() => {
    const map = new Map<string, number>();
    tasks.forEach((task, index) => map.set(task.id, index));
    return map;
  }, [tasks]);

  const timelineWidth = days.length * DAY_W;
  const rowsHeight = tasks.length * ROW_H;

  const isWorkday = (date: DateStr) => {
    const bit = 1 << weekdayIndex(date);
    return (project.workweekMask & bit) !== 0 && !holidaySet.has(date);
  };

  const barGeometry = (task: TaskView) => {
    if (!task.plannedStart || !task.plannedEnd) return null;
    const startIndex = dayIndex.get(task.plannedStart);
    const endIndex = dayIndex.get(task.plannedEnd);
    if (startIndex === undefined || endIndex === undefined) return null;
    if (task.taskType === "MILESTONE") {
      return { kind: "milestone" as const, x: startIndex * DAY_W + DAY_W / 2, width: 0 };
    }
    return {
      kind: "bar" as const,
      x: startIndex * DAY_W + 1,
      width: Math.max(DAY_W - 2, (endIndex - startIndex + 1) * DAY_W - 2),
    };
  };

  const anchorLine = (date: DateStr) => {
    const index = dayIndex.get(date);
    return index === undefined ? null : index * DAY_W + DAY_W / 2;
  };

  const preAcceptX = anchorLine(summary.requiredFinish);
  const kickoffX = anchorLine(project.kickoffDate);
  const todayX = anchorLine(today);

  return (
    <div className="pis-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-2.5 text-[11px] text-faint">
        <span className="font-medium text-muted">图例</span>
        <Legend className="bg-accent/25 border-accent/50" label="计划任务" />
        <Legend className="bg-critical/30 border-critical/70" label="关键路径" />
        <Legend className="bg-ok/25 border-ok/50" label="已完成" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rotate-45 border border-accent bg-accent/40" />
          里程碑
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0 border-l border-dashed border-warn" />
          初验点
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0 border-l border-dashed border-accent-2" />
          今日
        </span>
      </div>

      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <div className="flex min-w-max">
          {/* ===== 左侧 WBS 标签列 ===== */}
          <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-panel" style={{ width: LABEL_W }}>
            <div
              className="sticky top-0 z-10 flex items-end border-b border-line bg-panel px-3 pb-2"
              style={{ height: HEADER_H }}
            >
              <span className="text-[11px] font-medium tracking-wide text-faint">
                工作分解（WBS）
              </span>
            </div>
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task)}
                className={`flex w-full items-center gap-1.5 border-b border-line-soft/60 px-2 text-left transition hover:bg-white/[0.04] ${
                  selectedTaskId === task.id ? "bg-accent/10" : ""
                }`}
                style={{ height: ROW_H, paddingLeft: 8 + task.depth * 14 }}
              >
                <span className="w-12 shrink-0 truncate font-mono text-[10px] text-faint">
                  {task.wbsCode}
                </span>
                {task.isCritical ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-critical" title="关键路径" />
                ) : null}
                <span
                  className={`truncate text-xs ${
                    task.taskType === "SUMMARY" ? "font-semibold text-fg" : "text-muted"
                  }`}
                >
                  {task.name}
                </span>
                {task.isPreAccept ? <span className="pis-chip shrink-0">初验</span> : null}
                {task.isKickoff ? <span className="pis-chip shrink-0">开工会</span> : null}
              </button>
            ))}
          </div>

          {/* ===== 右侧时间轴 ===== */}
          <div className="relative" style={{ width: timelineWidth }}>
            <div className="sticky top-0 z-10 border-b border-line bg-panel" style={{ height: HEADER_H }}>
              <div className="flex h-6 items-stretch border-b border-line-soft">
                {months.map((month) => (
                  <div
                    key={month.key}
                    className="flex items-center border-r border-line-soft px-2 text-[10px] font-medium tracking-wide text-muted"
                    style={{ width: month.span * DAY_W }}
                  >
                    {month.label}
                  </div>
                ))}
              </div>
              <div className="flex h-8 items-stretch">
                {days.map((date) => (
                  <div
                    key={date}
                    className={`flex flex-col items-center justify-center border-r border-line-soft/50 text-[9px] leading-tight ${
                      isWorkday(date) ? "text-faint" : "bg-white/[0.02] text-faint/60"
                    }`}
                    style={{ width: DAY_W }}
                  >
                    <span>{Number(date.slice(8, 10))}</span>
                    <span>{WEEKDAY_LABELS[weekdayIndex(date)]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 网格背景 */}
            <div className="pointer-events-none absolute left-0 z-0" style={{ top: HEADER_H }}>
              <div className="flex" style={{ height: Math.max(rowsHeight, 60) }}>
                {days.map((date) => (
                  <div
                    key={date}
                    className={`border-r border-line-soft/40 ${isWorkday(date) ? "" : "bg-white/[0.025]"}`}
                    style={{ width: DAY_W }}
                  />
                ))}
              </div>
            </div>

            {/* 锚点参考线 */}
            <div className="pointer-events-none absolute inset-0 z-20">
              {kickoffX !== null ? (
                <div
                  className="absolute border-l border-dashed border-accent/45"
                  style={{ left: kickoffX, top: HEADER_H, height: Math.max(rowsHeight, 60) }}
                />
              ) : null}
              {preAcceptX !== null ? (
                <div
                  className="absolute border-l border-dashed border-warn/70"
                  style={{ left: preAcceptX, top: HEADER_H, height: Math.max(rowsHeight, 60) }}
                />
              ) : null}
              {todayX !== null ? (
                <div
                  className="absolute border-l border-dashed border-accent-2/60"
                  style={{ left: todayX, top: HEADER_H, height: Math.max(rowsHeight, 60) }}
                />
              ) : null}
            </div>

            {/* 行内容 */}
            <div className="relative z-10" style={{ height: Math.max(rowsHeight, 60) }}>
              {tasks.map((task, index) => {
                const geometry = barGeometry(task);
                const isDone = task.status === "DONE";
                const tone = isDone
                  ? "border-ok/50 bg-ok/20"
                  : task.isCritical
                    ? "border-critical/70 bg-critical/25"
                    : "border-accent/50 bg-accent/20";
                const fill = isDone ? "bg-ok/60" : task.isCritical ? "bg-critical/60" : "bg-accent/60";
                return (
                  <div
                    key={task.id}
                    className="absolute left-0 w-full"
                    style={{ top: index * ROW_H, height: ROW_H }}
                  >
                    {geometry?.kind === "bar" ? (
                      <button
                        type="button"
                        onClick={() => onSelectTask(task)}
                        title={`${task.wbsCode} ${task.name}（${task.plannedStart} ~ ${task.plannedEnd}）`}
                        className={`absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-md border ${tone} transition hover:brightness-125`}
                        style={{
                          left: geometry.x,
                          width: geometry.width,
                          height: task.taskType === "SUMMARY" ? 10 : 18,
                        }}
                      >
                        {task.taskType !== "SUMMARY" && task.progressPct > 0 ? (
                          <span
                            className={`absolute inset-y-0 left-0 ${fill}`}
                            style={{ width: `${Math.min(100, task.progressPct)}%` }}
                          />
                        ) : null}
                        {geometry.width > 72 && task.taskType !== "SUMMARY" ? (
                          <span className="relative z-10 block truncate px-1.5 text-[10px] leading-[18px] text-fg/90">
                            {task.progressPct}%
                          </span>
                        ) : null}
                      </button>
                    ) : null}

                    {geometry?.kind === "milestone" ? (
                      <button
                        type="button"
                        onClick={() => onSelectTask(task)}
                        title={`${task.wbsCode} ${task.name}（${task.plannedStart}）`}
                        className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border transition hover:brightness-125 ${
                          task.isPreAccept
                            ? "border-warn bg-warn/50"
                            : isDone
                              ? "border-ok bg-ok/50"
                              : task.isCritical
                                ? "border-critical bg-critical/50"
                                : "border-accent bg-accent/40"
                        }`}
                        style={{ left: geometry.x }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* 依赖箭头 */}
            <svg
              className="pointer-events-none absolute left-0 z-30"
              style={{ top: HEADER_H, width: timelineWidth, height: Math.max(rowsHeight, 60) }}
            >
              <defs>
                <marker id="pis-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="#38bdf8" />
                </marker>
              </defs>
              {dependencies.map((dep) => {
                const predRow = rowIndexOf.get(dep.predId);
                const succRow = rowIndexOf.get(dep.succId);
                if (predRow === undefined || succRow === undefined) return null;
                const pred = tasks[predRow];
                const succ = tasks[succRow];
                const predGeometry = barGeometry(pred);
                const succGeometry = barGeometry(succ);
                if (!predGeometry || !succGeometry) return null;

                const x1 =
                  predGeometry.kind === "milestone"
                    ? predGeometry.x + 7
                    : predGeometry.x + predGeometry.width;
                const x2 =
                  succGeometry.kind === "milestone" ? succGeometry.x - 7 : succGeometry.x;
                const y1 = predRow * ROW_H + ROW_H / 2;
                const y2 = succRow * ROW_H + ROW_H / 2;
                // 出口向右引出、入口向右收尾，保证箭头一律朝右
                const entryX = x2 - 2;
                const bendX = entryX - 12;
                const stub = x1 + 8;
                const d =
                  bendX >= stub
                    ? `M ${x1} ${y1} H ${bendX} V ${y2} H ${entryX}`
                    : // 后继早于前级结束（重叠/倒挂）：引出后用斜线绕到目标左侧再向右进入
                      `M ${x1} ${y1} H ${stub} L ${bendX} ${y2} H ${entryX}`;

                return (
                  <path
                    key={dep.id}
                    d={d}
                    fill="none"
                    stroke="#38bdf8"
                    strokeOpacity="0.55"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    markerEnd="url(#pis-arrow)"
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-faint">暂无任务，请先新增工作项。</p>
      ) : (
        <p className="border-t border-line-soft px-4 py-2 text-[11px] text-faint">
          时间轴起点 {rangeStart} · 共 {days.length} 天
        </p>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-5 rounded-sm border ${className}`} />
      {label}
    </span>
  );
}
