import { expect, test } from "@playwright/test";

/**
 * The page-scoped styles were rebound to the design tokens, so the tokens have
 * to actually flip. This checks the plumbing rather than any one page.
 */
test("theme tokens resolve to different values in light and dark", async ({ page }) => {
  await page.goto("/login");
  await page.waitForSelector("[data-theme]");

  const read = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const names = [
      "--rt-card",
      "--rt-surface",
      "--rt-surface-subtle",
      "--rt-text",
      "--rt-muted",
      "--rt-border",
      "--rt-primary",
      "--rt-danger",
      "--rt-danger-border",
      "--rt-warning-border",
      "--rt-info-soft",
      "--rt-text-inverse",
      "--rt-green-200",
    ];
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
  });

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  const light = await read();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const dark = await read();

  for (const [name, value] of Object.entries(light)) {
    expect(value, `${name} must be defined in both themes`).not.toBe("");
    expect(dark[name], `${name} did not change between themes`).not.toBe(value);
  }
});

/**
 * Page shadows, focus rings and tinted surfaces mix against the brand token
 * instead of hardcoding it, so the mix has to resolve differently per theme
 * too - otherwise those details would stay light-theme green on a dark surface.
 */
test("brand colour mixes follow the theme", async ({ page }) => {
  await page.goto("/login");
  await page.waitForSelector("[data-theme]");

  const mix = () => page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "color-mix(in srgb, var(--rt-primary) 20%, transparent)";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  });

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  const lightMix = await mix();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const darkMix = await mix();

  expect(lightMix).not.toBe("");
  expect(darkMix).not.toBe("");
  expect(darkMix, "the mix did not track --rt-primary across themes").not.toBe(lightMix);
});
