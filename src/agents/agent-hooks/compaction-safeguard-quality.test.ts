import { describe, expect, it } from "vitest";
import {
  auditSummaryQuality,
  buildCompactionStructureInstructions,
  createSummaryQualityRetentionPlan,
} from "./compaction-safeguard-quality.js";

const structuredSummary = (pendingAsk: string, decision = "Keep current flow.") =>
  [
    `## Decisions\n${decision}`,
    "## Open TODOs\nNone.",
    "## Constraints/Rules\nPreserve the request state.",
    `## Pending user asks\n${pendingAsk}`,
    "## Exact identifiers\nNone.",
  ].join("\n");

describe("compaction summary request matching", () => {
  it.each([
    '- User sender={"id":"fixture"}: completed-source-fixture',
    '- User: completed-source-fixture 源数据\nQuoted "history" remains data.',
  ])("retains source facts outside pending asks through budget/replan (%s)", (sourceContext) => {
    const params = { identifiers: [], latestAsk: null, requiredSourceContext: sourceContext };
    const marker = "[Earlier context truncated]";
    const plan = createSummaryQualityRetentionPlan(structuredSummary("None."), marker, params);
    if (!plan) {
      throw new Error("expected a structured quality plan");
    }
    expect(plan.render(plan.minimumChars - 1)).toBeNull();
    for (const maxChars of [plan.minimumChars, plan.minimumChars + 32, plan.minimumChars + 256]) {
      const rendered = plan.render(maxChars);
      if (!rendered) {
        throw new Error("the protected minimum must fit an admitted budget");
      }
      expect(rendered.text.length).toBeLessThanOrEqual(maxChars);
      expect(rendered.text).toContain(`## Source context\n${JSON.stringify(sourceContext)}`);
      expect(rendered.text.split("## Pending user asks\n")[1]?.split("\n## ")[0]).not.toContain(
        "completed-source-fixture",
      );
      expect(
        createSummaryQualityRetentionPlan(rendered.text, marker, params)?.render(maxChars),
      ).toEqual({ text: rendered.text, trimmed: false });
    }
  });

  it("keeps failed-check guidance alongside a still-live user request", () => {
    const instructions = buildCompactionStructureInstructions(
      undefined,
      undefined,
      "Finish release preparation.",
    );
    expect(instructions).toContain(
      "a check that ran and returned a failing result is completed, not an open TODO",
    );
    expect(instructions).toContain("keep only the remaining remediation in ## Open TODOs");
    expect(instructions).toContain("Finish release preparation.");
    expect(instructions).toContain("Its run owner will resume it after compaction");
  });

  it("scopes retained ask checks to the split prefix without matching shared numbers", () => {
    const latestAsk = "Compare 10 and 20";
    const prefixSummary = (pendingAsk?: string) =>
      [
        `## Original Request\n${latestAsk}`,
        "## Early Progress\nValidated the provider boxes.",
        "## Context for Suffix\nThe retained suffix owns continuation state.",
        ...(pendingAsk ? [`## Pending user asks\n${pendingAsk}`] : []),
      ].join("\n");
    const decision = `${latestAsk} after validation.`;
    const historySummary = structuredSummary(latestAsk, decision);
    const structuralSummary = structuredSummary(
      `Latest user request context: ${JSON.stringify(latestAsk)}`,
      decision,
    );
    const auditRetained = (retainedTurnSummary: string) =>
      auditSummaryQuality({
        summary: `${structuralSummary}\n\n${retainedTurnSummary}`,
        structuralSummary,
        sourceSummaries: [historySummary, retainedTurnSummary],
        identifiers: [],
        latestAsk,
        retainedTurnSummary,
      });

    expect(auditRetained(prefixSummary())).toEqual({ ok: true, reasons: [] });
    expect(auditRetained(prefixSummary("Wait 10 to 20 seconds for deployment"))).toEqual({
      ok: true,
      reasons: [],
    });
    expect(auditRetained(historySummary).reasons).toContain("retained_turn_ask_marked_pending");
    expect(auditRetained(prefixSummary(latestAsk)).reasons).toContain(
      "retained_turn_ask_marked_pending",
    );
  });

  it.each(["请提供状态更新", "How about now?"])("flags an omitted latest ask: %s", (latestAsk) => {
    const summary = structuredSummary("No pending asks.");
    const quality = auditSummaryQuality({
      summary,
      structuralSummary: summary,
      identifiers: [],
      latestAsk,
    });

    expect(quality.ok).toBe(false);
    expect(quality.reasons).toContain("latest_user_ask_not_reflected");
  });
});
