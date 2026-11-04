"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  type ConstraintType,
  type TaskStatus,
  type TaskType,
} from "@/lib/domain/types";
import type { ProjectView, TaskView } from "@/lib/view/types";
import type { CreateTaskInput, UpdateTaskInput } from "@/server/types";

export interface TaskFormSubmit {
  mode: "create" | "edit";
  taskId?: string;
  fields: Omit<CreateTaskInput, "projectId"> | Omit<UpdateTaskInput, "projectId" | "taskId">;
  predecessorIds: string[];
  lagDays: number;
}

interface TaskDialogProps {
  mode: "create" | "edit";
  task?: TaskView | null;
  project: ProjectView;
  tasks: TaskView[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: TaskFormSubmit) => void;
}

export function TaskDialog({
  mode,
  task,
  project,
  tasks,
  busy,
  onClose,
  onSubmit,
}: TaskDialogProps) {
  const [name, setName] = useState(task?.name ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [taskType, setTaskType] = useState<TaskType>(task?.taskType ?? "TASK");
  const [durationDays, setDurationDays] = useState(task?.durationDays ?? 3);
  const [assignee, setAssignee] = useState(task?.assignee ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "NOT_STARTED");
  const [progressPct, setProgressPct] = useState(task?.progressPct ?? 0);
  const [progressNote, setProgressNote] = useState(task?.progressNote ?? "");
  const [constraintType, setConstraintType] = useState<ConstraintType>(
    task?.constraintType ?? "ASAP",
  );
  const [constraintDate, setConstraintDate] = useState(
    task?.constraintDate ?? task?.plannedStart ?? project.kickoffDate,
  );
  const [predecessorIds, setPredecessorIds] = useState<string[]>(task?.predecessorIds ?? []);
  const [lagDays, setLagDays] = useState(0);
  // 规则 V4（建议遵循）：已开工任务不允许直接改起止时间；此处提供「强制指定」入口，
  // 落地方式为转成「不早于（MSO）」约束，并需在确认框中人工确认后生效。
  const [forceStart, setForceStart] = useState(false);
  const [forcedStartDate, setForcedStartDate] = useState(
    task?.plannedStart ?? project.kickoffDate,
  );

  const candidates = tasks.filter(
    (item) =>
      item.id !== task?.id &&
      item.taskType !== "SUMMARY" &&
      !item.isPreAccept &&
      !(task && item.id === task.id),
  );

  const isMilestone = taskType === "MILESTONE";

  function submit() {
    const shared = {
      name: name.trim(),
      description: description.trim() || null,
      taskType,
      durationDays: isMilestone ? 0 : Math.max(1, Math.round(durationDays)),
      assignee: assignee.trim() || null,
      constraintType,
      constraintDate: constraintType === "MSO" ? constraintDate : null,
    };
    if (mode === "create") {
      onSubmit({
        mode,
        fields: shared,
        predecessorIds,
        lagDays,
      });
      return;
    }
    onSubmit({
      mode,
      taskId: task?.id,
      fields: {
        ...shared,
        status,
        progressPct: Math.max(0, Math.min(100, Math.round(progressPct))),
        progressNote: progressNote.trim() || null,
        forcedStartDate: forceStart ? forcedStartDate : null,
      },
      predecessorIds,
      lagDays,
    });
  }

  function toggleForceStart() {
    if (forceStart) {
      setForceStart(false);
      return;
    }
    // 与「排期方式」保持一致：强制指定即等价于一条「不早于」约束。
    setForcedStartDate(constraintType === "MSO" ? constraintDate : forcedStartDate);
    setConstraintType("MSO");
    setConstraintDate(constraintType === "MSO" ? constraintDate : forcedStartDate);
    setForceStart(true);
  }

  function togglePredecessor(id: string) {
    setPredecessorIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <Modal
      open
      title={mode === "create" ? "新增工作项" : `编辑：${task?.wbsCode} ${task?.name ?? ""}`}
      desc="起始 / 终止时间由排期引擎按「前级依赖 + 工期」自动推算，不接受直接编辑。"
      onClose={onClose}
      widthClass="max-w-3xl"
      footer={
        <>
          <button type="button" className="pis-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="pis-btn pis-btn-primary"
            disabled={busy || !name.trim()}
            onClick={submit}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="pis-label">项目描述（任务名称）*</span>
          <input
            className="pis-input"
            value={name}
            placeholder="例如：需求调研与确认"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="pis-label">类型</span>
          <select
            className="pis-input"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value as TaskType)}
          >
            {TASK_TYPES.map((type) => (
              <option key={type} value={type}>
                {TASK_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="pis-label">时长（工作日）</span>
          <input
            className="pis-input"
            type="number"
            min={1}
            max={200}
            value={isMilestone ? 0 : durationDays}
            disabled={isMilestone}
            onChange={(event) => setDurationDays(Number(event.target.value))}
          />
        </label>

        <label className="block">
          <span className="pis-label">资源</span>
          <input
            className="pis-input"
            value={assignee}
            placeholder="人员 / 团队（自由文本）"
            onChange={(event) => setAssignee(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="pis-label">排期方式</span>
          <select
            className="pis-input"
            value={constraintType}
            onChange={(event) => setConstraintType(event.target.value as ConstraintType)}
          >
            <option value="ASAP">由依赖 / 开工日推算（尽快开始）</option>
            <option value="MSO">固定起始日（不早于）</option>
          </select>
        </label>

        {constraintType === "MSO" ? (
          <label className="block sm:col-span-2">
            <span className="pis-label">不早于日期</span>
            <input
              className="pis-input"
              type="date"
              value={constraintDate}
              onChange={(event) => setConstraintDate(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-faint">
              该任务不会早于此日期开始；若前级依赖更晚，则以依赖为准。
            </span>
          </label>
        ) : null}

        {mode === "edit" ? (
          <div className="rounded-lg border border-line-soft bg-elevated/40 px-3 py-2 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-muted">起止时间由「前级依赖 + 时长」推算</div>
                <div className="text-[11px] text-faint">
                  规则 V4（建议遵循）：已开工任务不能直接改起始时间，可改为调整时长 / 依赖。
                </div>
              </div>
              <button type="button" className="pis-btn shrink-0" onClick={toggleForceStart}>
                {forceStart ? "取消强制指定" : "我要强制指定日期"}
              </button>
            </div>
            {forceStart ? (
              <label className="mt-2 block">
                <span className="pis-label">强制起始日（将转为「不早于」约束，需确认）</span>
                <input
                  className="pis-input"
                  type="date"
                  value={forcedStartDate}
                  onChange={(event) => {
                    setForcedStartDate(event.target.value);
                    setConstraintDate(event.target.value);
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <label className="block sm:col-span-2">
          <span className="pis-label">详细说明</span>
          <textarea
            className="pis-input min-h-16"
            value={description}
            placeholder="交付物、验收标准、注意事项…"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        {mode === "edit" ? (
          <>
            <label className="block">
              <span className="pis-label">状态</span>
              <select
                className="pis-input"
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                {TASK_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {TASK_STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="pis-label">进度（%）</span>
              <input
                className="pis-input"
                type="number"
                min={0}
                max={100}
                value={progressPct}
                onChange={(event) => setProgressPct(Number(event.target.value))}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="pis-label">进展描述</span>
              <textarea
                className="pis-input min-h-16"
                value={progressNote}
                placeholder="当前进展、风险、阻塞点…"
                onChange={(event) => setProgressNote(event.target.value)}
              />
            </label>
          </>
        ) : null}

        <div className="sm:col-span-2">
          <span className="pis-label">
            前级依赖（除开工会 / 初验点外，任务必须有前级依赖；勾选多个表示需全部完成）
          </span>
          <div className="max-h-44 overflow-auto rounded-lg border border-line bg-elevated/40 p-2">
            {candidates.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-faint">暂无可选前级任务。</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {candidates.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-muted hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      className="accent-[#38bdf8]"
                      checked={predecessorIds.includes(item.id)}
                      onChange={() => togglePredecessor(item.id)}
                    />
                    <span className="font-mono text-[11px] text-faint">{item.wbsCode}</span>
                    <span className="truncate">
                      {item.name}
                      {item.isKickoff ? "（开工会）" : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-faint">
            滞后量（工作日，可为负）
            <input
              className="pis-input w-24 py-1"
              type="number"
              value={lagDays}
              onChange={(event) => setLagDays(Number(event.target.value))}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
