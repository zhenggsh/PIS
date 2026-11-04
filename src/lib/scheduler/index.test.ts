import { describe, expect, it } from "vitest";
import { computeSchedule, type SchedulerDependency, type SchedulerInput, type SchedulerTask } from "./index";

/**
 * 排期引擎单测（设计文档 §6）
 * 基准日历：2026-03-02 为周一，工作日为周一~周五（mask=31），无节假日。
 *   03-02 一 · 03-03 二 · 03-04 三 · 03-05 四 · 03-06 五 · 03-09 一 · 03-10 二 · 03-11 三
 */

const KICKOFF = "KICKOFF";
const PRE_ACCEPT = "PRE";

function task(partial: Partial<SchedulerTask> & { id: string }): SchedulerTask {
  return {
    parentId: null,
    wbsCode: partial.id,
    name: partial.id,
    taskType: "TASK",
    durationDays: 1,
    constraintType: "ASAP",
    constraintDate: null,
    isKickoff: false,
    isPreAccept: false,
    progressPct: 0,
    ...partial,
  };
}

const kickoff = task({ id: KICKOFF, taskType: "MILESTONE", isKickoff: true });
const preAccept = task({ id: PRE_ACCEPT, taskType: "MILESTONE", isPreAccept: true });

function dep(predId: string, succId: string, lagDays = 0): SchedulerDependency {
  return { id: `${predId}->${succId}`, predId, succId, lagDays };
}

function plan(tasks: SchedulerTask[], dependencies: SchedulerDependency[], preAcceptDate = "2026-03-31"): SchedulerInput {
  return {
    kickoffDate: "2026-03-02",
    preAcceptDate,
    workweekMask: 31,
    holidays: [],
    tasks,
    dependencies,
  };
}

describe("computeSchedule 正推（FS + lag）", () => {
  it("单链按工作日推进，且不含周末", () => {
    const result = computeSchedule(
      plan(
        [kickoff, task({ id: "A", durationDays: 2 }), task({ id: "B", durationDays: 3 }), preAccept],
        [dep(KICKOFF, "A"), dep("A", "B")],
      ),
    );

    expect(result.byId[KICKOFF].plannedStart).toBe("2026-03-02");
    expect(result.byId[KICKOFF].plannedEnd).toBe("2026-03-02");
    expect(result.byId.A.plannedStart).toBe("2026-03-03");
    expect(result.byId.A.plannedEnd).toBe("2026-03-04");
    // B：03-05 周四起，工期 3 → 03-05 / 03-06 / 03-09（跨周末）
    expect(result.byId.B.plannedStart).toBe("2026-03-05");
    expect(result.byId.B.plannedEnd).toBe("2026-03-09");
    expect(result.projectFinish).toBe("2026-03-09");
    expect(result.requiredFinish).toBe("2026-03-31");
    expect(result.slackDays).toBe(16);
  });

  it("lagDays 顺延后继任务的开始时间", () => {
    const result = computeSchedule(
      plan(
        [kickoff, task({ id: "A", durationDays: 2 }), task({ id: "B", durationDays: 3 }), preAccept],
        [dep(KICKOFF, "A"), dep("A", "B", 2)],
      ),
    );

    // A 结束 03-04 → 滞后 2 个工作日 → 03-09 开始
    expect(result.byId.B.plannedStart).toBe("2026-03-09");
    expect(result.byId.B.plannedEnd).toBe("2026-03-11");
  });

  it("菱形会合取各前级中最晚的可开始时间", () => {
    const result = computeSchedule(
      plan(
        [
          kickoff,
          task({ id: "A", durationDays: 2 }),
          task({ id: "B", durationDays: 5 }),
          task({ id: "C", durationDays: 1 }),
          preAccept,
        ],
        [dep(KICKOFF, "A"), dep(KICKOFF, "B"), dep("A", "C"), dep("B", "C")],
      ),
    );

    // A 结束 03-04；B 结束 03-09 → C 由 B 决定，03-10 开始
    expect(result.byId.A.plannedEnd).toBe("2026-03-04");
    expect(result.byId.B.plannedEnd).toBe("2026-03-09");
    expect(result.byId.C.plannedStart).toBe("2026-03-10");
    expect(result.byId.C.scheduleSource).toMatchObject({ kind: "DEPENDENCY", predId: "B" });
  });

  it("跳跃节假日与周末，仅按工作日推进", () => {
    const result = computeSchedule({
      ...plan([kickoff, task({ id: "A", durationDays: 3 }), preAccept], [dep(KICKOFF, "A")]),
      holidays: ["2026-03-04"],
    });

    // A 自 03-03 二起：03-03 / 03-04（节假日跳过）/ 03-05 → 03-06 结束
    expect(result.byId.A.plannedStart).toBe("2026-03-03");
    expect(result.byId.A.plannedEnd).toBe("2026-03-06");
  });

  it("MSO 约束日期落在非工作日时向前吸附", () => {
    const result = computeSchedule(
      plan(
        [
          kickoff,
          task({ id: "A", constraintType: "MSO", constraintDate: "2026-03-07" }), // 周六
          preAccept,
        ],
        [dep(KICKOFF, "A")],
      ),
    );

    expect(result.byId.A.plannedStart).toBe("2026-03-09"); // 吸附到周一
    expect(result.byId.A.scheduleSource).toMatchObject({ kind: "CONSTRAINT" });
  });
});

describe("computeSchedule 环检测", () => {
  it("存在循环依赖时置 hasCycle 并给出环路", () => {
    const result = computeSchedule(
      plan(
        [kickoff, task({ id: "A" }), task({ id: "B" }), preAccept],
        [dep(KICKOFF, "A"), dep("A", "B"), dep("B", "A")],
      ),
    );

    expect(result.hasCycle).toBe(true);
    expect(result.cycle.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === "CYCLE")).toBe(true);
  });
});

describe("computeSchedule 关键路径与初验点冲击", () => {
  const tasks = [kickoff, task({ id: "A", durationDays: 2 }), task({ id: "B", durationDays: 3 }), preAccept];
  const deps = [dep(KICKOFF, "A"), dep("A", "B")];

  it("提前完工：余量为正，任务不判定为关键", () => {
    const result = computeSchedule(plan(tasks, deps, "2026-03-31"));
    expect(result.slackDays).toBeGreaterThan(0);
    expect(result.byId.A.isCritical).toBe(false);
    expect(result.criticalPath).toHaveLength(0);
  });

  it("刚好完工：余量为 0，路径上任务全部为关键", () => {
    const result = computeSchedule(plan(tasks, deps, "2026-03-09"));
    expect(result.slackDays).toBe(0);
    expect(result.byId.A.isCritical).toBe(true);
    expect(result.byId.B.isCritical).toBe(true);
    expect(result.criticalPath).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("延期：余量为负", () => {
    const result = computeSchedule(plan(tasks, deps, "2026-03-05"));
    expect(result.slackDays).toBeLessThan(0);
  });

  it("初验点自身不参与完工计算，仅按余量标记关键", () => {
    const result = computeSchedule(plan(tasks, deps, "2026-03-09"));
    // 初验点是锚点，固定落在初验点日期
    expect(result.byId[PRE_ACCEPT].plannedStart).toBe("2026-03-09");
    expect(result.byId[PRE_ACCEPT].plannedEnd).toBe("2026-03-09");
    expect(result.byId[PRE_ACCEPT].isCritical).toBe(true);
  });
});

describe("computeSchedule 初验点由前级驱动", () => {
  const tasks = [kickoff, task({ id: "A", durationDays: 2 }), task({ id: "B", durationDays: 3 }), preAccept];
  const chained = [dep(KICKOFF, "A"), dep("A", "B"), dep("B", PRE_ACCEPT)];

  it("配置了前级依赖时，初验点排在前级完成之后", () => {
    const result = computeSchedule(plan(tasks, chained, "2026-03-31"));
    // B 结束 03-09 → 初验点落在下一个工作日 03-10
    expect(result.byId[PRE_ACCEPT].plannedStart).toBe("2026-03-10");
    expect(result.byId[PRE_ACCEPT].plannedEnd).toBe("2026-03-10");
    expect(result.projectFinish).toBe("2026-03-10");
    expect(result.slackDays).toBeGreaterThan(0);
  });

  it("初验点晚于目标日期时余量为负并判定为关键", () => {
    const result = computeSchedule(plan(tasks, chained, "2026-03-06"));
    expect(result.byId[PRE_ACCEPT].plannedStart).toBe("2026-03-10");
    expect(result.byId[PRE_ACCEPT].totalFloatDays).toBeLessThan(0);
    expect(result.byId[PRE_ACCEPT].isCritical).toBe(true);
    expect(result.slackDays).toBeLessThan(0);
  });

  it("未配置前级依赖时仍锚定在目标初验日", () => {
    const result = computeSchedule(
      plan(tasks, [dep(KICKOFF, "A"), dep("A", "B")], "2026-03-31"),
    );
    expect(result.byId[PRE_ACCEPT].plannedStart).toBe("2026-03-31");
    expect(result.projectFinish).toBe("2026-03-09");
  });
});

describe("computeSchedule 汇总节点 roll-up", () => {
  it("按子项聚合起止区间并按工期加权进度", () => {
    const result = computeSchedule(
      plan(
        [
          kickoff,
          task({ id: "S", taskType: "SUMMARY", wbsCode: "1" }),
          task({ id: "A", parentId: "S", durationDays: 2, progressPct: 100 }),
          task({ id: "B", parentId: "S", durationDays: 3, progressPct: 0 }),
          preAccept,
        ],
        [dep(KICKOFF, "A"), dep(KICKOFF, "B")],
      ),
    );

    const summary = result.byId.S;
    expect(summary.plannedStart).toBe("2026-03-03");
    // A 03-03~03-04（2 天）· B 03-03~03-05（3 天）→ 汇总区间 03-03~03-05
    expect(summary.plannedEnd).toBe("2026-03-05");
    // 03-03~03-05 共 3 个工作日
    expect(summary.durationDays).toBe(3);
    // (2×100 + 3×0) / 5 = 40
    expect(summary.progressPct).toBe(40);
  });
});

describe("computeSchedule 依赖汇总节点", () => {
  it("等价于依赖其下全部叶子任务，取最晚结束", () => {
    const result = computeSchedule(
      plan(
        [
          kickoff,
          task({ id: "S", taskType: "SUMMARY", wbsCode: "1" }),
          task({ id: "A", parentId: "S", durationDays: 2 }),
          task({ id: "B", parentId: "S", durationDays: 3 }),
          task({ id: "C", wbsCode: "6.1", durationDays: 1 }),
          preAccept,
        ],
        [dep(KICKOFF, "A"), dep(KICKOFF, "B"), dep("S", "C")],
      ),
    );

    // B 结束于 03-05，C 从下一个工作日 03-06 开始
    expect(result.byId.B.plannedEnd).toBe("2026-03-05");
    expect(result.byId.C.plannedStart).toBe("2026-03-06");
    expect(result.warnings.some((w) => w.code === "SUMMARY_DEPENDENCY")).toBe(false);
  });

  it("依赖包含自身的汇总节点会形成环", () => {
    const result = computeSchedule(
      plan(
        [
          kickoff,
          task({ id: "S", taskType: "SUMMARY", wbsCode: "1" }),
          task({ id: "A", parentId: "S", durationDays: 2 }),
          preAccept,
        ],
        [dep(KICKOFF, "A"), dep("S", "A")],
      ),
    );

    expect(result.hasCycle).toBe(true);
  });
});
