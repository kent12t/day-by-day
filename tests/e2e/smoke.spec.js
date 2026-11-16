import { expect, test } from "@playwright/test";

// End-to-end smoke test (issue #12): first reflection from an empty journal.
// Selectors prefer ids and accessible roles so a visual refresh does not break them.

test("reveal a prompt, save an offline reflection, and find it again after reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  const nav = page.getByRole("navigation");
  const skyMeta = page.locator("#skyMeta");
  await expect(skyMeta).toHaveText(/your sky is waiting|^0 reflections/i);

  // Reflect: reveal today's prompt and use it.
  await nav.getByRole("button", { name: /add reflection|reflect/i }).click();
  await page.locator("#revealPromptBtn").click();
  const promptText = page.locator("#promptText");
  await expect(promptText).not.toHaveText(/take a breath|loading|no prompts/i);
  const prompt = (await promptText.innerText()).trim();
  expect(prompt.length).toBeGreaterThan(5);

  await page.locator("#usePromptBtn").click();

  // Capture: "I wrote offline" is the default; select it explicitly anyway.
  const offline = page.locator('#modeList [data-mode="offline"]');
  if (await offline.isVisible()) await offline.click();
  await page.locator("#saveEntryBtn").click();

  // Atlas shows the first star.
  await expect(skyMeta).toContainText("1 reflection");
  await expect(skyMeta).not.toContainText("1 reflections");

  // Persistence: survives a reload.
  await page.reload();
  await expect(skyMeta).toContainText("1 reflection");

  // Memories lists the entry with its prompt.
  await nav.getByRole("button", { name: "Memories", exact: true }).click();
  const historyList = page.locator("#historyList");
  await expect(historyList).toBeVisible();
  await expect(historyList).toContainText(prompt);

  expect(errors).toEqual([]);
});
