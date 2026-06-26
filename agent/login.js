const path = require("path");
const { ChatGptPlaywrightAgent, loadEnv } = require("./chatgpt-playwright");

loadEnv(path.resolve(process.cwd(), ".env"));

(async () => {
  const agent = new ChatGptPlaywrightAgent();
  const page = await agent.openLogin({ visible: true });
  console.log("ChatGPT opened in a persistent Playwright Chrome profile.");
  console.log("Complete login and wait until the ChatGPT prompt box is visible.");
  console.log("This command will save the profile and close automatically.");
  await page.bringToFront();
  await agent.waitForLogin((status, message) => {
    if (status === "waiting_login") {
      process.stdout.write(`\r${message}   `);
    }
  }, page);
  console.log("\nChatGPT login confirmed. Saving profile...");
  await page.waitForTimeout(1500);
  await agent.close();
  console.log("Done. Now run: npm run agent");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
