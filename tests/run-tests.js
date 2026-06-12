const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  parseJsonObject,
  parseJsonObjects,
  isGeminiResult,
  normalizedResult,
  normalizedFirstResult,
  googleQueryUrl
} = require("../agent/gemini-playwright");

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
  assert.equal(sandbox.window.EximProcessor.test.validWebsiteUrl("https://www.eximpedia.app/companies/rarr"), "");
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
    "https://google.com/search?q=RARR%20Nuts%20Trading%20LLC"
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
  assert.equal(isGeminiResult(agentJson), true);
  const agentContact = normalizedResult(agentJson, agentRow, "");
  assert.equal(agentContact.website_url, "https://rarrnuts.com/");
  assert.equal(agentContact.email, "sales@rarrnuts.com");
  assert.equal(agentContact.phone_number, "+971 4 555 0123");

  const promptTemplate = parseJsonObject(
    '{"company_name":"","website_url":"","phone_number":"","email":"","source_url":"","confidence":0,"notes":""}'
  );
  assert.equal(isGeminiResult(promptTemplate), false);
  const multipleObjects = parseJsonObjects(
    '{"company_name":"","website_url":"","notes":""}\n'
    + JSON.stringify(agentJson)
  );
  assert.equal(multipleObjects.length, 2);
  assert.equal(multipleObjects.reverse().find(isGeminiResult).email, "sales@rarrnuts.com");
  const blockedContact = normalizedResult({
    company_name: "RARR Nuts Trading LLC",
    website_url: "https://www.eximpedia.app/companies/rarr",
    phone_number: "2091995945",
    email: "info@eximpedia.app",
    source_url: "https://www.eximpedia.app/companies/rarr",
    notes: "Portal result"
  }, agentRow, "");
  assert.equal(blockedContact.website_url, "");
  assert.equal(blockedContact.source_url, "");
  assert.equal(blockedContact.email, "");
  assert.equal(blockedContact.phone_number, "");

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
