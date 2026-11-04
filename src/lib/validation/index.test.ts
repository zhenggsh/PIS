import { describe, expect, it } from "vitest";
import { validatePlan } from "./index";
import type { PlanValidationInput, ValidationDependency, ValidationTask } from "./types";

/**
 * 三级校验单测（设计文档 §7）
 * V1/V2 必须遵循（BLOCK）；V3/V4 建议遵循（CONFIRM，可确认后绕过）。
 */

function task(partial: Partial<ValidationTask> & { id: string; wbsCode: string }): ValidationTask {
  return {
    name: partial.id,
    parentId: null,
    taskType: "TASK",
    status: "NOT_STARTED",
    durationDays: 1,
    isKickoff: false,
    isPreAccept: false,
    actualStart: null,
    ...partial,
  };
}

const kickoff = task({ id: "K", wbsCode: "0", taskType: "MILESTONE", isKickoff: true });
const preAccept = task({ id: "P", wbsCode: "99", taskType: "MILESTONE", isPreAccept: true });

function dep(predId: string, succId: string, lagDays = 0): ValidationDependency {
  return { predId, succId, lagDays };
}

function plan(
  tasks: ValidationTask[],
  dependencies: ValidationDependency[],
  maxLeafDays = 3,
): PlanValidationInput {
  return {
    project: { maxLeafDays, kickoffDate: "2026-03-02", preAcceptDate: "2026-03-31" },
    tasks,
    dependencies,
  };
}

describe("V1 前级依赖完整性（BLOCK）", () => {
  it("缺少前级依赖的执行任务被阻断", () => {
    const issues = validatePlan(plan([kickoff, preAccept, task({ id: "A", wbsCode: "1" })], []));
    const v1 = issues.find((i) => i.code === "V1_NO_PREDECESSOR");
    expect(v1?.level).toBe("BLOCK");
    expect(v1?.targetTaskIds).toEqual(["A"]);
  });

  it("开工会与初验点锚点无前级依赖也不报错", () => {
    const issues = validatePlan(plan([kickoff, preAccept], []));
    expect(issues.some((i) => i.code === "V1_NO_PREDECESSOR")).toBe(false);
  });
});

describe("V2 循环依赖（BLOCK）", () => {
  it("检测出环路并阻断", () => {
    const issues = validatePlan(
      plan(
        [kickoff, preAccept, task({ id: "A", wbsCode: "1" }), task({ id: "B", wbsCode: "2" })],
        [dep("K", "A"), dep("A", "B"), dep("B", "A")],
      ),
    );
    const v2 = issues.find((i) => i.code === "V2_DEP_CYCLE");
    expect(v2?.level).toBe("BLOCK");
    expect(v2?.targetTaskIds.length).toBeGreaterThan(0);
  });
});

describe("V3 分解粒度（CONFIRM）", () => {
  it("超过粒度上限的工作项给出建议项", () => {
    const issues = validatePlan(
      plan([kickoff, preAccept, task({ id: "A", wbsCode: "1", durationDays: 5 })], [dep("K", "A")], 3),
    );
    const v3 = issues.find((i) => i.code === "V3_GRANULARITY");
    expect(v3?.level).toBe("CONFIRM");
    expect(v3?.overridable).toBe(true);
  });

  it("未超过上限时不触发", () => {
    const issues = validatePlan(
      plan([kickoff, preAccept, task({ id: "A", wbsCode: "1", durationDays: 3 })], [dep("K", "A")], 3),
    );
    expect(issues.some((i) => i.code === "V3_GRANULARITY")).toBe(false);
  });
});

describe("V4 过程中的任务不得直接改起止时间（CONFIRM）", () => {
  it("已开工任务被直接修改起止时间时给出建议项", () => {
    const a = task({ id: "A", wbsCode: "1", status: "IN_PROGRESS" });
    const issues = validatePlan(plan([kickoff, preAccept, a], [dep("K", "A")]), {
      taskId: "A",
      fields: { plannedStart: "2026-03-05" },
    });
    const v4 = issues.find((i) => i.code === "V4_DIRECT_DATE_EDIT");
    expect(v4?.level).toBe("CONFIRM");
    expect(v4?.targetTaskIds).toEqual(["A"]);
  });

  it("未开工任务直接改日期不触发", () => {
    const a = task({ id: "A", wbsCode: "1", status: "NOT_STARTED", actualStart: null });
    const issues = validatePlan(plan([kickoff, preAccept, a], [dep("K", "A")]), {
      taskId: "A",
      fields: { plannedStart: "2026-03-05" },
    });
    expect(issues.some((i) => i.code === "V4_DIRECT_DATE_EDIT")).toBe(false);
  });

  it("仅调整工期不触发（应通过依赖与工期间接推算）", () => {
    const a = task({ id: "A", wbsCode: "1", status: "IN_PROGRESS" });
    const issues = validatePlan(plan([kickoff, preAccept, a], [dep("K", "A")]), {
      taskId: "A",
      fields: { durationDays: 4 },
    });
    expect(issues.some((i) => i.code === "V4_DIRECT_DATE_EDIT")).toBe(false);
  });
});
