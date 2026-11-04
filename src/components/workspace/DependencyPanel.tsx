"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/primitives";
import type { DependencyView, TaskView } from "@/lib/view/types";

interface DependencyPanelProps {
  tasks: TaskView[];
  dependencies: DependencyView[];
  busy: boolean;
  onAdd: (predId: string, succId: string, lagDays: number) => void;
  onUpdate: (dependencyId: string, lagDays: number) => void;
  onRemove: (dependencyId: string) => void;
  onClose: () => void;
}

export function DependencyPanel({
  tasks,
  dependencies,
  busy,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: DependencyPanelProps) {
  // 前置任务可以是汇总节点（表示依赖其下全部工作完成）；后续任务不能是汇总节点
  const predOptions = tasks.filter((task) => !task.isPreAccept);
  const succOptions = tasks.filter((task) => task.taskType !== "SUMMARY" && !task.isPreAccept);
  const [predId, setPredId] = useState(predOptions[0]?.id ?? "");
  const [succId, setSuccId] = useState(succOptions[0]?.id ?? "");
  const [lagDays, setLagDays] = useState(0);

  const labelOf = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    return task ? `${task.wbsCode} ${task.name}` : id;
  };

  return (
    <Modal
      open
      title="依赖关系"
      desc="v1 仅启用「完成 → 开始（FS）」；汇总节点只能作为前置任务，表示依赖其下全部工作完成。"
      onClose={onClose}
      widthClass="max-w-4xl"
      footer={
        <button type="button" className="pis-btn" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h4 className="text-xs font-semibold text-muted">新增依赖</h4>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className="pis-label">前置任务</span>
              <select
                className="pis-input"
                value={predId}
                onChange={(event) => setPredId(event.target.value)}
              >
                {predOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.wbsCode} {task.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="pis-label">后续任务</span>
              <select
                className="pis-input"
                value={succId}
                onChange={(event) => setSuccId(event.target.value)}
              >
                {succOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.wbsCode} {task.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="pis-label">滞后量（工作日，可为负）</span>
              <input
                className="pis-input"
                type="number"
                value={lagDays}
                onChange={(event) => setLagDays(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="pis-btn pis-btn-primary w-full"
              disabled={busy || !predId || !succId || predId === succId}
              onClick={() => onAdd(predId, succId, Number(lagDays) || 0)}
            >
              添加依赖
            </button>
          </div>
        </div>

        <div className="lg:col-span-3">
          <h4 className="text-xs font-semibold text-muted">已有依赖（{dependencies.length}）</h4>
          <div className="mt-2 max-h-[420px] space-y-1 overflow-auto">
            {dependencies.length === 0 ? (
              <EmptyState title="暂无依赖关系" desc="为任务选择前级依赖后，排期引擎会自动推算起止时间。" />
            ) : (
              dependencies.map((dep) => (
                <div
                  key={dep.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevated/40 px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{labelOf(dep.predId)}</span>
                    <span className="mx-1.5 text-faint">→</span>
                    <span className="text-fg/90">{labelOf(dep.succId)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <input
                      className="w-14 rounded border border-line bg-panel px-1 py-0.5 text-center text-[11px] text-fg outline-none focus:border-accent/70"
                      type="number"
                      defaultValue={dep.lagDays}
                      disabled={busy}
                      onBlur={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next) && next !== dep.lagDays) onUpdate(dep.id, next);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <span className="text-[10px] text-faint">天</span>
                    <button
                      type="button"
                      className="pis-btn pis-btn-ghost px-1.5 py-0.5 text-[11px] hover:text-danger"
                      disabled={busy}
                      onClick={() => onRemove(dep.id)}
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
