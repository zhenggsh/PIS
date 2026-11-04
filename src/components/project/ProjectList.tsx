"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { WeekdayPicker } from "@/components/ui/WeekdayPicker";
import { addDays, formatWithWeekday, todayStr } from "@/lib/date";
import { DEFAULT_WORKWEEK_MASK, PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/domain/types";
import { createProjectAction, deleteProjectAction } from "@/server/actions/project";

export interface ProjectListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  kickoffDate: string;
  preAcceptDate: string;
  taskCount: number;
  updatedAt: string;
}

const STATUS_TONE: Record<string, "accent" | "ok" | "warn" | "neutral"> = {
  PLANNING: "accent",
  ACTIVE: "ok",
  ON_HOLD: "warn",
  CLOSED: "neutral",
};

export function ProjectList({ projects }: { projects: ProjectListItem[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [removing, setRemoving] = useState<ProjectListItem | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const defaults = useMemo(
    () => ({ kickoffDate: todayStr(), preAcceptDate: addDays(todayStr(), 30) }),
    [],
  );

  const [form, setForm] = useState({
    name: "",
    key: "",
    description: "",
    kickoffDate: defaults.kickoffDate,
    preAcceptDate: defaults.preAcceptDate,
    workweekMask: DEFAULT_WORKWEEK_MASK,
    maxLeafDays: 3,
  });

  function openCreate() {
    setForm({
      name: "",
      key: "",
      description: "",
      kickoffDate: defaults.kickoffDate,
      preAcceptDate: defaults.preAcceptDate,
      workweekMask: DEFAULT_WORKWEEK_MASK,
      maxLeafDays: 3,
    });
    setMessage(null);
    setCreateOpen(true);
  }

  async function submitCreate() {
    setBusy(true);
    const result = await createProjectAction({
      name: form.name,
      key: form.key,
      description: form.description,
      kickoffDate: form.kickoffDate,
      preAcceptDate: form.preAcceptDate,
      workweekMask: form.workweekMask,
      maxLeafDays: Number(form.maxLeafDays) || 3,
    });
    setBusy(false);
    if (result.ok) {
      setCreateOpen(false);
      setMessage({ tone: "ok", text: result.message ?? "项目已创建" });
    } else {
      setMessage({ tone: "error", text: result.message ?? "创建失败" });
    }
  }

  async function confirmDelete() {
    if (!removing) return;
    setBusy(true);
    const result = await deleteProjectAction(removing.id);
    setBusy(false);
    setRemoving(null);
    setMessage(
      result.ok
        ? { tone: "ok", text: result.message ?? "项目已删除" }
        : { tone: "error", text: result.message ?? "删除失败" },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">项目列表</h1>
          <p className="mt-0.5 text-xs text-faint">
            以开工会为起点、初验点为目标锚点，通过 WBS 分解与依赖排期驱动甘特图。
          </p>
        </div>
        <button type="button" className="pis-btn pis-btn-primary" onClick={openCreate}>
          + 新建项目
        </button>
      </div>

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            message.tone === "ok"
              ? "border-ok/40 bg-ok/10 text-ok"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div className="pis-card">
          <EmptyState
            title="还没有项目"
            desc="创建项目后，系统会自动生成「开工会」与「初验点」两个锚点里程碑，再逐步分解工作项。"
            action={
              <button type="button" className="pis-btn pis-btn-primary" onClick={openCreate}>
                新建第一个项目
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <div key={project.id} className="pis-card flex flex-col p-4 transition hover:border-accent/40">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/projects/${project.id}`} className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-fg hover:text-accent">
                    {project.name}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11px] text-faint">{project.key}</p>
                </Link>
                <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>
                  {PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status}
                </Badge>
              </div>

              <p className="mt-2 line-clamp-2 min-h-8 text-xs text-muted">
                {project.description || "（暂无描述）"}
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[11px] text-faint">
                <div>
                  <dt className="text-faint/80">开工会</dt>
                  <dd className="font-mono text-muted">{formatWithWeekday(project.kickoffDate)}</dd>
                </div>
                <div>
                  <dt className="text-faint/80">初验点</dt>
                  <dd className="font-mono text-muted">{formatWithWeekday(project.preAcceptDate)}</dd>
                </div>
                <div>
                  <dt className="text-faint/80">任务数</dt>
                  <dd className="font-mono text-muted">{project.taskCount}</dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3">
                <Link href={`/projects/${project.id}`} className="pis-btn pis-btn-ghost px-2 py-1 text-xs">
                  打开工作区 →
                </Link>
                <button
                  type="button"
                  className="pis-btn pis-btn-ghost px-2 py-1 text-xs hover:text-danger"
                  onClick={() => setRemoving(project)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        title="新建项目"
        desc="开工会为起始锚点，初验点为目标锚点，二者构成计划的起止边界。"
        onClose={() => setCreateOpen(false)}
        widthClass="max-w-2xl"
        footer={
          <>
            <button type="button" className="pis-btn" onClick={() => setCreateOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="pis-btn pis-btn-primary"
              disabled={busy || !form.name.trim()}
              onClick={submitCreate}
            >
              {busy ? "创建中…" : "创建项目"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="pis-label">项目名称 *</span>
            <input
              className="pis-input"
              value={form.name}
              placeholder="例如：智能巡检系统建设"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="pis-label">项目代号（留空自动生成）</span>
            <input
              className="pis-input font-mono"
              value={form.key}
              placeholder="PIS-2026"
              onChange={(event) => setForm({ ...form, key: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="pis-label">粒度上限（工作日）</span>
            <input
              className="pis-input"
              type="number"
              min={1}
              max={30}
              value={form.maxLeafDays}
              onChange={(event) => setForm({ ...form, maxLeafDays: Number(event.target.value) })}
            />
          </label>
          <label className="block">
            <span className="pis-label">开工会起点 *</span>
            <input
              className="pis-input"
              type="date"
              value={form.kickoffDate}
              onChange={(event) => setForm({ ...form, kickoffDate: event.target.value })}
            />
          </label>
          <label className="block">
            <span className="pis-label">初验点 *</span>
            <input
              className="pis-input"
              type="date"
              value={form.preAcceptDate}
              onChange={(event) => setForm({ ...form, preAcceptDate: event.target.value })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="pis-label">项目描述</span>
            <textarea
              className="pis-input min-h-20"
              value={form.description}
              placeholder="目标、范围、验收标准…"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <div className="sm:col-span-2">
            <span className="pis-label">工作日</span>
            <WeekdayPicker
              value={form.workweekMask}
              onChange={(mask) => setForm({ ...form, workweekMask: mask })}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(removing)}
        title="删除项目"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <button type="button" className="pis-btn" onClick={() => setRemoving(null)}>
              取消
            </button>
            <button
              type="button"
              className="pis-btn pis-btn-danger"
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? "删除中…" : "确认删除"}
            </button>
          </>
        }
      >
        <p className="text-sm text-muted">
          将删除项目「{removing?.name}」及其全部任务、依赖与审计记录，且不可恢复。
        </p>
      </Modal>
    </div>
  );
}
