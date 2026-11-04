"use client";

import { useState } from "react";
import { WeekdayPicker } from "@/components/ui/WeekdayPicker";
import { addDays, formatWithWeekday, todayStr } from "@/lib/date";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/domain/types";
import type { ProjectView } from "@/lib/view/types";
import type { UpdateProjectInput } from "@/server/types";

interface SettingsPanelProps {
  project: ProjectView;
  holidays: string[];
  busy: boolean;
  onSubmit: (input: Omit<UpdateProjectInput, "projectId">) => void;
  onDeleteProject: () => void;
}

export function SettingsPanel({
  project,
  holidays,
  busy,
  onSubmit,
  onDeleteProject,
}: SettingsPanelProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [kickoffDate, setKickoffDate] = useState(project.kickoffDate);
  const [preAcceptDate, setPreAcceptDate] = useState(project.preAcceptDate);
  const [workweekMask, setWorkweekMask] = useState(project.workweekMask);
  const [maxLeafDays, setMaxLeafDays] = useState(project.maxLeafDays);
  const [holidayList, setHolidayList] = useState<string[]>(holidays);
  const [draftHoliday, setDraftHoliday] = useState(addDays(todayStr(), 0));

  function addHoliday() {
    if (!draftHoliday) return;
    setHolidayList((current) =>
      current.includes(draftHoliday) ? current : [...current, draftHoliday].sort(),
    );
  }

  function submit() {
    onSubmit({
      name,
      description,
      status,
      kickoffDate,
      preAcceptDate,
      workweekMask,
      maxLeafDays: Number(maxLeafDays) || 3,
      holidays: holidayList,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="pis-card p-4 lg:col-span-2">
        <h2 className="text-sm font-semibold tracking-wide">项目设置</h2>
        <p className="mt-0.5 text-xs text-faint">
          调整开工会 / 初验点或工作日历后，甘特图将自动重算并重新识别初验点是否受冲击。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="pis-label">项目名称</span>
            <input className="pis-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="pis-label">项目代号</span>
            <input className="pis-input font-mono" value={project.key} disabled />
          </label>
          <label className="block">
            <span className="pis-label">项目状态</span>
            <select
              className="pis-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {PROJECT_STATUS_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="pis-label">开工会起点</span>
            <input
              className="pis-input"
              type="date"
              value={kickoffDate}
              onChange={(e) => setKickoffDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="pis-label">初验点</span>
            <input
              className="pis-input"
              type="date"
              value={preAcceptDate}
              onChange={(e) => setPreAcceptDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="pis-label">粒度上限（工作日）</span>
            <input
              className="pis-input"
              type="number"
              min={1}
              max={30}
              value={maxLeafDays}
              onChange={(e) => setMaxLeafDays(Number(e.target.value))}
            />
            <span className="mt-1 block text-[11px] text-faint">
              超过该工期的叶子任务会触发「建议遵循」的粒度提示。
            </span>
          </label>
          <div className="block">
            <span className="pis-label">工作日</span>
            <WeekdayPicker value={workweekMask} onChange={setWorkweekMask} />
          </div>
          <label className="block sm:col-span-2">
            <span className="pis-label">项目描述</span>
            <textarea
              className="pis-input min-h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="pis-btn pis-btn-primary"
            disabled={busy || !name.trim()}
            onClick={submit}
          >
            {busy ? "保存中…" : "保存设置"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="pis-card p-4">
          <h3 className="text-sm font-semibold tracking-wide">节假日</h3>
          <p className="mt-0.5 text-xs text-faint">节假日不计入工期，也不作为排期起点。</p>
          <div className="mt-3 space-y-1">
            {holidayList.length === 0 ? (
              <p className="text-[11px] text-faint">暂无节假日。</p>
            ) : (
              holidayList.map((date) => (
                <div
                  key={date}
                  className="flex items-center justify-between rounded-md border border-line bg-elevated/40 px-2 py-1 text-xs"
                >
                  <span className="font-mono text-muted">{formatWithWeekday(date)}</span>
                  <button
                    type="button"
                    className="text-faint transition hover:text-danger"
                    onClick={() => setHolidayList((current) => current.filter((d) => d !== date))}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              className="pis-input"
              type="date"
              value={draftHoliday}
              onChange={(e) => setDraftHoliday(e.target.value)}
            />
            <button type="button" className="pis-btn shrink-0" onClick={addHoliday}>
              添加
            </button>
          </div>
        </div>

        <div className="pis-card border-danger/30 p-4">
          <h3 className="text-sm font-semibold tracking-wide text-danger">危险操作</h3>
          <p className="mt-0.5 text-xs text-faint">
            删除项目将移除全部任务、依赖与审计记录，且不可恢复。
          </p>
          <button
            type="button"
            className="pis-btn pis-btn-danger mt-3 w-full"
            disabled={busy}
            onClick={onDeleteProject}
          >
            删除该项目
          </button>
        </div>
      </div>
    </div>
  );
}
