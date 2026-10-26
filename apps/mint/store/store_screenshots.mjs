// Capture Play Store phone screenshots (1080x1920) of the live Mint app with headless Chrome.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const outDir = process.argv[2];
const site = "https://juw12.github.io/projects/mint/app.html";
const shots = [
  { name: "01-market", hash: "#/market", wait: ".card" },
  { name: "02-template", hash: "#/item/seed-budget", wait: "h1" },
  { name: "03-create", hash: "#/create", wait: "textarea, input" },
  { name: "04-guides", hash: "#/guides", wait: "h1, h2" },
];

fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mint-shots-"));
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  userDataDir: profile,
  args: ["--no-first-run", "--no-default-browser-check", "--hide-scrollbars"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.setUserAgent(
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 MintApp/1.0",
  );
  for (const shot of shots) {
    await page.goto(site + shot.hash, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(shot.wait, { timeout: 30000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const file = path.join(outDir, shot.name + ".png");
    await page.screenshot({ path: file });
    console.log("saved", file);
  }
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
