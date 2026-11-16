#!/usr/bin/env node
// Validates the prompt dataset (issue #12): unique ids, known topic and depth,
// non-empty text and a string followUp. Exits non-zero on any problem.
//
//   node scripts/check-prompts.mjs [path/to/prompts.json]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const PROMPT_TOPICS = [
  "self",
  "relationships",
  "work",
  "body",
  "gratitude",
  "dreams",
  "creativity",
  "nature",
  "spirit",
  "legacy",
];
export const PROMPT_DEPTHS = ["gentle", "deeper", "bold", "ethereal"];

export const DEFAULT_PROMPTS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../public/prompts.v1.core.json");

// Returns a list of human-readable problems; an empty list means the dataset is valid.
export function validatePrompts(prompts) {
  if (!Array.isArray(prompts)) return ["Prompt dataset must be a JSON array"];
  if (!prompts.length) return ["Prompt dataset is empty"];

  const errors = [];
  const seenIds = new Map();

  prompts.forEach((prompt, index) => {
    const where = `prompt[${index}]${prompt && typeof prompt.id === "string" ? ` (${prompt.id})` : ""}`;
    if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) {
      errors.push(`${where}: must be an object`);
      return;
    }

    if (typeof prompt.id !== "string" || !prompt.id.trim()) {
      errors.push(`${where}: id must be a non-empty string`);
    } else if (seenIds.has(prompt.id)) {
      errors.push(`${where}: duplicate id (first seen at prompt[${seenIds.get(prompt.id)}])`);
    } else {
      seenIds.set(prompt.id, index);
    }

    if (!PROMPT_TOPICS.includes(prompt.topic)) {
      errors.push(`${where}: topic ${JSON.stringify(prompt.topic)} is not one of ${PROMPT_TOPICS.join(", ")}`);
    }
    if (!PROMPT_DEPTHS.includes(prompt.depth)) {
      errors.push(`${where}: depth ${JSON.stringify(prompt.depth)} is not one of ${PROMPT_DEPTHS.join(", ")}`);
    }
    if (typeof prompt.text !== "string" || !prompt.text.trim()) {
      errors.push(`${where}: text must be a non-empty string`);
    }
    if (typeof prompt.followUp !== "string") {
      errors.push(`${where}: followUp must be a string`);
    }
  });

  return errors;
}

export function loadPrompts(path = DEFAULT_PROMPTS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const path = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PROMPTS_PATH;
  let prompts;
  try {
    prompts = loadPrompts(path);
  } catch (err) {
    console.error(`check-prompts: could not read ${path}: ${err.message}`);
    process.exit(1);
  }

  const errors = validatePrompts(prompts);
  if (errors.length) {
    console.error(`check-prompts: ${errors.length} problem(s) in ${path}`);
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  console.log(`check-prompts: ${prompts.length} prompts OK (${path})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
