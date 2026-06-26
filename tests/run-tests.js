const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  ChatGptPlaywrightAgent,
  parseJsonObject,
  parseJsonObjects,
  parseJsonArrays,
  parseChatGPTBatchResults,
  isChatGPTResult,
  normalizedResult,
  normalizedFirstResult,
  applyBatchChatGPTResult,
  googleQueryUrl,
  googleQueryText,
  clearProfileCaches,
  availableMemoryMb,
  adaptiveParallelismLimit,
  hardwareParallelismCap
} = require("../agent/chatgpt-playwright");

const root = path.resolve(__dirname, "..");
const sandbox = {
  window: {},
  Blob,
  TextEncoder,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
  DOMParser: class DOMParserStub {},
  fetch: async () => {
    throw new Error("fetch is not used in this test");
  },
  console
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "src/lib/powerbi-dsr.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "src/lib/processor.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "src/lib/exporters.js"), "utf8"), sandbox);

async function main() {
  const interventionAgent = new ChatGptPlaywrightAgent();
  const launchModes = [];
  const interventionStatuses = [];
  let initialContextClosed = false;
  const workerPage = { async close() {} };
  const visiblePage = {
    isClosed() { return false; },
    url() { return "https://www.google.com/search?q=completed"; },
    locator() { return { innerText: async () => "Google Search Results" }; },
    async goto() {},
    async bringToFront() {},
    async waitForTimeout() {},
    async close() {}
  };
  const headedContext = {
    pages() { return [visiblePage]; },
    async close() {}
  };
  const backgroundContext = {
    pages() { return []; },
    async close() {}
  };
  interventionAgent.context = {
    async close() { initialContextClosed = true; }
  };
  interventionAgent.headless = true;
  interventionAgent.contextHeadless = true;
  interventionAgent.activeWorkerPages = 9;
  interventionAgent.launch = async (headless) => {
    launchModes.push(headless);
    const context = headless ? backgroundContext : headedContext;
    interventionAgent.context = context;
    interventionAgent.contextHeadless = headless;
    return context;
  };
  await interventionAgent.waitForManualIntervention({
    page: workerPage,
    trackedPage: true,
    kind: "captcha",
    url: "https://www.google.com/sorry/index",
    onStatus(status, message) {
      interventionStatuses.push({ status, message });
    }
  });
  assert.equal(initialContextClosed, true);
  assert.deepEqual(launchModes, [false, true]);
  assert.equal(interventionAgent.activeWorkerPages, 0);
  assert.equal(interventionAgent.interventionSerial, 1);
  assert.equal(interventionStatuses[0].status, "waiting_captcha");
  assert.match(interventionStatuses[0].message, /Opening Chrome now/);
  assert.doesNotMatch(interventionStatuses.map((item) => item.message).join(" "), /Pausing \d+ active/);

  assert.ok(availableMemoryMb() > 0);
  const cacheFixture = path.join("/private/tmp", `chatgpt-profile-cache-test-${process.pid}`);
  fs.mkdirSync(path.join(cacheFixture, "Default", "Cache"), { recursive: true });
  fs.mkdirSync(path.join(cacheFixture, "Default", "Service Worker", "CacheStorage"), { recursive: true });
  fs.writeFileSync(path.join(cacheFixture, "Default", "Cache", "data"), "cache");
  fs.writeFileSync(path.join(cacheFixture, "Default", "Cookies"), "keep-login");
  clearProfileCaches(cacheFixture);
  assert.equal(fs.existsSync(path.join(cacheFixture, "Default", "Cache")), false);
  assert.equal(fs.existsSync(path.join(cacheFixture, "Default", "Service Worker", "CacheStorage")), false);
  assert.equal(fs.readFileSync(path.join(cacheFixture, "Default", "Cookies"), "utf8"), "keep-login");
  fs.rmSync(cacheFixture, { recursive: true, force: true });

  const lockedCacheFixture = path.join("/private/tmp", `chatgpt-profile-locked-test-${process.pid}`);
  fs.mkdirSync(path.join(lockedCacheFixture, "Default", "Cache"), { recursive: true });
  fs.writeFileSync(path.join(lockedCacheFixture, "Default", "Cache", "data"), "active-cache");
  fs.writeFileSync(path.join(lockedCacheFixture, "SingletonLock"), "locked");
  clearProfileCaches(lockedCacheFixture);
  assert.equal(fs.readFileSync(path.join(lockedCacheFixture, "Default", "Cache", "data"), "utf8"), "active-cache");
  fs.rmSync(lockedCacheFixture, { recursive: true, force: true });

  const rawRows = [
    {
      hsCode: "08013220",
      consignee: "Rabelink Logistics",
      exporter: "Intersnack Cashew India Private Limited",
      productDescription: "Indian Cashew Kernels",
      country: "NETHERLANDS",
      quantity: "24,948.00",
      fobValue: "327,264,000.00",
      consigneeUrl: "https://google.com/search?q=Rabelink%20Logistics%20Wehl%20Netherlands",
      exporterUrl: "https://google.com/search?q=Intersnack%20Cashew%20India%20Private%20Limited%20No.93%20New%20No.119%20St.%20Marys%20Road",
      website: "https://example.com",
      sourceMethod: "test"
    },
    {
      hsCode: "08013220",
      consignee: "Rabelink Logistics",
      exporter: "Intersnack Cashew India Private Limited",
      productDescription: "Indian Cashew Kernels",
      country: "NETHERLANDS",
      quantity: "24,948.00",
      fobValue: "327,264,000.00",
      website: "https://example.com/contact",
      sourceMethod: "test"
    },
    {
      hsCode: "08013220",
      consignee: "https://google.com/search?q=Rabelink%20Logistics%20NETHERLANDS",
      exporter: "Intersnack Cashew India Private Limited",
      productDescription: "Indian Cashew Kernels",
      country: "NETHERLANDS",
      quantity: "24,948.00",
      fobValue: "327,264,000.00",
      sourceMethod: "search-url-country"
    },
    {
      hsCode: "08039010",
      consignee: "Persian Dasht",
      exporter: "Trident Agrocom Exports Private Limited",
      productDescription: "Bananas Green Cavendish",
      country: "IRAN",
      email: "sales@example.org",
      phone: "+91 98765 43210",
      sourceMethod: "test"
    },
    {
      hsCode: "08011100",
      consignee: "https://google.com/search?q=Ali%20Juma%20Mullah%20Abdullah",
      exporter: "Indoga Enterprises",
      productDescription: "Rasakadahli 08",
      country: "BAHRAIN",
      quantity: "270.00",
      fobValue: "35,510.40",
      sourceFrame: "https://app.powerbi.com/view?r=fake",
      sourceMethod: "test"
    },
    {
      hsCode: "Select Row",
      consignee: "08013220",
      exporter: "https://google.com/search?q=Wrong%20Shifted%20Company",
      productDescription: "Rabelink Logistics",
      country: "Intersnack Cashew India Private Limited",
      quantity: "Indian Cashew Kernels",
      fobValue: "NETHERLANDS",
      sourceMethod: "shifted-powerbi-selector"
    }
,
    {
      hsCode: "08140000",
      consignee: "",
      exporter: "Vkm Express General Trading (Opc) Private Limited",
      productDescription: "Vkm General Trading Llc 3000 Pcs Watermelon",
      country: "UNITED ARAB EMIRATES",
      quantity: "3,000.00",
      fobValue: "1,078,000.00",
      sourceMethod: "shifted-blank-consignee"
    }
  ];

  const processed = sandbox.window.EximProcessor.processRows(rawRows, {
    companySource: "consignee",
    dedupe: true
  });

  assert.equal(processed.rows.length, 3);
  assert.equal(processed.duplicatesRemoved, 2);
  assert.equal(processed.rows[0].duplicateCount, 3);
  assert.equal(processed.rows[0].consignee, "Rabelink Logistics");
  assert.equal(processed.rows[0].exporter, "Intersnack Cashew India Private Limited");
  assert.equal(processed.rows[1].consignee, "Persian Dasht");
  assert.equal(processed.rows[1].exporter, "Trident Agrocom Exports Private Limited");
  assert.equal(processed.rows[2].websiteName, "Ali Juma Mullah Abdullah");
  assert.doesNotMatch(JSON.stringify(processed.rows), /Wrong Shifted Company|Select Row|Vkm General Trading Llc 3000 Pcs Watermelon/);
  assert.doesNotMatch(JSON.stringify(processed.rows), /Rabelink Logistics NETHERLANDS/);
  assert.deepEqual(processed.columns.map((column) => column.label), [
    "HSN Code",
    "Website Name",
    "Website URL",
    "Email",
    "Phone"
  ]);

  const fixturePath = "/Users/manishtalwar/.codex/attachments/c0da8b00-27ee-4408-8321-d8e0d823564e/pasted-text.txt";
  if (fs.existsSync(fixturePath)) {
    const parsed = sandbox.window.EximPowerBiDsr.parseResponses([fs.readFileSync(fixturePath, "utf8")]);
    assert.equal(parsed.rows.length, 499);
    assert.equal(parsed.rows[0].hsCode, "08013220");
    assert.equal(parsed.rows[0].consignee, "Rabelink Logistics");
    assert.equal(parsed.rows[0].exporter, "Intersnack Cashew India Private Limited");
    assert.equal(parsed.rows[0].country, "NETHERLANDS");
    assert.equal(parsed.rows[0].quantity, "24,948.00");
    assert.equal(parsed.rows[0].fobValue, "327,264,000.00");
    assert.equal(parsed.rows[9].consignee, "Daisy Fruit Trading Company Llc");
    assert.equal(parsed.rows[9].quantity, "8,320.00");
    assert.ok(parsed.restartTokens.length >= 1);
  }

  const requestFixturePath = "/Users/manishtalwar/.codex/attachments/1556c62e-232c-415c-9294-ab31e6fc7deb/pasted-text.txt";
  if (fs.existsSync(requestFixturePath)) {
    const requestText = fs.readFileSync(requestFixturePath, "utf8");
    const fields = sandbox.window.EximPowerBiDsr.requestFieldNames(requestText);
    assert.deepEqual(fields.map((field) => field.split(" | ")[0]), [
      "HS Code",
      "Consignee",
      "Exporter",
      "Product Description",
      "FOB Value",
      "22 Quantity",
      "Country"
    ]);
    assert.doesNotMatch(fields.join("\n"), /website|email|phone|mobile/i);

    const boosted = JSON.parse(sandbox.window.EximPowerBiDsr.boostQueryDataWindow(requestText, {
      count: 50000,
      restartToken: [["token"], ["next"]]
    }));
    const windowConfig = boosted.queries[0].Query.Commands[0]
      .SemanticQueryDataShapeCommand.Binding.DataReduction.Primary.Window;
    assert.equal(windowConfig.Count, 50000);
    assert.deepEqual(windowConfig.RestartTokens, [["token"], ["next"]]);
  }

  assert.equal(sandbox.window.EximProcessor.test.validWebsiteUrl("https://%2021St%20Cross"), "");
  assert.equal(
    sandbox.window.EximProcessor.test.validWebsiteUrl("https://www.eximpedia.app/companies/rarr"),
    "https://www.eximpedia.app/companies/rarr"
  );
  assert.equal(sandbox.window.EximProcessor.test.validPhone("2091995945"), false);
  assert.equal(sandbox.window.EximProcessor.test.validPhone("+97145550123"), true);

  const agentRow = {
    hsCode: "08013220",
    websiteName: "RARR Nuts Trading LLC",
    companyName: "RARR Nuts Trading LLC",
    consignee: "RARR Nuts Trading LLC",
    consigneeUrl: "https://google.com/search?q=RARR%20Nuts%20Trading%20LLC",
    country: "UNITED ARAB EMIRATES",
    websiteUrl: "",
    email: "",
    phone: ""
  };
  assert.equal(
    googleQueryUrl(agentRow),
    "https://www.google.com/search?num=10&hl=en&q=RARR%20Nuts%20Trading%20LLC"
  );
  const ampersandQueryRow = {
    websiteName: "Spmuthiah & Sons Pte Ltd",
    consigneeUrl: "https://google.com/search?q=Spmuthiah%20&%20Sons%20Pte%20Ltd%20SINGAPORE",
    country: "SINGAPORE"
  };
  assert.equal(googleQueryText(ampersandQueryRow), "Spmuthiah & Sons Pte Ltd SINGAPORE");
  assert.equal(
    googleQueryUrl(ampersandQueryRow),
    "https://www.google.com/search?num=10&hl=en&q=Spmuthiah%20%26%20Sons%20Pte%20Ltd%20SINGAPORE"
  );
  const agentJson = parseJsonObject(
    "```json\n" + JSON.stringify({
      company_name: "RARR Nuts Trading LLC",
      website_url: "https://rarrnuts.com/",
      phone_number: "+971 4 555 0123",
      email: "sales@rarrnuts.com",
      source_url: "https://rarrnuts.com/contact",
      confidence: 0.94,
      notes: "Verified on the official contact page"
    }) + "\n```"
  );
  assert.equal(isChatGPTResult(agentJson), true);
  const agentContact = normalizedResult(agentJson, agentRow, "");
  assert.equal(agentContact.website_url, "https://rarrnuts.com/");
  assert.equal(agentContact.email, "sales@rarrnuts.com");
  assert.equal(agentContact.phone_number, "+971 4 555 0123");

  const promptTemplate = parseJsonObject(
    '{"company_name":"","website_url":"","phone_number":"","email":"","source_url":"","confidence":0,"notes":""}'
  );
  assert.equal(isChatGPTResult(promptTemplate), false);
  const multipleObjects = parseJsonObjects(
    '{"company_name":"","website_url":"","notes":""}\n'
    + JSON.stringify(agentJson)
  );
  assert.equal(multipleObjects.length, 2);
  assert.equal(multipleObjects.reverse().find(isChatGPTResult).email, "sales@rarrnuts.com");
  const batchJson = [
    {
      batch_id: "Q001",
      company_name: "RARR Nuts Trading LLC",
      website_url: "https://rarrnuts.com/",
      phone_number: "+971 4 555 0123",
      email: "sales@rarrnuts.com",
      source_url: "https://rarrnuts.com/contact",
      confidence: 0.94,
      notes: "Batch result"
    },
    {
      batch_id: "Q002",
      company_name: "Example Trading",
      website_url: "https://example.com/",
      phone_number: "",
      email: "",
      source_url: "https://example.com/",
      confidence: 0.5,
      notes: "No visible contact"
    }
  ];
  assert.equal(parseJsonArrays("```json\n" + JSON.stringify(batchJson) + "\n```")[0].length, 2);
  assert.equal(parseChatGPTBatchResults("```json\n" + JSON.stringify(batchJson) + "\n```", 2)[1].batch_id, "Q002");
  assert.equal(parseChatGPTBatchResults("```json\n" + JSON.stringify(batchJson) + "\n```", 2, ["Q011", "Q012"]).length, 0);
  const promptInputOnly = [{ batch_id: "Q001", query: "RARR Nuts Trading LLC UAE" }];
  assert.equal(parseChatGPTBatchResults(JSON.stringify(promptInputOnly), 1, ["Q001"]).length, 0);
  assert.equal(
    parseChatGPTBatchResults(
      `Input JSON:\n${JSON.stringify(promptInputOnly)}\nAnswer:\n${JSON.stringify([batchJson[0]])}`,
      1,
      ["Q001"]
    )[0].website_url,
    "https://rarrnuts.com/"
  );
  const wrappedChatGptJson = `[
{
"batch_id": "Q001",
"company_name": "RARR Nuts Trading LLC",
"website_url": "https://rarrnuts.com/
",
"phone_number": "+971 4 555 0123",
"email": "sales@rarrnuts.com
",
"source_url": "https://rarrnuts.com/contact
",
"confidence": 0.94,
"notes": "Wrapped URL/email text"
},
{
"batch_id": "Q002",
"company_name": "Example Trading",
"website_url": "https://example.com/
",
"phone_number": "",
"email": "",
"source_url": "https://example.com/
",
"confidence": 0.5,
"notes": "No visible contact"
}
]`;
  const wrappedResults = parseChatGPTBatchResults(wrappedChatGptJson, 2, ["Q001", "Q002"]);
  assert.equal(wrappedResults.length, 2);
  assert.equal(wrappedResults[0].website_url, "https://rarrnuts.com/");
  assert.equal(wrappedResults[0].email, "sales@rarrnuts.com");
  const mixedBatchText = JSON.stringify(batchJson) + "\n" + JSON.stringify([
    { ...batchJson[0], batch_id: "Q011" },
    { ...batchJson[1], batch_id: "Q012" }
  ]);
  assert.deepEqual(
    parseChatGPTBatchResults(mixedBatchText, 2, ["Q011", "Q012"]).map((item) => item.batch_id),
    ["Q011", "Q012"]
  );
  const markdownUrlContact = normalizedFirstResult({
    company_name: "Krishiv Foods LLC",
    website_url: "[https://krishivfoods.com/](https://krishivfoods.com/)",
    source_url: "[https://krishivfoods.com/contact](https://krishivfoods.com/contact)",
    notes: "Markdown URL"
  }, agentRow, "");
  assert.equal(markdownUrlContact.website_url, "https://krishivfoods.com/");
  assert.equal(markdownUrlContact.source_url, "https://krishivfoods.com/contact");
  const arrowUrlContact = normalizedFirstResult({
    company_name: "Fuchsiana General Trading LLC",
    website_url: "https://www.exportersindia.com/ae/fuchsiana-general-trading-llc/↗",
    phone_number: "+971 52 213 7960",
    email: "",
    source_url: "https://2gis.ae/dubai/firm/70000001086853355↗",
    notes: "Phone found in same-company listing"
  }, agentRow, "");
  assert.equal(arrowUrlContact.website_url, "https://www.exportersindia.com/ae/fuchsiana-general-trading-llc/");
  assert.equal(arrowUrlContact.source_url, "https://2gis.ae/dubai/firm/70000001086853355");
  assert.equal(arrowUrlContact.phone_number, "+971 52 213 7960");
  assert.equal(normalizedFirstResult({
    company_name: "Masked Phone Example",
    website_url: "https://example.com/",
    phone_number: "+971 52 213 ....",
    source_url: "https://example.com/"
  }, agentRow, "").phone_number, "");
  const fuchsianaRankOne = "https://www.exportersindia.com/ae/fuchsiana-general-trading-llc/";
  const fuchsianaOutput = [{
    hsCode: "08011220",
    websiteName: "Fuchsiana General Trading LLC",
    companyName: "Fuchsiana General Trading LLC",
    consignee: "Fuchsiana General Trading LLC",
    country: "UNITED ARAB EMIRATES",
    websiteUrl: "",
    email: "",
    phone: ""
  }];
  applyBatchChatGPTResult(fuchsianaOutput, {
    batchId: "Q001",
    entry: { row: fuchsianaOutput[0], indexes: [0] },
    resultListPath: "/tmp/q001-chatgpt-input.json"
  }, {
    batch_id: "Q001",
    website_url: `[${fuchsianaRankOne}](${fuchsianaRankOne})`,
    phone_number: "+971 52 213 7960",
    email: ""
  }, "");
  assert.equal(fuchsianaOutput[0].websiteUrl, fuchsianaRankOne);
  assert.equal(fuchsianaOutput[0].phone, "+971 52 213 7960");
  assert.equal(fuchsianaOutput[0].email, "");
  assert.ok(fuchsianaOutput[0].contactSource.includes(fuchsianaRankOne));
  const dynamicPortalContact = normalizedResult({
    company_name: "RARR Nuts Trading LLC",
    website_url: "https://www.eximpedia.app/companies/rarr",
    phone_number: "2091995945",
    email: "info@eximpedia.app",
    source_url: "https://www.eximpedia.app/companies/rarr",
    notes: "Dynamic portal result"
  }, agentRow, "");
  assert.equal(dynamicPortalContact.website_url, "https://www.eximpedia.app/companies/rarr");
  assert.equal(dynamicPortalContact.source_url, "https://www.eximpedia.app/companies/rarr");
  assert.equal(dynamicPortalContact.email, "info@eximpedia.app");
  assert.equal(dynamicPortalContact.phone_number, "2091995945");

  const firstResultContact = normalizedFirstResult({
    company_name: "RARR Nuts Trading LLC",
    website_url: "https://www.volza.com/company-profile/rarr-nuts-trading-llc-12345/",
    phone_number: "+971 4 555 0123",
    email: "sales@volza.com",
    source_url: "https://www.volza.com/company-profile/rarr-nuts-trading-llc-12345/",
    notes: "First Google result page showed these fields"
  }, agentRow, "");
  assert.equal(firstResultContact.website_url, "https://www.volza.com/company-profile/rarr-nuts-trading-llc-12345/");
  assert.equal(firstResultContact.source_url, "https://www.volza.com/company-profile/rarr-nuts-trading-llc-12345/");
  assert.equal(firstResultContact.email, "sales@volza.com");
  assert.equal(firstResultContact.phone_number, "+971 4 555 0123");
  assert.equal(hardwareParallelismCap(4096, 4), 2);
  assert.equal(hardwareParallelismCap(8192, 8), 3);
  assert.equal(adaptiveParallelismLimit({
    requested: 30,
    entriesCount: 100,
    totalMb: 4096,
    freeMb: 1800,
    cpuCount: 4,
    maxParallelism: 10,
    pageMemoryMb: 700,
    systemReserveMemoryMb: 1536
  }), 1);
  assert.equal(adaptiveParallelismLimit({
    requested: 15,
    entriesCount: 100,
    totalMb: 8192,
    freeMb: 4096,
    cpuCount: 8,
    maxParallelism: 10,
    pageMemoryMb: 700,
    systemReserveMemoryMb: 1536
  }), 3);
  assert.equal(adaptiveParallelismLimit({
    requested: 30,
    entriesCount: 100,
    totalMb: 32768,
    freeMb: 20000,
    cpuCount: 12,
    maxParallelism: 10,
    pageMemoryMb: 700,
    systemReserveMemoryMb: 1536
  }), 8);

  const pipelineAgent = new ChatGptPlaywrightAgent();
  const pipelineEvents = [];
  pipelineAgent.launch = async () => ({ pages: () => [] });
  pipelineAgent.ensureChatGPTLogin = async () => {
    throw new Error("processRows should not require a separate login preflight");
  };
  pipelineAgent.batchSize = 25;
  pipelineAgent.chatgptBatchParallelism = 4;
  pipelineAgent.collectGoogleResultsBatch = async ({ items, batchIndex }) => {
    throw new Error(`Local search collection should not run for direct ChatGPT batches: ${batchIndex}`);
  };
  pipelineAgent.processChatGPTBatch = async ({ items, batchIndex, output }) => {
    pipelineEvents.push(`gpt-start-${batchIndex}`);
    await new Promise((resolve) => setTimeout(resolve, batchIndex === 0 ? 60 : 5));
    for (const item of items) {
      for (const index of item.entry.indexes) {
        output[index] = { ...output[index], websiteUrl: `https://example-${item.position}.com/` };
      }
    }
    pipelineEvents.push(`gpt-end-${batchIndex}`);
    return { company: items[items.length - 1]?.company || "", message: `batch ${batchIndex}` };
  };
  const pipelineRows = Array.from({ length: 100 }, (_, index) => ({
    hsCode: "08011220",
    websiteName: `Pipeline Company ${index}`,
    companyName: `Pipeline Company ${index}`,
    consignee: `Pipeline Company ${index}`,
    consigneeUrl: `https://google.com/search?q=Pipeline%20Company%20${index}`,
    country: "UNITED ARAB EMIRATES"
  }));
  const pipelineJobDir = path.join("/private/tmp", `chatgpt-pipeline-test-${process.pid}`);
  fs.mkdirSync(pipelineJobDir, { recursive: true });
  const pipelineOutput = await pipelineAgent.processRows(
    pipelineRows,
    pipelineJobDir,
    () => {}
  );
  fs.rmSync(pipelineJobDir, { recursive: true, force: true });
  assert.equal(pipelineOutput.length, 100);
  assert.ok(pipelineEvents.indexOf("gpt-start-1") < pipelineEvents.indexOf("gpt-end-0"));
  assert.ok(pipelineEvents.indexOf("gpt-start-2") < pipelineEvents.indexOf("gpt-end-0"));
  assert.ok(pipelineEvents.indexOf("gpt-start-3") < pipelineEvents.indexOf("gpt-end-0"));

  processed.rows[0].websiteUrl = "https://rabelink.nl/";
  processed.rows[0].email = "info@rabelink.nl";
  processed.rows[0].phone = "+31 314 368 500";
  processed.rows[1].websiteUrl = "https://persiandasht.example/";
  processed.rows[2].websiteUrl = "https://alijuma.example/";

  const csv = sandbox.window.EximExporter.toCsv(processed.rows, processed.columns);
  assert.match(csv, /HSN Code,Website Name,Website URL,Email,Phone/);
  assert.doesNotMatch(csv, /Consignee|Exporter|Product Description|Country|Quantity|FOB Value/);
  assert.ok(csv.includes("Rabelink Logistics,https://rabelink.nl/,info@rabelink.nl,+31 314 368 500"));
  fs.writeFileSync("/private/tmp/exim-export-test.csv", csv);

  const xlsxBlob = sandbox.window.EximExporter.toXlsxBlob(processed.rows, processed.columns);
  assert.equal(xlsxBlob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.ok(xlsxBlob.size > 1000);
  const xlsxBuffer = Buffer.from(await xlsxBlob.arrayBuffer());
  const xlsxText = xlsxBuffer.toString("utf8");
  assert.ok(xlsxText.includes("xl/worksheets/_rels/sheet1.xml.rels"));
  assert.ok(xlsxText.includes("https://rabelink.nl/"));
  assert.ok(!xlsxText.includes("google.com/search"));
  fs.writeFileSync("/private/tmp/exim-export-test.xlsx", xlsxBuffer);

  console.log("All JS tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
