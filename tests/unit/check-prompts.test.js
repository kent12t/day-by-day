import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPT_DEPTHS, PROMPT_TOPICS, loadPrompts, validatePrompts } from "../../scripts/check-prompts.mjs";

const SCRIPT = new URL("../../scripts/check-prompts.mjs", import.meta.url).pathname;
const valid = (overrides = {}) => ({
  id: "self-gentle-1",
  topic: "self",
  depth: "gentle",
  text: "What feeling visited me today?",
  followUp: "Where did I notice it?",
  ...overrides,
});

describe("prompt dataset (public/prompts.v1.core.json)", () => {
  const prompts = loadPrompts();

  it("passes validation", () => {
    expect(validatePrompts(prompts)).toEqual([]);
  });

  it("covers every topic and depth combination", () => {
    for (const topic of PROMPT_TOPICS) {
      for (const depth of PROMPT_DEPTHS) {
        expect(
          prompts.some((p) => p.topic === topic && p.depth === depth),
          `${topic}/${depth}`
        ).toBe(true);
      }
    }
  });
});

describe("validatePrompts", () => {
  it("knows the 10 topics and 4 depths", () => {
    expect(PROMPT_TOPICS).toHaveLength(10);
    expect(PROMPT_DEPTHS).toEqual(["gentle", "deeper", "bold", "ethereal"]);
  });

  it("accepts a well-formed dataset, including an empty followUp", () => {
    expect(validatePrompts([valid(), valid({ id: "self-gentle-2", followUp: "" })])).toEqual([]);
  });

  it("rejects non-arrays and empty arrays", () => {
    expect(validatePrompts({ prompts: [] })).toHaveLength(1);
    expect(validatePrompts([])).toHaveLength(1);
  });

  it.each([
    ["duplicate ids", [valid(), valid()], /duplicate id/],
    ["missing id", [valid({ id: "" })], /id must be/],
    ["unknown topic", [valid({ topic: "wildcard" })], /topic "wildcard"/],
    ["unknown depth", [valid({ depth: "shallow" })], /depth "shallow"/],
    ["blank text", [valid({ text: "   " })], /text must be/],
    ["missing followUp", [valid({ followUp: undefined })], /followUp must be a string/],
    ["non-object entry", [null], /must be an object/],
  ])("reports %s", (_label, prompts, pattern) => {
    const errors = validatePrompts(prompts);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(pattern);
  });
});

describe("check-prompts CLI", () => {
  it("exits 0 for the bundled dataset", () => {
    const out = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(out).toMatch(/prompts OK/);
  });

  it("exits non-zero and lists problems for a bad dataset", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-prompts-"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify([valid(), valid({ topic: "nope" })]));
    let failure;
    try {
      execFileSync(process.execPath, [SCRIPT, file], { encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      failure = err;
    }
    expect(failure?.status).toBe(1);
    expect(failure.stderr).toMatch(/duplicate id/);
    expect(failure.stderr).toMatch(/topic "nope"/);
  });
});
