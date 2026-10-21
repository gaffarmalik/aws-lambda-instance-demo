import { test, expect } from "@playwright/test";
test("full teaching flow: collect, batch, process, ask, inspect evidence, and filter on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Every branch has a story." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collect feedback", exact: true })
    .click();
  await page.getByLabel("Purchased item").fill("Running shoes");
  await page.getByRole("button", { name: "5 stars", exact: true }).click();
  await page
    .getByLabel("Tell us a little more")
    .fill("Excellent quality and friendly staff.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("status")).toContainText("Thank you!");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Generate sample feedback" }).click();
  await expect(page.getByRole("status")).toContainText("24 sample responses");
  await expect(page.getByLabel("Collection buffer")).toContainText(
    "25 responses in memory",
  );
  await page.getByRole("button", { name: "Flush batch now" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Batch uploaded: 25 responses",
  );
  await expect(page.locator(".batch-panel .pill.completed")).toHaveText(
    "completed",
    { timeout: 15000 },
  );
  await expect(page.locator(".stat-card").first()).toContainText("25");
  await page.getByRole("button", { name: "Ask question", exact: true }).click();
  await expect(page.locator(".answer")).toContainText("South East");
  await expect(
    page.getByRole("link", { name: "Saved report" }),
  ).toHaveAttribute("href", /reports/);
  await page.locator(".answer .evidence-card").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Feedback ID");
  await expect(page.getByRole("dialog")).toContainText("Source object");
  await page.getByRole("button", { name: "Close evidence" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Branch", { exact: true }).selectOption("enugu");
  await expect(page.locator(".stat-card").first()).toContainText("4");
  await expect(page.locator(".region-chart")).toContainText("South East");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("Branch", { exact: true }).selectOption("");
  await page.getByLabel("Sample feedback count").selectOption("200");
  await page.getByRole("button", { name: "Generate sample feedback" }).click();
  await expect(page.getByRole("status")).toContainText("200 sample responses");
  await expect(page.locator(".stat-card").first()).toContainText("225", {
    timeout: 15000,
  });
  await expect(page.locator(".batch-panel .pill.completed")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("changing filters cancels an obsolete question and dashboard errors do not stop buffer refresh", async ({
  page,
  request,
}) => {
  await request.post("/api/samples", { data: { count: 6 } });
  await request.post("/api/batches/flush", { data: {} });
  await page.goto("/");
  await expect(
    page.locator(".batch-panel .pill.completed").first(),
  ).toBeVisible();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  let delivered = false;
  await page.route("**/api/questions", async (route) => {
    const response = await route.fetch();
    captured = true;
    await gate;
    try {
      await route.fulfill({ response });
    } catch {
      /* The request should have been aborted on filter change. */
    }
    delivered = true;
  });
  await page.getByRole("button", { name: "Ask question", exact: true }).click();
  await expect.poll(() => captured).toBe(true);
  await page.getByLabel("Branch", { exact: true }).selectOption("enugu");
  release();
  await expect.poll(() => delivered).toBe(true);
  await expect(
    page.getByRole("button", { name: "Ask question", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".answer")).toHaveCount(0);

  await page.getByLabel("From (UTC)").fill("2099-01-01");
  await expect(page.getByRole("alert")).toContainText("Start date");
  const previous = (await (await request.get("/api/buffer")).json()) as {
    count: number;
  };
  await request.post("/api/feedback", {
    data: {
      branchId: "ikeja",
      item: "Test item",
      rating: 4,
      comment: "Good quality.",
    },
  });
  await expect(page.getByLabel("Collection buffer")).toContainText(
    `${previous.count + 1} responses in memory`,
    { timeout: 10000 },
  );
  await expect(
    page.getByRole("button", { name: "Flush batch now" }),
  ).toBeEnabled();
});
