const path = require("path");
const { GeminiPlaywrightAgent, loadEnv } = require("./gemini-playwright");

loadEnv(path.resolve(process.cwd(), ".env"));

(async () => {
  const agent = new GeminiPlaywrightAgent();
  const page = await agent.openLogin();
  console.log("Gemini opened in a persistent Playwright Chrome profile.");
  console.log("Complete login and wait until the Gemini prompt box is visible.");
  console.log("This command will save the profile and close automatically.");
  await page.bringToFront();
  await agent.waitForLogin((status, message) => {
    if (status === "waiting_login") {
      process.stdout.write(`\r${message}   `);
    }
  });
  console.log("\nGemini login confirmed. Saving profile...");
  await page.waitForTimeout(1500);
  await agent.close();
  console.log("Done. Now run: npm run agent");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
