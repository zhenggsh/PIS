"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/primitives";
import { DependencyPanel } from "./DependencyPanel";
import { GanttChart } from "./GanttChart";
import { IssueList, ResultPanel } from "./ResultPanel";
import { SettingsPanel } from "./SettingsPanel";
import { TaskDialog, type TaskFormSubmit } from "./TaskDialog";
import { TaskTable } from "./TaskTable";
import { formatWithWeekday } from "@/lib/date";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/domain/types";
import type { ValidationIssue } from "@/lib/validation";
import type { TaskView, WorkspaceData } from "@/lib/view/types";
import type {
  ActionResult,
  CreateTaskInput,
  MoveDirection,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@/server/types";
import {
  addDependencyAction,
  removeDependencyAction,
  setTaskPredecessorsAction,
  updateDependencyAction,
} from "@/server/actions/dependency";
import {
  createTaskAction,
  deleteTaskAction,
  moveTaskAction,
  setTaskProgressAction,
  updateTaskAction,
} from "@/server/actions/task";
import { deleteProjectAction, updateProjectAction } from "@/server/actions/project";

type Tab = "gantt" | "table" | "settings";
type ActionFactory = (acked: string[]) => Promise<ActionResult>;
type DialogState = { mode: "create" } | { mode: "edit"; task: TaskView } | null;

interface PendingConfirm {
  issues: ValidationIssue[];
  retry: ActionFactory;
  onSuccess?: (res: ActionResult) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "gantt", label: "甘特图" },
  { key: "table", label: "任务表" },
  { key: "settings", label: "项目设置" },
];

export function Workspace({ data }: { data: WorkspaceData }) {
  const { project, tasks, dependencies, holidays, summary } = data;
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("gantt");
  const [result, setResult] = useState<ActionResult | null>(null);
  // 进展摘要被关闭后暂存，供「项目信息」区的按钮重新显示（需求 11）
  const [dismissedResult, setDismissedResult] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [depOpen, setDepOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // 新建同级任务后，让表格自动进入该行「项目描述」编辑态（需求 8）
  const [autoEditTaskId, setAutoEditTaskId] = useState<string | null>(null);
  // 因本次计划调整（依赖 / 时长 / 新增任务）时间发生变化的其它任务，用于高亮关键列
  const [highlightTaskIds, setHighlightTaskIds] = useState<string[]>([]);
  const [removingTask, setRemovingTask] = useState<TaskView | null>(null);
  const [removingProject, setRemovingProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  const working = busy || isPending;

  const execute = useCallback(
    (factory: ActionFactory, onSuccess?: (res: ActionResult) => void) => {
      setBusy(true);
      startTransition(async () => {
        let res: ActionResult;
        try {
          res = await factory([]);
        } catch (error) {
          res = { ok: false, message: error instanceof Error ? error.message : "操作失败" };
        }
        if (!res.ok && res.needsConfirmation && (res.issues?.length ?? 0) > 0) {
          setConfirm({ issues: res.issues ?? [], retry: factory, onSuccess });
          setResult(res);
          setDismissedResult(null);
          setBusy(false);
          return;
        }
        setResult(res);
        setDismissedResult(null);
        setBusy(false);
        if (res.ok) onSuccess?.(res);
      });
    },
    [],
  );

  /**
   * 计划调整的连带影响（需求 2）：把本次变更中「时间发生变化的任务」记录下来用于高亮，
   * 直接操作的任务本身（编辑的任务 / 新建的任务）不计入高亮。
   */
  const applyImpactHighlight = useCallback((res: ActionResult, excludeIds: string[] = []) => {
    const ids = (res.impact?.changedTasks ?? [])
      .map((item) => item.taskId)
      .filter((id) => !excludeIds.includes(id));
    setHighlightTaskIds(ids);
  }, []);

  function approveConfirm() {
    const current = confirm;
    if (!current) return;
    setConfirm(null);
    const codes = [...new Set(current.issues.map((issue) => issue.code))];
    const retry = current.retry;
    const onSuccess = current.onSuccess;
    execute(() => retry(codes), onSuccess);
  }

  // ============ 任务 ============
  function handleTaskSubmit(payload: TaskFormSubmit) {
    if (payload.mode === "create") {
      const fields = payload.fields as Omit<CreateTaskInput, "projectId">;
      execute(
        (acked) =>
          createTaskAction({
            projectId: project.id,
            ...fields,
            predecessorIds: payload.predecessorIds,
            lagDays: payload.lagDays,
            acknowledgedIssueCodes: acked,
          }),
        (res) => {
          setDialog(null);
          applyImpactHighlight(res, res.taskId ? [res.taskId] : []);
        },
      );
      return;
    }
    const taskId = payload.taskId;
    if (!taskId) return;
    const fields = payload.fields as Omit<UpdateTaskInput, "projectId" | "taskId">;
    execute(
      async (acked) => {
        const first = await updateTaskAction({
          projectId: project.id,
          taskId,
          ...fields,
          acknowledgedIssueCodes: acked,
        });
        if (!first.ok) return first;
        const second = await setTaskPredecessorsAction({
          projectId: project.id,
          taskId,
          predecessorIds: payload.predecessorIds,
          lagDays: payload.lagDays,
          acknowledgedIssueCodes: acked,
        });
        return second.ok ? second : { ...second, ok: false };
      },
      () => setDialog(null),
    );
  }

  function handleMove(task: TaskView, direction: MoveDirection) {
    execute((acked) =>
      moveTaskAction({ projectId: project.id, taskId: task.id, direction, acknowledgedIssueCodes: acked }),
    );
  }

  function handleQuickProgress(task: TaskView, pct: number) {
    execute((acked) =>
      setTaskProgressAction({
        projectId: project.id,
        taskId: task.id,
        progressPct: pct,
        acknowledgedIssueCodes: acked,
      }),
    );
  }

  /** 表格行内改「项目描述」（需求 1） */
  function handleRename(task: TaskView, name: string) {
    execute((acked) =>
      updateTaskAction({ projectId: project.id, taskId: task.id, name, acknowledgedIssueCodes: acked }),
    );
  }

  /** 行内名称输入后按回车：先保存名称，再在下方插入同级任务。 */
  function handleRenameAndInsertSibling(task: TaskView, name: string) {
    execute(
      async (acked) => {
        const first = await updateTaskAction({
          projectId: project.id,
          taskId: task.id,
          name,
          acknowledgedIssueCodes: acked,
        });
        if (!first.ok) return first;
        return createTaskAction({
          projectId: project.id,
          name: "新任务",
          taskType: "TASK",
          durationDays: 1,
          insertAfterTaskId: task.id,
          acknowledgedIssueCodes: acked,
        });
      },
      (res) => {
        setTab("table");
        if (res.taskId) setAutoEditTaskId(res.taskId);
        applyImpactHighlight(res, res.taskId ? [res.taskId] : []);
      },
    );
  }

  /** 表格行内改「时长」（需求 3） */
  function handleChangeDuration(task: TaskView, days: number) {
    execute(
      (acked) =>
        updateTaskAction({
          projectId: project.id,
          taskId: task.id,
          durationDays: days,
          acknowledgedIssueCodes: acked,
        }),
      (res) => applyImpactHighlight(res, [task.id]),
    );
  }

  /** 表格行内改「资源」（需求 4） */
  function handleChangeAssignee(task: TaskView, assignee: string) {
    execute((acked) =>
      updateTaskAction({
        projectId: project.id,
        taskId: task.id,
        assignee,
        acknowledgedIssueCodes: acked,
      }),
    );
  }

  /** 表格行内改「前级依赖」（需求 5，整体替换；循环依赖由服务端 V2 兜底阻断） */
  function handleChangePredecessors(task: TaskView, predecessorIds: string[]) {
    execute(
      (acked) =>
        setTaskPredecessorsAction({
          projectId: project.id,
          taskId: task.id,
          predecessorIds,
          acknowledgedIssueCodes: acked,
        }),
      (res) => applyImpactHighlight(res, [task.id]),
    );
  }

  /** 在指定任务下方插入同级任务（需求 8）：自动生成序号，并立即进入项目描述编辑态 */
  function handleInsertSibling(task: TaskView) {
    execute(
      (acked) =>
        createTaskAction({
          projectId: project.id,
          name: "新任务",
          taskType: "TASK",
          durationDays: 1,
          insertAfterTaskId: task.id,
          acknowledgedIssueCodes: acked,
        }),
      (res) => {
        setTab("table");
        if (res.taskId) setAutoEditTaskId(res.taskId);
        applyImpactHighlight(res, res.taskId ? [res.taskId] : []);
      },
    );
  }

  function confirmRemoveTask() {
    const task = removingTask;
    if (!task) return;
    setRemovingTask(null);
    execute(
      (acked) =>
        deleteTaskAction({ projectId: project.id, taskId: task.id, acknowledgedIssueCodes: acked }),
      () => setSelectedTaskId(null),
    );
  }

  // ============ 依赖 ============
  function handleAddDependency(predId: string, succId: string, lagDays: number) {
    execute((acked) =>
      addDependencyAction({ projectId: project.id, predId, succId, lagDays, acknowledgedIssueCodes: acked }),
    );
  }

  function handleUpdateDependency(dependencyId: string, lagDays: number) {
    execute((acked) =>
      updateDependencyAction({ projectId: project.id, dependencyId, lagDays, acknowledgedIssueCodes: acked }),
    );
  }

  function handleRemoveDependency(dependencyId: string) {
    execute((acked) =>
      removeDependencyAction({ projectId: project.id, dependencyId, acknowledgedIssueCodes: acked }),
    );
  }

  // ============ 项目 ============
  function handleProjectSubmit(input: Omit<UpdateProjectInput, "projectId">) {
    execute((acked) =>
      updateProjectAction({ projectId: project.id, ...input, acknowledgedIssueCodes: acked }),
    );
  }

  function confirmRemoveProject() {
    setRemovingProject(false);
    execute(async () => {
      const res = await deleteProjectAction(project.id);
      if (res.ok) router.push("/");
      return res;
    });
  }

  const slackTone = summary.slackDays < 0 ? "danger" : summary.slackDays === 0 ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-4">
      {/* ===== 项目头 ===== */}
      <div className="pis-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-wide">{project.name}</h1>
              <Badge tone="neutral">{project.key}</Badge>
              <Badge tone={project.status === "ACTIVE" ? "ok" : "accent"}>
                {PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status}
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-muted">
              {project.description || "（暂无项目描述）"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!result && dismissedResult ? (
              <button
                type="button"
                className="pis-btn"
                onClick={() => {
                  setResult(dismissedResult);
                  setDismissedResult(null);
                }}
              >
                重新显示进展摘要
              </button>
            ) : null}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line-soft pt-3 text-[11px] sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="开工会起点" value={formatWithWeekday(project.kickoffDate)} />
          <Stat label="初验点（目标）" value={formatWithWeekday(project.preAcceptDate)} />
          <Stat label="预计完工" value={summary.projectFinish ?? "—"} />
          <div>
            <dt className="text-faint">初验点余量</dt>
            <dd className="mt-0.5">
              <Badge tone={slackTone}>{summary.slackDays} 个工作日</Badge>
            </dd>
          </div>
          <Stat label="关键路径任务" value={`${summary.criticalTaskIds.length} 项`} />
        </dl>

        {summary.warningMessages.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[11px] text-warn">
            {summary.warningMessages.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {result ? (
        <ResultPanel
          result={result}
          onDismiss={() => {
            setDismissedResult(result);
            setResult(null);
          }}
        />
      ) : null}

      {/* ===== Tabs ===== */}
      <div className="flex items-center gap-1 border-b border-line">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
              tab === item.key
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {item.label}
          </button>
        ))}
        {working ? <span className="ml-2 text-[11px] text-faint">处理中…</span> : null}
      </div>

      {tab === "gantt" ? (
        <GanttChart
          project={project}
          tasks={tasks}
          dependencies={dependencies}
          summary={summary}
          holidays={holidays}
          selectedTaskId={selectedTaskId}
          onSelectTask={(task) => {
            setSelectedTaskId(task.id);
            setDialog({ mode: "edit", task });
          }}
        />
      ) : null}

      {tab === "table" ? (
        <TaskTable
          tasks={tasks}
          dependencies={dependencies}
          exportName={project.key || project.name}
          selectedTaskId={selectedTaskId}
          autoEditTaskId={autoEditTaskId}
          highlightTaskIds={highlightTaskIds}
          onClearHighlight={() => setHighlightTaskIds([])}
          busy={working}
          onAutoEditConsumed={() => setAutoEditTaskId(null)}
          onEdit={(task) => setDialog({ mode: "edit", task })}
          onShowDetail={(task) => setSelectedTaskId(task.id)}
          onMove={handleMove}
          onDelete={(task) => setRemovingTask(task)}
          onProgress={handleQuickProgress}
          onRename={handleRename}
          onRenameAndInsertSibling={handleRenameAndInsertSibling}
          onChangeDuration={handleChangeDuration}
          onChangeAssignee={handleChangeAssignee}
          onChangePredecessors={handleChangePredecessors}
          onInsertSibling={handleInsertSibling}
          onAddTask={() => setDialog({ mode: "create" })}
          onOpenDependencies={() => setDepOpen(true)}
        />
      ) : null}

      {tab === "settings" ? (
        <SettingsPanel
          project={project}
          holidays={holidays}
          busy={working}
          onSubmit={handleProjectSubmit}
          onDeleteProject={() => setRemovingProject(true)}
        />
      ) : null}

      {dialog ? (
        <TaskDialog
          mode={dialog.mode}
          task={dialog.mode === "edit" ? dialog.task : null}
          project={project}
          tasks={tasks}
          busy={working}
          onClose={() => setDialog(null)}
          onSubmit={handleTaskSubmit}
        />
      ) : null}

      {depOpen ? (
        <DependencyPanel
          tasks={tasks}
          dependencies={dependencies}
          busy={working}
          onAdd={handleAddDependency}
          onUpdate={handleUpdateDependency}
          onRemove={handleRemoveDependency}
          onClose={() => setDepOpen(false)}
        />
      ) : null}

      {confirm ? (
        <Modal
          open
          title="建议遵循的规则项"
          desc="以下为「建议遵循」的规则，确认后可以继续保存；该决定会记入审计。"
          onClose={() => setConfirm(null)}
          widthClass="max-w-xl"
          footer={
            <>
              <button type="button" className="pis-btn" onClick={() => setConfirm(null)}>
                返回修改
              </button>
              <button type="button" className="pis-btn pis-btn-primary" onClick={approveConfirm}>
                确认并继续
              </button>
            </>
          }
        >
          <IssueList issues={confirm.issues} />
        </Modal>
      ) : null}

      {removingTask ? (
        <Modal
          open
          title="删除任务"
          onClose={() => setRemovingTask(null)}
          footer={
            <>
              <button type="button" className="pis-btn" onClick={() => setRemovingTask(null)}>
                取消
              </button>
              <button
                type="button"
                className="pis-btn pis-btn-danger"
                disabled={working}
                onClick={confirmRemoveTask}
              >
                确认删除
              </button>
            </>
          }
        >
          <p className="text-sm text-muted">
            将删除「{removingTask.wbsCode} {removingTask.name}」
            {removingTask.hasChildren ? "及其全部子任务" : ""}，相关依赖边一并移除。
          </p>
        </Modal>
      ) : null}

      {removingProject ? (
        <Modal
          open
          title="删除项目"
          onClose={() => setRemovingProject(false)}
          footer={
            <>
              <button type="button" className="pis-btn" onClick={() => setRemovingProject(false)}>
                取消
              </button>
              <button
                type="button"
                className="pis-btn pis-btn-danger"
                disabled={working}
                onClick={confirmRemoveProject}
              >
                确认删除
              </button>
            </>
          }
        >
          <p className="text-sm text-muted">
            将删除项目「{project.name}」及其全部任务、依赖与审计记录，且不可恢复。
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-muted">{value}</dd>
    </div>
  );
}
