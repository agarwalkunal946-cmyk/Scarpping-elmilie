const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const AI_PROVIDER_NAME = "ChatGPT";
const AI_PROVIDER_URL = "https://chatgpt.com/";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readPngInfo(filePath) {
  const stats = fs.statSync(filePath);
  const header = Buffer.alloc(24);
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!header.subarray(0, 8).equals(signature)) {
    throw new Error(`Screenshot is not a valid PNG: ${filePath}`);
  }
  return {
    bytes: stats.size,
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20)
  };
}

function assertScreenshotReady(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Screenshot was not created: ${filePath}`);
  }
  const info = readPngInfo(filePath);
  if (info.bytes < 25000) {
    throw new Error(`Screenshot is too small to read (${info.bytes} bytes)`);
  }
  if (info.width < 900 || info.height < 500) {
    throw new Error(`Screenshot is too small to read (${info.width}x${info.height})`);
  }
  return info;
}

function companyKey(row) {
  return [
    cleanText(row.websiteName || row.companyName || row.consignee).toLowerCase(),
    cleanText(row.country).toLowerCase()
  ].join("|");
}

function safeDecodeQueryText(value) {
  const text = String(value || "").replace(/\+/g, " ");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function cleanSearchQueryText(value) {
  return cleanText(safeDecodeQueryText(value))
    .replace(/\bVIETNAM,\s*DEMOCRATIC\s+REP\.?\s+OF\b/gi, "VIETNAM")
    .replace(/\bVIETNAM\s+DEMOCRATIC\s+REP\s+OF\b/gi, "VIETNAM")
    .replace(/\s*;\s*/g, " ")
    .replace(/\b([A-Z][a-z]+)\s+Collc\b/g, "$1 Co LLC")
    .replace(/\s+/g, " ")
    .trim();
}

function googleQueryTextFromUrl(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (!(host === "google.com" || host.endsWith(".google.com"))) {
      return "";
    }
    const rawAfterQ = text.match(/[?&](?:q|query)=([^#]+)/i)?.[1] || "";
    const rawQuery = rawAfterQ
      ? rawAfterQ.replace(/&(?:num|hl|source|sca_esv|ei|ved|oq|aqs|sclient|uact|gs_lcp|iflsig|gbv|biw|bih|dpr|start|filter|safe|client|rlz)=.*$/i, "")
      : (parsed.searchParams.get("q") || parsed.searchParams.get("query") || "");
    return cleanSearchQueryText(rawQuery);
  } catch (error) {
    return "";
  }
}

function googleQueryText(row) {
  const existingQuery = googleQueryTextFromUrl(row.consigneeUrl);
  if (existingQuery) {
    return existingQuery;
  }
  const query = [
    cleanText(row.websiteName || row.companyName || row.consignee),
    cleanText(row.country)
  ].filter(Boolean).join(" ");
  return cleanSearchQueryText(query);
}

function googleQueryUrl(row) {
  const query = googleQueryText(row);
  return query ? "https://www.google.com/search?num=10&hl=en&q=" + encodeURIComponent(query) : "";
}

function isBlockedUrl(value) {
  try {
    const parsed = new URL(value);
    return !["http:", "https:"].includes(parsed.protocol);
  } catch (error) {
    return true;
  }
}

function isNonWebsiteResultUrl(value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return true;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const blockedHosts = [
      "google",
      "googleusercontent",
      "gstatic",
      "facebook",
      "instagram",
      "linkedin",
      "youtube",
      "x.com",
      "twitter",
      "tiktok",
      "pinterest"
    ];
    return blockedHosts.some((blocked) => (
      blocked.includes(".")
        ? host === blocked || host.endsWith(`.${blocked}`)
        : host === `${blocked}.com` || host.startsWith(`${blocked}.`) || host.includes(`.${blocked}.`)
    ));
  } catch (error) {
    return true;
  }
}

function rawUrlText(value) {
  const text = cleanText(value);
  if (!text || /^none|null|n\/a$/i.test(text)) {
    return "";
  }
  const markdownMatch = text.match(/\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownMatch) {
    return markdownMatch[1].replace(/[.,;:)\]\u2190-\u21ff]+$/g, "");
  }
  const urlMatch = text.match(/https?:\/\/[^\s<>\])"'`]+/i);
  if (urlMatch) {
    return urlMatch[0].replace(/[.,;:)\]\u2190-\u21ff]+$/g, "");
  }
  return text;
}

function normalizeUrl(value) {
  const text = rawUrlText(value);
  if (!text || /^none|null|n\/a$/i.test(text)) {
    return "";
  }
  try {
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(url);
    if (isBlockedUrl(parsed.href)) {
      return "";
    }
    parsed.hash = "";
    return parsed.href;
  } catch (error) {
    return "";
  }
}

function normalizeFirstResultUrl(value) {
  const text = rawUrlText(value);
  if (!text || /^none|null|n\/a$/i.test(text)) {
    return "";
  }
  try {
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(url);
    if (isNonWebsiteResultUrl(parsed.href)) {
      return "";
    }
    parsed.hash = "";
    return parsed.href;
  } catch (error) {
    return "";
  }
}

function sameUrl(left, right) {
  const leftUrl = normalizeFirstResultUrl(left);
  const rightUrl = normalizeFirstResultUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}

function sameSite(left, right) {
  try {
    const leftUrl = new URL(normalizeFirstResultUrl(left));
    const rightUrl = new URL(normalizeFirstResultUrl(right));
    const cleanHost = (host) => host.toLowerCase().replace(/^www\./, "");
    return cleanHost(leftUrl.hostname) === cleanHost(rightUrl.hostname);
  } catch (error) {
    return false;
  }
}

function normalizeEmail(value) {
  const text = cleanText(value).replace(/^mailto:/i, "").toLowerCase();
  if (/^none|null|n\/a$/i.test(text)) {
    return "";
  }
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) {
    return "";
  }
  const domain = text.split("@")[1];
  return isBlockedUrl(`https://${domain}`) ? "" : text;
}

function normalizeFirstResultEmail(value) {
  const text = cleanText(value).replace(/^mailto:/i, "").toLowerCase();
  if (/^none|null|n\/a$/i.test(text)) {
    return "";
  }
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(text) ? text : "";
}

function normalizePhone(value) {
  const text = cleanText(value)
    .replace(/^tel:/i, "")
    .replace(/^(phone|mobile|tel|telephone|whatsapp)\.?\s*[:：-]?\s*/i, "");
  if (/^none|null|n\/a$/i.test(text)) {
    return "";
  }
  if (/[*•●·….]|\bx{2,}\b|\bhidden\b|\bmasked\b|\bprotected\b|\bpartial\b/i.test(text)) {
    return "";
  }
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 16 ? text : "";
}

function repairLooseJsonText(value) {
  const source = String(value || "");
  let output = "";
  let quoted = false;
  let escaped = false;
  for (const char of source) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      output += char;
      continue;
    }
    if (quoted && (char === "\n" || char === "\r" || char === "\t")) {
      continue;
    }
    output += char;
  }
  return output;
}

function parseJsonCandidate(value) {
  const text = String(value || "");
  try {
    return JSON.parse(text);
  } catch (error) {
    const repaired = repairLooseJsonText(text);
    if (repaired === text) {
      throw error;
    }
    return JSON.parse(repaired);
  }
}

function parseJsonObjects(value) {
  const text = String(value || "").trim();
  const source = text;
  const output = [];
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted) {
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            output.push(parseJsonCandidate(source.slice(start, index + 1)));
          } catch (error) {
            // Continue scanning later JSON objects.
          }
          start = index;
          break;
        }
      }
    }
  }
  return output;
}

function parseJsonArrays(value) {
  const text = String(value || "").trim();
  const source = text;
  const output = [];
  for (let start = source.indexOf("["); start >= 0; start = source.indexOf("[", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted) {
        continue;
      }
      if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = parseJsonCandidate(source.slice(start, index + 1));
            if (Array.isArray(parsed)) {
              output.push(parsed);
            }
          } catch (error) {
            // Continue scanning later JSON arrays.
          }
          start = index;
          break;
        }
      }
    }
  }
  return output;
}

function parseJsonObject(value) {
  return parseJsonObjects(value)[0] || {};
}

function isChatGPTResult(value) {
  return Boolean(
    value
    && typeof value === "object"
    && cleanText(value.company_name)
    && [
      value.website_url,
      value.websiteUrl,
      value.phone_number,
      value.phone,
      value.email,
      value.source_url,
      value.notes
    ].some((field) => cleanText(field))
  );
}

function isChatGPTBatchResult(value) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(value, key);
  return Boolean(
    value
    && typeof value === "object"
    && cleanText(value.batch_id || value.id)
    && (hasOwn("website_url") || hasOwn("websiteUrl"))
    && (hasOwn("phone_number") || hasOwn("phone"))
    && hasOwn("email")
  );
}

function orderedBatchResults(objects, expectedIds) {
  const ids = Array.isArray(expectedIds) ? expectedIds.map(cleanText).filter(Boolean) : [];
  if (!ids.length) {
    return objects;
  }
  const byId = new Map();
  for (const object of objects) {
    const id = cleanText(object.batch_id || object.id);
    if (id && !byId.has(id)) {
      byId.set(id, object);
    }
  }
  if (!ids.every((id) => byId.has(id))) {
    return [];
  }
  return ids.map((id) => byId.get(id));
}

function parseChatGPTBatchResults(value, expectedCount = 0, expectedIds = []) {
  const arrays = parseJsonArrays(value);
  const minimum = Math.max(1, Math.floor(Number(expectedCount || 0)) || 1);
  for (const array of arrays.reverse()) {
    const objects = array.filter(isChatGPTBatchResult);
    const ordered = orderedBatchResults(objects, expectedIds);
    if (ordered.length >= minimum) {
      return expectedCount ? ordered.slice(0, expectedCount) : ordered;
    }
    if (!expectedIds.length && objects.length >= minimum) {
      return expectedCount ? objects.slice(0, expectedCount) : objects;
    }
  }
  const objects = parseJsonObjects(value).filter(isChatGPTBatchResult);
  const ordered = orderedBatchResults(objects, expectedIds);
  if (ordered.length >= minimum) {
    return expectedCount ? ordered.slice(0, expectedCount) : ordered;
  }
  return !expectedIds.length && objects.length >= minimum
    ? (expectedCount ? objects.slice(0, expectedCount) : objects)
    : [];
}

function normalizedResult(parsed, row, sourceUrl) {
  const websiteUrl = normalizeUrl(parsed.website_url || parsed.websiteUrl);
  return {
    company_name: cleanText(parsed.company_name || row.websiteName || row.companyName || row.consignee),
    website_url: websiteUrl,
    phone_number: websiteUrl ? normalizePhone(parsed.phone_number || parsed.phone) : "",
    email: websiteUrl ? normalizeEmail(parsed.email) : "",
    source_url: websiteUrl ? (normalizeUrl(parsed.source_url || sourceUrl) || websiteUrl) : "",
    confidence: Number(parsed.confidence || 0),
    notes: cleanText(parsed.notes)
  };
}

function normalizedFirstResult(parsed, row, sourceUrl) {
  const websiteUrl = normalizeFirstResultUrl(parsed.website_url || parsed.websiteUrl || sourceUrl);
  return {
    company_name: cleanText(parsed.company_name || row.websiteName || row.companyName || row.consignee),
    website_url: websiteUrl,
    phone_number: websiteUrl ? normalizePhone(parsed.phone_number || parsed.phone) : "",
    email: websiteUrl ? normalizeFirstResultEmail(parsed.email) : "",
    source_url: websiteUrl ? (normalizeFirstResultUrl(parsed.source_url || sourceUrl) || websiteUrl) : "",
    confidence: Number(parsed.confidence || 0),
    notes: cleanText(parsed.notes)
  };
}

function batchId(position) {
  return `Q${String(position + 1).padStart(3, "0")}`;
}

function batchResultPrompt(items) {
  const inputJson = JSON.stringify(items.map((item) => ({
    batch_id: item.batchId,
    query: item.queryText
  })), null, 2);

  return [
    "Find the first Google organic website URL, then scrape that selected website/domain for phone and email.",
    "Return ONLY one valid JSON array. No markdown, no prose, no code fences, no extra text.",
    `The array must contain exactly ${items.length} objects, in the same order as the inputs.`,
    "Every object must use exactly these keys:",
    '{"batch_id":"","website_url":"","phone_number":"","email":""}',
    "Rules:",
    "- Never refuse, apologize, explain limitations, or say you cannot browse. If a field cannot be verified, return an empty string for that field and still return JSON.",
    "- Copy batch_id exactly.",
    "- Search the exact query like a normal Google search.",
    "- Read results top to bottom and pick the first real organic website/page URL.",
    "- Skip ads, maps/local pack, AI answers, Google-owned pages, social profiles, and video pages like LinkedIn, Facebook, Instagram, YouTube, X/Twitter, TikTok, Pinterest.",
    "- Do not pick a nicer, official, cleaner, related, or later URL. website_url must be the first valid organic result.",
    "- Lock website_url. Never change it while finding phone/email.",
    "- Before returning phone/email, fully scrape/crawl the selected website_url domain first. Do not stop at only the selected page.",
    "- Check the full selected website/domain: selected page, homepage, header, footer, visible text, tables, FAQ, buttons, mailto/tel links, page source snippets, sitemap, and same-domain contact/about/location/branch/support/inquiry/privacy/terms pages.",
    "- Follow same-domain navigation/footer/contact links that may contain phone/email. Finish this website/domain scrape before using deep-search.",
    "- If website_url is a portal, directory, company profile, listing, marketplace, trade-data page, or generic website page, use any complete phone/email visible on that selected URL/domain, including footer/support/site-owner contact. It is valid because it belongs to website_url/domain.",
    "- Only if phone/email is not found after full website_url/domain scraping, then deep-search/web-search exact website_url, domain, page title, and company/listing name with phone/email/contact.",
    "- Use deep-search contact only when it clearly belongs to the same website_url/domain/company/listing. Keep website_url unchanged.",
    "- Never use contact from an unrelated domain or unrelated company. Never guess.",
    "- If website_url is not found, return empty strings for website_url, phone_number, and email.",
    "- If phone or email is not found after website scraping plus deep/web search, use an empty string for that field.",
    "- Phone/email must be complete and readable. No hidden, partial, masked, protected, guessed, or placeholder values.",
    "- Use raw URLs only. Do not wrap URLs in markdown. Do not add extra keys.",
    "Input JSON:",
    inputJson
  ].join("\n");
}

async function findPromptBox(page) {
  const selectors = [
    '[data-testid="prompt-textarea"]',
    '#prompt-textarea',
    '.ProseMirror[contenteditable="true"]',
    '[data-lexical-editor="true"]',
    '[contenteditable="plaintext-only"]',
    '[contenteditable="true"][data-placeholder*="Ask" i]',
    '[contenteditable="true"][aria-placeholder*="Ask" i]',
    '[contenteditable="true"][aria-label*="Ask" i]',
    '[role="textbox"][contenteditable="true"]',
    'textarea[placeholder*="Ask"]',
    'textarea[aria-label*="Ask" i]',
    '[aria-label="Chat with ChatGPT"]',
    'textarea[aria-label*="prompt" i]',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count() && await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function isLikelyChatGptLoginPage(page) {
  const url = page.url();
  if (/auth\.openai\.com|\/auth\/login|\/login/i.test(url)) {
    return true;
  }
  const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
  return /\b(log in|sign in|sign up|continue with google|continue with microsoft)\b/i.test(bodyText)
    && !/\b(new chat|ask anything|message chatgpt)\b/i.test(bodyText);
}

async function clickPromptBox(page, errorMessage) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const box = await findPromptBox(page);
    if (!box) {
      await page.waitForTimeout(700);
      continue;
    }
    try {
      await box.click({ timeout: 6000 });
      return box;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(700);
    }
  }
  throw new Error(lastError ? cleanText(lastError.message || lastError) : errorMessage);
}

function shouldClearRejectedContact(result) {
  const notes = cleanText(result.notes).toLowerCase();
  const badContact = "rejected|generic|support|corporate|not specific|not tied|not verified|not originate|portal support|not target company|not the target|portal owner|directory owner";
  return new RegExp(`\\b(returned|output|selected)\\s+(phone|email|contact|value)\\b.{0,80}\\b(${badContact})\\b`).test(notes)
    || new RegExp(`\\b(phone|email|contact|value)\\b\\s+(is|was|appears|seems|looks)\\b.{0,80}\\b(${badContact})\\b`).test(notes)
    || /\bdo not use\b.{0,40}\b(phone|email|contact|value)\b/.test(notes);
}

function pasteShortcut() {
  return process.platform === "darwin" ? "Meta+V" : "Control+V";
}

async function attachmentSignal(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 8
        && rect.height > 8
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) !== 0;
    };
    const roots = Array.from(document.querySelectorAll([
      "input-container",
      "input-area-v2",
      "[data-node-type='input-area']",
      "fieldset.input-area-container"
    ].join(",")));
    const root = roots.find(isVisible) || roots[0] || document;
    const selector = [
      "img:not(.user-icon)",
      "canvas",
      "video",
      "mat-chip",
      "[data-test-id*='file' i]",
      "[data-test-id*='attachment' i]",
      "[data-test-id*='image' i]",
      "[data-test-id*='upload' i]",
      "[aria-label*='file' i]",
      "[aria-label*='remove file' i]",
      "[aria-label*='remove image' i]",
      "[aria-label*='attachment' i]",
      "[aria-label*='attached' i]",
      "[class*='file' i]",
      "[class*='upload' i]",
      "[class*='preview' i]",
      "[class*='file-preview' i]",
      "[class*='image-preview' i]",
      "[class*='attachment' i]",
      "[class*='upload-preview' i]",
      "file-preview",
      "upload-preview",
      "image-preview"
    ].join(",");
    const fingerprints = Array.from(root.querySelectorAll(selector))
      .filter((element) => {
        if (!isVisible(element)) {
          return false;
        }
        const label = element.getAttribute("aria-label") || "";
        const testId = element.getAttribute("data-test-id") || "";
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        return !/upload and tools|microphone|mode picker|enter a prompt/i.test(`${label} ${testId} ${text}`);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label = element.getAttribute("aria-label") || "";
        const testId = element.getAttribute("data-test-id") || "";
        const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
        const image = element.tagName === "IMG"
          ? `${element.getAttribute("src") || ""}:${element.naturalWidth || 0}x${element.naturalHeight || 0}`
          : "";
        return [
          element.tagName,
          label,
          testId,
          text,
          image,
          Math.round(rect.width),
          Math.round(rect.height)
        ].join("|");
      })
      .sort();
    return {
      count: fingerprints.length,
      fingerprint: fingerprints.join("\n")
    };
  }).catch(() => ({ count: 0, fingerprint: "" }));
}

async function attachmentBusySignal(page) {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll([
      "input-container",
      "input-area-v2",
      "[data-node-type='input-area']",
      "fieldset.input-area-container"
    ].join(",")));
    const root = roots[0] || document;
    const text = (root.textContent || "").toLowerCase();
    const busy = root.querySelectorAll([
      "[aria-busy='true']",
      "[role='progressbar']",
      "mat-progress-spinner",
      "[class*='progress' i]",
      "[class*='loading' i]",
      "[class*='uploading' i]"
    ].join(",")).length > 0;
    return busy || /uploading|processing|attaching|scanning/.test(text);
  }).catch(() => false);
}

async function waitForAttachmentReady(page, beforeSignal, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastFingerprint = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const signal = await attachmentSignal(page);
    if (signal.count > beforeSignal.count && signal.fingerprint !== beforeSignal.fingerprint) {
      const busy = await attachmentBusySignal(page);
      if (!busy && signal.fingerprint === lastFingerprint) {
        stableSince = stableSince || Date.now();
        if (Date.now() - stableSince >= 1200) {
          return signal;
        }
      } else {
        stableSince = 0;
        lastFingerprint = signal.fingerprint;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error("ChatGPT did not show a ready screenshot attachment");
}

async function promptRoot(box) {
  const candidates = [
    box.locator("xpath=ancestor::input-container[1]"),
    box.locator("xpath=ancestor::fieldset[contains(@class, 'input-area-container')][1]"),
    box.locator("xpath=ancestor::*[@data-node-type='input-area'][1]"),
    box.locator("xpath=ancestor::*[.//button][1]")
  ];
  for (const candidate of candidates) {
    if (await candidate.count().catch(() => 0)) {
      return candidate.first();
    }
  }
  return box;
}

async function dispatchImagePasteEvent(box, screenshotPath) {
  const base64 = fs.readFileSync(screenshotPath).toString("base64");
  await box.evaluate(async (element, pngBase64) => {
    const binary = atob(pngBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const file = new File([bytes], "google-search-screenshot.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer
    });
    element.dispatchEvent(event);
  }, base64);
}

async function dispatchImageDropEvent(box, screenshotPath) {
  const root = await promptRoot(box);
  const base64 = fs.readFileSync(screenshotPath).toString("base64");
  await root.evaluate(async (element, pngBase64) => {
    const binary = atob(pngBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const file = new File([bytes], "google-search-screenshot.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    for (const type of ["dragenter", "dragover", "drop"]) {
      element.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer
      }));
    }
  }, base64);
}

async function setScreenshotOnExistingFileInput(page, screenshotPath, beforeSignal) {
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    const accept = await input.getAttribute("accept").catch(() => "");
    if (accept && !/(image|png|jpe?g|\*)/i.test(accept)) {
      continue;
    }
    await input.setInputFiles(screenshotPath);
    return waitForAttachmentReady(page, beforeSignal, 18000);
  }
  throw new Error("No ChatGPT image file input was available");
}

async function openUploadMenu(page) {
  const candidates = [
    page.getByRole("button", { name: /upload and tools/i }).last(),
    page.locator('button[aria-label*="Upload and tools" i]').last(),
    page.locator('gem-icon-button[arialabel*="Upload and tools" i] button').last(),
    page.locator('button:has(mat-icon[fonticon="plus"])').last()
  ];
  for (const candidate of candidates) {
    if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) {
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 1200 }).catch(() => null);
      await candidate.click().catch(() => {});
      const chooser = await chooserPromise;
      if (chooser) {
        return chooser;
      }
      await page.waitForTimeout(800);
      return null;
    }
  }
  throw new Error("ChatGPT upload button was not found");
}

async function uploadScreenshotFromMenu(page, screenshotPath, beforeSignal) {
  const directChooser = await openUploadMenu(page);
  if (directChooser) {
    await directChooser.setFiles(screenshotPath);
    return waitForAttachmentReady(page, beforeSignal, 18000);
  }
  const directInputSignal = await setScreenshotOnExistingFileInput(page, screenshotPath, beforeSignal).catch(() => null);
  if (directInputSignal) {
    return directInputSignal;
  }
  const candidates = [
    page.getByRole("menuitem", { name: /upload|file|image|computer/i }).last(),
    page.locator('[role="menuitem"], [role="option"]').filter({ hasText: /upload|file|image|computer/i }).last(),
    page.locator("button").filter({ hasText: /upload|file|image|computer/i }).last()
  ];
  for (const candidate of candidates) {
    if (!(await candidate.count().catch(() => 0)) || !(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 3500 }).catch(() => null);
    await candidate.click().catch(() => {});
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(screenshotPath);
      return waitForAttachmentReady(page, beforeSignal, 18000);
    }
  }
  return setScreenshotOnExistingFileInput(page, screenshotPath, beforeSignal);
}

async function pasteScreenshot(page, screenshotPath, debugBasePath) {
  assertScreenshotReady(screenshotPath);
  const box = await clickPromptBox(page, "ChatGPT prompt box not found before screenshot paste");
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin }).catch(() => {});
  const base64 = fs.readFileSync(screenshotPath).toString("base64");
  const beforeSignal = await attachmentSignal(page);
  const attempts = [];
  const tryAttachment = async (label, action) => {
    try {
      await action();
      return await waitForAttachmentReady(page, beforeSignal);
    } catch (error) {
      const current = await attachmentSignal(page);
      if (current.count > beforeSignal.count && current.fingerprint !== beforeSignal.fingerprint) {
        return current;
      }
      attempts.push(`${label}: ${cleanText(error?.message || error)}`);
      return null;
    }
  };

  let signal = await tryAttachment("clipboard", async () => {
    await page.evaluate(async (pngBase64) => {
      if (!window.ClipboardItem || !navigator.clipboard?.write) {
        throw new Error("Image clipboard API is unavailable");
      }
      const binary = atob(pngBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
    }, base64);
    await page.keyboard.press(pasteShortcut());
  });

  if (!signal) {
    signal = await tryAttachment("paste event", async () => {
      await dispatchImagePasteEvent(box, screenshotPath);
    });
  }
  if (!signal) {
    signal = await tryAttachment("drop event", async () => {
      await dispatchImageDropEvent(box, screenshotPath);
    });
  }
  if (!signal) {
    signal = await tryAttachment("file input", async () => {
      await setScreenshotOnExistingFileInput(page, screenshotPath, beforeSignal);
    });
  }
  if (!signal) {
    signal = await tryAttachment("upload menu", async () => {
      await uploadScreenshotFromMenu(page, screenshotPath, beforeSignal);
    });
  }
  if (!signal) {
    if (debugBasePath) {
      await page.screenshot({ path: `${debugBasePath}-screenshot-attach-failed.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`${debugBasePath}-screenshot-attach-failed.html`, await page.content().catch(() => ""));
    }
    throw new Error(`ChatGPT screenshot attachment failed. ${attempts.join(" | ")}`);
  }
  return signal;
}

async function fillPrompt(page, prompt) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const box = await clickPromptBox(page, "ChatGPT prompt box not found. Complete login in the Playwright Chrome window.");
      const tagName = await box.evaluate((element) => element.tagName);
      if (tagName === "TEXTAREA") {
        await box.fill(prompt, { timeout: 8000 });
      } else {
        await box.fill(prompt, { timeout: 8000 }).catch(async () => {
          await box.evaluate((element, value) => {
            element.textContent = value;
            element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
          }, prompt);
        });
      }
      const written = tagName === "TEXTAREA"
        ? await box.inputValue().catch(() => "")
        : await box.innerText().catch(() => "");
      if (cleanText(written).includes(cleanText(prompt).slice(-80))) {
        return;
      }
      throw new Error("ChatGPT prompt text was not fully written");
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(800);
    }
  }
  throw new Error(`ChatGPT prompt fill failed: ${cleanText(lastError?.message || lastError)}`);
}

async function ensureScreenshotStillAttached(page, attachedSignal, debugBasePath) {
  const current = await attachmentSignal(page);
  const attachedLines = String(attachedSignal?.fingerprint || "").split("\n").filter(Boolean);
  const hasAttachedFingerprint = attachedLines.some((line) => current.fingerprint.includes(line));
  if (!attachedSignal || current.count < attachedSignal.count || (attachedLines.length && !hasAttachedFingerprint)) {
    if (debugBasePath) {
      await page.screenshot({ path: `${debugBasePath}-screenshot-missing-before-send.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`${debugBasePath}-screenshot-missing-before-send.html`, await page.content().catch(() => ""));
    }
    throw new Error("Screenshot attachment disappeared before ChatGPT send");
  }
}

async function findSendButton(page, box) {
  const explicit = [
    page.getByRole("button", { name: /send/i }).last(),
    page.locator('button[aria-label*="Send" i]').last(),
    page.locator('button[data-test-id*="send" i], [data-test-id*="send" i] button').last()
  ];
  for (const candidate of explicit) {
    if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  const root = await promptRoot(box);
  const buttons = root.locator("button:not([disabled])");
  const count = await buttons.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }
    const meta = await button.evaluate((element) => {
      const icon = element.querySelector("mat-icon");
      return [
        element.getAttribute("aria-label") || "",
        element.getAttribute("data-test-id") || "",
        element.textContent || "",
        icon?.getAttribute("fonticon") || "",
        icon?.textContent || ""
      ].join(" ");
    }).catch(() => "");
    if (/send|arrow_upward|arrow_upward_alt/i.test(meta)
      && !/upload|tool|microphone|mic|mode|menu|attach/i.test(meta)) {
      return button;
    }
  }
  return null;
}

async function sendPrompt(page, prompt, debugBasePath, attachedSignal) {
  const box = await clickPromptBox(page, "ChatGPT prompt box not found before send.");
  if (attachedSignal) {
    await ensureScreenshotStillAttached(page, attachedSignal, debugBasePath);
  }
  const tagName = await box.evaluate((element) => element.tagName);
  await page.waitForTimeout(500);
  const sendButton = await findSendButton(page, box);
  if (sendButton) {
    await sendButton.click();
  } else {
    await box.press("Enter");
  }
  await page.waitForTimeout(2200);
  let remaining = tagName === "TEXTAREA"
    ? await box.inputValue().catch(() => "")
    : await box.innerText().catch(() => "");
  if (cleanText(remaining).includes(cleanText(prompt).slice(-80))) {
    if (debugBasePath) {
      await page.screenshot({ path: `${debugBasePath}-chatgpt-send-failed.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`${debugBasePath}-chatgpt-send-failed.html`, await page.content().catch(() => ""));
    }
    throw new Error("ChatGPT prompt was filled, but the Send button was not activated");
  }
}

async function waitForChatGPTJson(page, timeoutMs, debugBasePath) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const blocks = await page.locator("pre, code").allTextContents().catch(() => []);
    for (const candidate of [...blocks].reverse()) {
      const parsed = parseJsonObjects(candidate).reverse().find(isChatGPTResult);
      if (parsed) {
        return parsed;
      }
    }
    const mainText = await page.locator("body").innerText().catch(() => "");
    const blockingMessage = chatgptBlockingMessage(mainText);
    if (blockingMessage) {
      if (debugBasePath) {
        await page.screenshot({ path: `${debugBasePath}-chatgpt-blocked.png`, fullPage: true }).catch(() => {});
        fs.writeFileSync(`${debugBasePath}-chatgpt-blocked.txt`, mainText);
      }
      throw new Error(blockingMessage);
    }
    const immediateParsed = parseJsonObjects(mainText.slice(-40000)).reverse().find(isChatGPTResult);
    if (immediateParsed) {
      return immediateParsed;
    }
    if (mainText && mainText === lastText) {
      stableSince = stableSince || Date.now();
      if (Date.now() - stableSince > 900) {
        const parsed = parseJsonObjects(mainText.slice(-20000)).reverse().find(isChatGPTResult);
        if (parsed) {
          return parsed;
        }
      }
    } else {
      lastText = mainText;
      stableSince = 0;
    }
    await page.waitForTimeout(350);
  }
  if (debugBasePath) {
    fs.writeFileSync(`${debugBasePath}-chatgpt-timeout.txt`, lastText);
  }
  throw new Error("ChatGPT JSON response timed out");
}

async function waitForChatGPTBatchJson(page, expectedCount, timeoutMs, debugBasePath, expectedIds = []) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const blocks = await page.locator("pre, code").allTextContents().catch(() => []);
    for (const candidate of [...blocks].reverse()) {
      const parsed = parseChatGPTBatchResults(candidate, expectedCount, expectedIds);
      if (parsed.length) {
        return parsed;
      }
    }
    const mainText = await page.locator("body").innerText().catch(() => "");
    const blockingMessage = chatgptBlockingMessage(mainText);
    if (blockingMessage) {
      if (debugBasePath) {
        await page.screenshot({ path: `${debugBasePath}-chatgpt-blocked.png`, fullPage: true }).catch(() => {});
        fs.writeFileSync(`${debugBasePath}-chatgpt-blocked.txt`, mainText);
      }
      throw new Error(blockingMessage);
    }
    const immediateParsed = parseChatGPTBatchResults(mainText.slice(-120000), expectedCount, expectedIds);
    if (immediateParsed.length) {
      return immediateParsed;
    }
    if (mainText && mainText === lastText) {
      stableSince = stableSince || Date.now();
      if (Date.now() - stableSince > 900) {
        const parsed = parseChatGPTBatchResults(mainText.slice(-60000), expectedCount, expectedIds);
        if (parsed.length) {
          return parsed;
        }
      }
    } else {
      lastText = mainText;
      stableSince = 0;
    }
    await page.waitForTimeout(350);
  }
  if (debugBasePath) {
    fs.writeFileSync(`${debugBasePath}-chatgpt-batch-timeout.txt`, lastText);
  }
  throw new Error("ChatGPT batch JSON response timed out");
}

function chatgptBlockingMessage(value) {
  const text = String(value || "").slice(-16000);
  if (!text) {
    return "";
  }
  if (/you(?:'| a)?ve reached (?:your )?(?:limit|usage limit)|rate limit|too many requests|quota exceeded|try again later/i.test(text)) {
    return "ChatGPT limit reached or rate limited";
  }
  if (/storage (?:is )?full|not enough storage|data (?:is )?full|browser data full/i.test(text)) {
    return "ChatGPT browser storage/data is full";
  }
  if (/something went wrong|server error|couldn(?:'|\u2019)?t complete|response stopped|failed to generate/i.test(text)) {
    return "ChatGPT showed a server/response error";
  }
  return "";
}

function numericEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function booleanEnv(name, fallback) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

function isChatGptUiUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "chatgpt.com"
      || host.endsWith(".chatgpt.com")
      || host === "openai.com"
      || host.endsWith(".openai.com")
      || host === "oaistatic.com"
      || host.endsWith(".oaistatic.com")
      || host === "oaiusercontent.com"
      || host.endsWith(".oaiusercontent.com");
  } catch (error) {
    return false;
  }
}

async function selectChatGptHighMode(page) {
  const opened = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const modeText = /^(auto|fast|standard|instant|medium|high)$/i;
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 8
        && rect.height > 8;
    };
    const prompt = document.querySelector([
      '[data-testid="prompt-textarea"]',
      'textarea[placeholder*="Ask"]',
      '[aria-label="Chat with ChatGPT"]',
      '[contenteditable="true"]'
    ].join(","));
    let root = prompt?.closest("form") || prompt?.parentElement || document;
    for (let depth = 0; depth < 5 && root?.parentElement; depth += 1) {
      const buttons = Array.from(root.querySelectorAll("button,[role='button']"));
      if (buttons.some((button) => visible(button) && modeText.test(clean(button.innerText || button.textContent)))) {
        break;
      }
      root = root.parentElement;
    }
    const buttons = Array.from(root.querySelectorAll("button,[role='button']"))
      .filter(visible)
      .filter((button) => {
        const text = clean(button.innerText || button.textContent);
        const label = clean(button.getAttribute("aria-label") || button.getAttribute("title") || "");
        const meta = `${text} ${label}`;
        if (/send|microphone|voice|attach|file|image|plus|\+|tools/i.test(meta)) {
          return false;
        }
        return modeText.test(text) || /\b(reason|reasoning|thinking|mode|effort|model)\b/i.test(label);
      });
    if (buttons.some((button) => /(^|\s)high(\s|$)/i.test(clean(button.innerText || button.textContent)))) {
      return "already";
    }
    const control = buttons.find((button) => /^(auto|fast|standard|instant|medium)$/i.test(clean(button.innerText || button.textContent)))
      || buttons.find((button) => /\b(reason|reasoning|thinking|mode|effort|model)\b/i.test(clean(button.getAttribute("aria-label") || button.getAttribute("title") || "")));
    if (!control) {
      return "";
    }
    control.click();
    return "opened";
  }).catch(() => "");

  if (opened === "already") {
    return "High";
  }
  if (!opened) {
    return "";
  }
  await page.waitForTimeout(700);
  const selected = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 8
        && rect.height > 8;
    };
    const candidates = Array.from(document.querySelectorAll([
      "button",
      "[role='button']",
      "[role='menuitem']",
      "[role='option']"
    ].join(",")));
    const high = candidates.find((element) => visible(element) && /^high$/i.test(clean(element.innerText || element.textContent)));
    if (!high) {
      return false;
    }
    high.click();
    return true;
  }).catch(() => false);
  if (selected) {
    await page.waitForTimeout(500);
    return "High";
  }
  return "";
}

function clearProfileCaches(profileDir) {
  if (["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]
    .some((name) => fs.existsSync(path.join(profileDir, name)))) {
    return;
  }
  let profileNames = [];
  try {
    profileNames = fs.existsSync(profileDir)
      ? fs.readdirSync(profileDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && (entry.name === "Default" || /^Profile \d+$/.test(entry.name)))
        .map((entry) => entry.name)
      : [];
  } catch (error) {
    return;
  }
  const remove = (targetPath) => {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (error) {
      // Cache cleanup is best-effort; a locked cache must not block the agent.
    }
  };
  const cachePaths = [
    "Cache",
    "Code Cache",
    "GPUCache",
    path.join("Service Worker", "CacheStorage"),
    path.join("Service Worker", "ScriptCache")
  ];
  for (const profileName of profileNames) {
    for (const relativePath of cachePaths) {
      remove(path.join(profileDir, profileName, relativePath));
    }
  }
  for (const relativePath of ["GrShaderCache", "GraphiteDawnCache", "ShaderCache", "component_crx_cache"]) {
    remove(path.join(profileDir, relativePath));
  }
}

let memorySample = { measuredAt: 0, availableMb: 0 };

function availableMemoryMb() {
  if (Date.now() - memorySample.measuredAt < 1500) {
    return memorySample.availableMb;
  }
  let availableBytes = os.freemem();
  try {
    if (process.platform === "darwin") {
      const output = execFileSync("/usr/bin/memory_pressure", ["-Q"], {
        encoding: "utf8",
        timeout: 1500,
        stdio: ["ignore", "pipe", "ignore"]
      });
      const percentage = Number(output.match(/free percentage:\s*(\d+)/i)?.[1]);
      if (Number.isFinite(percentage)) {
        availableBytes = os.totalmem() * percentage / 100;
      }
    } else if (process.platform === "linux" && fs.existsSync("/proc/meminfo")) {
      const availableKb = Number(fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m)?.[1]);
      if (Number.isFinite(availableKb)) {
        availableBytes = availableKb * 1024;
      }
    }
  } catch (error) {
    // Fall back to Node's native free-memory reading.
  }
  memorySample = {
    measuredAt: Date.now(),
    availableMb: Math.max(0, Math.floor(availableBytes / (1024 * 1024)))
  };
  return memorySample.availableMb;
}

function totalMemoryMb() {
  return Math.max(1, Math.floor(os.totalmem() / (1024 * 1024)));
}

function defaultSystemReserveMemoryMb(totalMb = totalMemoryMb()) {
  return Math.max(1536, Math.floor(totalMb * 0.2));
}

function hardwareParallelismCap(totalMb = totalMemoryMb(), cpuCount = os.cpus().length || 4) {
  const memoryCap = totalMb <= 6144
    ? 2
    : (totalMb <= 10240
      ? 3
      : (totalMb <= 16384
        ? 5
        : (totalMb <= 24576 ? 7 : 10)));
  const cpuCap = cpuCount <= 4
    ? 2
    : (cpuCount <= 8 ? 5 : (cpuCount <= 12 ? 8 : 10));
  return Math.max(1, Math.min(memoryCap, cpuCap));
}

function adaptiveParallelismLimit({
  requested,
  entriesCount,
  totalMb = totalMemoryMb(),
  freeMb = availableMemoryMb(),
  cpuCount = os.cpus().length || 4,
  maxParallelism = 10,
  pageMemoryMb = 700,
  systemReserveMemoryMb = defaultSystemReserveMemoryMb(totalMb),
  auto = true
}) {
  const requestedCount = Math.max(1, Math.floor(Number(requested) || 1));
  const entryCount = Math.max(1, Math.floor(Number(entriesCount) || 1));
  const configuredMax = Math.max(1, Math.floor(Number(maxParallelism) || requestedCount));
  const base = Math.min(requestedCount, entryCount, configuredMax);
  if (!auto) {
    return base;
  }
  const usableFreeMb = Math.max(0, Number(freeMb || 0) - Number(systemReserveMemoryMb || 0));
  const memoryCap = usableFreeMb > 0
    ? Math.max(1, Math.floor(usableFreeMb / Math.max(256, Number(pageMemoryMb || 700))))
    : 1;
  return Math.max(1, Math.min(
    base,
    memoryCap,
    hardwareParallelismCap(Number(totalMb || 0), Number(cpuCount || 1))
  ));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function googleCaptchaMessage(page) {
  const url = page.url();
  let isSorryUrl = false;
  try {
    const parsed = new URL(url);
    isSorryUrl = parsed.hostname.includes("google.") && parsed.pathname.startsWith("/sorry");
  } catch (error) {
    isSorryUrl = false;
  }
  const bodyText = await page.locator("body").innerText({ timeout: 2500 }).catch(() => "");
  if (isSorryUrl || /our systems have detected unusual traffic|i'?m not a robot|recaptcha|google automatically detects requests/i.test(bodyText)) {
    return "Google CAPTCHA/rate limit detected. Slow down or wait before continuing.";
  }
  return "";
}

function rowCompanyName(row) {
  return cleanText(row.websiteName || row.companyName || row.consignee);
}

function workerMessage(workerIndex, parallelism, message) {
  return parallelism > 1 ? `Worker ${workerIndex + 1}: ${message}` : message;
}

function applySkippedResult(output, entry, message) {
  for (const index of entry.indexes) {
    output[index] = {
      ...output[index],
      websiteUrl: "",
      email: "",
      phone: "",
      contactSource: `ChatGPT Playwright skipped: ${message}`
    };
  }
}

function applyChatGPTResult(output, entry, result, resultListPath) {
  for (const index of entry.indexes) {
    output[index] = {
      ...output[index],
      websiteUrl: result.website_url,
      email: result.email,
      phone: result.phone_number,
      contactSource: [
        "ChatGPT Playwright",
        result.source_url,
        resultListPath,
        result.notes
      ].filter(Boolean).join("; ")
    };
  }
}

function batchFallbackResult(item, reason) {
  const row = item.entry.row;
  return {
    batch_id: item.batchId,
    company_name: rowCompanyName(row),
    website_url: "",
    phone_number: "",
    email: "",
    source_url: "",
    confidence: 0,
    notes: cleanText(reason || "No ChatGPT batch JSON result")
  };
}

function applyBatchChatGPTResult(output, item, parsed, reason) {
  const parsedWebsiteUrl = parsed && typeof parsed === "object"
    ? normalizeFirstResultUrl(parsed.website_url || parsed.websiteUrl)
    : "";
  const parsedSourceUrl = parsed && typeof parsed === "object"
    ? normalizeFirstResultUrl(parsed.source_url)
    : "";
  const source = parsed && typeof parsed === "object"
    ? {
      ...parsed,
      batch_id: cleanText(parsed.batch_id || parsed.id || item.batchId),
      company_name: cleanText(parsed.company_name) || rowCompanyName(item.entry.row),
      website_url: parsedWebsiteUrl,
      source_url: parsedSourceUrl || parsedWebsiteUrl,
      notes: cleanText(parsed.notes) || cleanText(reason)
    }
    : batchFallbackResult(item, reason);
  const result = normalizedFirstResult(source, item.entry.row, parsedWebsiteUrl);
  if (result.phone_number && shouldClearRejectedContact(result)) {
    result.phone_number = "";
  }
  if (result.email && shouldClearRejectedContact(result)) {
    result.email = "";
  }
  applyChatGPTResult(output, item.entry, result, item.resultListPath);
  return result;
}

class ChatGptPlaywrightAgent {
  constructor() {
    loadEnv(path.resolve(process.cwd(), ".env"));
    this.profileDir = path.resolve(process.cwd(), process.env.CHATGPT_PROFILE_DIR || "agent-data/chatgpt-profile");
    this.headless = booleanEnv("CHATGPT_HEADLESS", true);
    this.timeoutMs = Number(process.env.CHATGPT_TIMEOUT_MS || 30000);
    this.batchTimeoutMs = numericEnv("CHATGPT_BATCH_TIMEOUT_MS", Math.max(this.timeoutMs, 600000), 15000, 900000);
    this.batchSize = numericEnv("CHATGPT_BATCH_SIZE", 25, 1, 50);
    this.chatgptBatchParallelism = numericEnv("CHATGPT_BATCH_PARALLELISM", 4, 1, 4);
    this.promptReviewMs = numericEnv("CHATGPT_PROMPT_REVIEW_MS", 0, 0, 600000);
    this.parallelism = numericEnv("CHATGPT_PARALLELISM", numericEnv("PLAYWRIGHT_AGENT_PARALLELISM", 15, 1, 30), 1, 30);
    this.parallelismAuto = booleanEnv("CHATGPT_PARALLELISM_AUTO", true);
    this.maxParallelism = numericEnv("CHATGPT_MAX_PARALLELISM", 10, 1, 30);
    this.pageMemoryMb = numericEnv("CHATGPT_PAGE_MEMORY_MB", 700, 256, 4096);
    this.systemReserveMemoryMb = numericEnv("CHATGPT_SYSTEM_RESERVE_MEMORY_MB", defaultSystemReserveMemoryMb(), 512, 32768);
    this.diskCacheMb = numericEnv("CHATGPT_DISK_CACHE_MB", 128, 32, 1024);
    this.blockHeavyResources = booleanEnv("CHATGPT_BLOCK_HEAVY_RESOURCES", true);
    this.minFreeMemoryMb = numericEnv("CHATGPT_MIN_FREE_MEMORY_MB", 2048, 0, 32768);
    this.workerStaggerMs = numericEnv("CHATGPT_WORKER_STAGGER_MS", 900, 0, 10000);
    this.context = null;
    this.contextHeadless = null;
    this.chatgptPage = null;
    this.activeWorkerPages = 0;
    this.reservedWorkerPages = new WeakSet();
    this.currentPageLimit = 1;
    this.manualIntervention = null;
    this.interventionSerial = 0;
  }

  async launch(headless = this.headless) {
    if (this.context && this.contextHeadless === headless) {
      return this.context;
    }
    if (this.context) {
      if (this.activeWorkerPages > 0) {
        throw new Error("Cannot switch Playwright browser mode while worker pages are active");
      }
      await this.closeContext();
    }
    fs.mkdirSync(this.profileDir, { recursive: true });
    clearProfileCaches(this.profileDir);
    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        channel: "chrome",
        headless,
        viewport: { width: 1440, height: 1000 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=CalculateNativeWinOcclusion",
          `--disk-cache-size=${this.diskCacheMb * 1024 * 1024}`,
          `--media-cache-size=${Math.min(this.diskCacheMb, 64) * 1024 * 1024}`,
          ...(headless ? [] : ["--no-first-run"])
        ]
      });
      this.contextHeadless = headless;
    } catch (error) {
      const message = cleanText(error?.message || error);
      if (/profile is already in use|opening in existing browser session/i.test(message)) {
        throw new Error(
          "ChatGPT Playwright profile is already open. Stop the `npm run agent:login` terminal "
          + "or close its Playwright Chrome window, then restart `npm run agent`."
        );
      }
      throw error;
    }
    if (this.blockHeavyResources) {
      await this.context.route("**/*", async (route) => {
        const resourceType = route.request().resourceType();
        const requestUrl = route.request().url();
        const isAuthChallenge = /accounts\.google\.com|recaptcha|\/challenge\//i.test(requestUrl);
        const isChatGptUi = isChatGptUiUrl(requestUrl);
        const blockedTypes = headless
          ? ["font", "image", "media", "texttrack", "stylesheet"]
          : ["font", "image", "media", "texttrack"];
        if (!isAuthChallenge && !isChatGptUi && blockedTypes.includes(resourceType)) {
          await route.abort().catch(() => {});
          return;
        }
        await route.continue().catch(() => {});
      });
    }
    return this.context;
  }

  async openLogin(options = {}) {
    const context = await this.launch(options.visible ? false : this.headless);
    const reusablePage = context.pages().find((page) => !page.isClosed());
    this.chatgptPage = this.chatgptPage && !this.chatgptPage.isClosed()
      ? this.chatgptPage
      : (reusablePage || await context.newPage());
    await this.chatgptPage.goto(AI_PROVIDER_URL, { waitUntil: "domcontentloaded" });
    return this.chatgptPage;
  }

  async waitForLogin(onStatus, existingPage = null) {
    const page = existingPage || await this.openLogin();
    return this.waitForLoginPage(page, onStatus);
  }

  async waitForLoginPage(page, onStatus) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      if (await findPromptBox(page)) {
        return page;
      }
      onStatus?.("waiting_login", "Complete ChatGPT login in the Playwright Chrome window.");
      await page.waitForTimeout(2000);
    }
    throw new Error("ChatGPT login timed out");
  }

  async waitForPrompt(page, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let reloaded = false;
    let clickedNewChat = false;
    while (Date.now() < deadline) {
      if (await findPromptBox(page)) {
        return true;
      }
      if (!clickedNewChat) {
        const newChat = page.getByRole("link", { name: /new chat/i }).or(page.getByRole("button", { name: /new chat/i })).first();
        if (await newChat.count().catch(() => 0) && await newChat.isVisible().catch(() => false)) {
          clickedNewChat = true;
          await newChat.click().catch(() => {});
          await page.waitForTimeout(1500);
          continue;
        }
      }
      if (!reloaded && Date.now() + Math.max(12000, timeoutMs / 2) < deadline) {
        reloaded = true;
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(2500);
        continue;
      }
      await page.waitForTimeout(750);
    }
    return false;
  }

  async closeContext() {
    await this.context?.close().catch(() => {});
    this.context = null;
    this.contextHeadless = null;
    this.chatgptPage = null;
    this.activeWorkerPages = 0;
    this.reservedWorkerPages = new WeakSet();
  }

  async waitForManualIntervention({ page, trackedPage, kind, url, onStatus = () => {} }) {
    if (this.manualIntervention) {
      if (trackedPage) {
        await this.closeWorkerPage(page);
      } else {
        await page?.close().catch(() => {});
      }
      return this.manualIntervention.promise;
    }

    let resolveIntervention;
    let rejectIntervention;
    const promise = new Promise((resolve, reject) => {
      resolveIntervention = resolve;
      rejectIntervention = reject;
    });
    this.interventionSerial += 1;
    this.manualIntervention = { promise, kind };

    try {
      onStatus(
        kind === "captcha" ? "waiting_captcha" : "waiting_login",
        kind === "captcha"
          ? "Opening Chrome now for CAPTCHA. Background processing will resume after it is solved."
          : "Opening Chrome now for ChatGPT login. Background processing will resume after login."
      );
      if (trackedPage) {
        await this.closeWorkerPage(page);
      } else {
        await page?.close().catch(() => {});
      }
      await this.closeContext();
      const visibleContext = await this.launch(false);
      const visiblePage = visibleContext.pages().find((candidate) => !candidate.isClosed()) || await visibleContext.newPage();
      await visiblePage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await visiblePage.bringToFront().catch(() => {});
      await visiblePage.waitForTimeout(1200);

      const status = kind === "captcha" ? "waiting_captcha" : "waiting_login";
      const message = kind === "captcha"
        ? "Solve the CAPTCHA in the opened Chrome window. Background processing will resume automatically."
        : "Complete ChatGPT login in the opened Chrome window. Background processing will resume automatically.";
      const deadline = Date.now() + 15 * 60 * 1000;
      let solved = false;
      while (Date.now() < deadline) {
        if (visiblePage.isClosed()) {
          throw new Error(`Manual ${kind} window was closed before completion`);
        }
        onStatus(status, message);
        solved = kind === "captcha"
          ? !await googleCaptchaMessage(visiblePage)
          : Boolean(await findPromptBox(visiblePage));
        if (solved) {
          break;
        }
        await visiblePage.waitForTimeout(1500);
      }
      if (!solved) {
        throw new Error(`Manual ${kind} timed out`);
      }

      await this.closeContext();
      const backgroundContext = await this.launch(this.headless);
      for (const idlePage of backgroundContext.pages()) {
        await idlePage.close().catch(() => {});
      }
      resolveIntervention();
    } catch (error) {
      rejectIntervention(error);
      return promise;
    } finally {
      this.manualIntervention = null;
    }
    return promise;
  }

  async ensureChatGPTLogin(onStatus = () => {}) {
    const page = await this.openLogin();
    if (await this.waitForPrompt(page, 60000)) {
      await page.close().catch(() => {});
      this.chatgptPage = null;
      return;
    }
    if (!await isLikelyChatGptLoginPage(page)) {
      await page.close().catch(() => {});
      this.chatgptPage = null;
      throw new Error("ChatGPT is signed in but the prompt box did not become ready in background Chrome");
    }
    this.chatgptPage = null;
    await this.waitForManualIntervention({
      page,
      trackedPage: false,
      kind: "login",
      url: AI_PROVIDER_URL,
      onStatus
    });
  }

  async newWorkerPage(onWait = () => {}) {
    while (this.manualIntervention) {
      await this.manualIntervention.promise;
    }
    while (true) {
      const freeMemoryMb = availableMemoryMb();
      const pageLimit = Math.max(1, Number(this.currentPageLimit || this.maxParallelism || 1));
      const pageLimitReached = this.activeWorkerPages >= pageLimit;
      const lowMemory = this.activeWorkerPages > 0
        && this.minFreeMemoryMb > 0
        && freeMemoryMb < this.minFreeMemoryMb;
      const reserveRisk = this.activeWorkerPages > 0
        && this.systemReserveMemoryMb > 0
        && freeMemoryMb - this.pageMemoryMb < this.systemReserveMemoryMb;
      if (!pageLimitReached && !lowMemory && !reserveRisk) {
        break;
      }
      onWait(freeMemoryMb);
      await delay(pageLimitReached ? 1000 : 2500);
    }
    this.activeWorkerPages += 1;
    try {
      const context = await this.launch(this.headless);
      const blankPage = context.pages().find((page) => (
        !page.isClosed()
        && page.url() === "about:blank"
        && !this.reservedWorkerPages.has(page)
      ));
      const page = blankPage || await context.newPage();
      this.reservedWorkerPages.add(page);
      return page;
    } catch (error) {
      this.activeWorkerPages = Math.max(0, this.activeWorkerPages - 1);
      throw error;
    }
  }

  async closeWorkerPage(page) {
    if (!page) {
      return;
    }
    await page.close().catch(() => {});
    this.reservedWorkerPages.delete(page);
    this.activeWorkerPages = Math.max(0, this.activeWorkerPages - 1);
  }

  effectiveParallelism(entriesCount) {
    return adaptiveParallelismLimit({
      requested: this.parallelism,
      entriesCount,
      totalMb: totalMemoryMb(),
      freeMb: availableMemoryMb(),
      cpuCount: os.cpus().length || 4,
      maxParallelism: this.maxParallelism,
      pageMemoryMb: this.pageMemoryMb,
      systemReserveMemoryMb: this.systemReserveMemoryMb,
      auto: this.parallelismAuto
    });
  }

  async processRows(rows, jobDir, onProgress = () => {}) {
    await this.launch(this.headless);
    const unique = new Map();
    rows.forEach((row, index) => {
      const key = companyKey(row);
      if (key && !unique.has(key)) {
        unique.set(key, { row, indexes: [index] });
      } else if (key) {
        unique.get(key).indexes.push(index);
      }
    });

    const output = rows.map((row) => ({ ...row }));
    const entries = [...unique.values()];
    if (!entries.length) {
      return output;
    }

    const batchSize = Math.min(this.batchSize, entries.length);
    const batchParallelism = Math.min(this.chatgptBatchParallelism, Math.max(1, Math.ceil(entries.length / batchSize)));
    this.currentPageLimit = Math.max(1, batchParallelism);
    let completed = 0;
    let nextBatchIndex = 0;
    onProgress({
      status: "running",
      processed: 0,
      total: entries.length,
      company: "",
      message: `Starting direct ChatGPT extraction: ${batchSize}-query batch(es), ${batchParallelism} in parallel`,
      rows: output
    });

    const indexedEntries = entries.map((entry, position) => ({ entry, position }));
    const batches = [];
    for (let start = 0; start < indexedEntries.length; start += batchSize) {
      batches.push(indexedEntries.slice(start, start + batchSize));
    }

    const activeChatGptBatches = new Set();

    const startChatGptBatch = (batchIndex, workerIndex) => {
      const items = this.directChatGPTBatchItems(batches[batchIndex], jobDir);
      const task = this.processChatGPTBatch({
        items,
        batchIndex,
        totalBatches: batches.length,
        total: entries.length,
        output,
        jobDir,
        workerIndex,
        batchParallelism,
        completedCount: () => completed,
        onProgress
      }).then((result) => {
        completed += items.length;
        onProgress({
          status: "running",
          processed: completed,
          total: entries.length,
          company: result.company,
          message: result.message,
          rows: output
        });
      }).finally(() => {
        activeChatGptBatches.delete(task);
      });
      activeChatGptBatches.add(task);
    };

    while (activeChatGptBatches.size || nextBatchIndex < batches.length) {
      while (nextBatchIndex < batches.length && activeChatGptBatches.size < batchParallelism) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        startChatGptBatch(batchIndex, activeChatGptBatches.size);
      }

      const waiters = [];
      for (const task of activeChatGptBatches) {
        waiters.push(task.then(() => ({ type: "chatgpt" }), () => ({ type: "chatgpt" })));
      }
      if (!waiters.length) {
        break;
      }
      await Promise.race(waiters);
    }

    await Promise.all(activeChatGptBatches);
    return output;
  }

  directChatGPTBatchItems(batch, jobDir) {
    return batch.map(({ entry, position }) => {
      const row = entry.row;
      const queryText = googleQueryText(row);
      const resultListPath = path.join(jobDir, `${String(position + 1).padStart(5, "0")}-chatgpt-input.json`);
      const item = {
        batchId: batchId(position),
        entry,
        position,
        queryText,
        resultListPath,
        company: rowCompanyName(row),
        error: ""
      };
      fs.writeFileSync(resultListPath, JSON.stringify({
        batch_id: item.batchId,
        query: queryText
      }, null, 2));
      return item;
    });
  }

  async processChatGPTBatch({
    items,
    batchIndex,
    totalBatches,
    total,
    output,
    jobDir,
    workerIndex = 0,
    batchParallelism = 1,
    completedCount,
    onProgress
  }) {
    let chatgptPage = null;
    let parsedResults = [];
    let errorMessage = "";
    const firstPosition = items[0]?.position || 0;
    const debugBasePath = path.join(jobDir, `${String(firstPosition + 1).padStart(5, "0")}-batch-${batchIndex + 1}`);
    const prompt = batchResultPrompt(items);
    fs.writeFileSync(`${debugBasePath}-chatgpt-prompt.txt`, prompt);
    const progress = (message, status = "running") => onProgress({
      status,
      processed: completedCount(),
      total,
      company: items[0]?.company || "",
      message: workerMessage(workerIndex, batchParallelism, message)
    });

    try {
      try {
        chatgptPage = await this.newWorkerPage((freeMemoryMb) => {
          progress(`Waiting for free system memory (${freeMemoryMb} MB available)`);
        });
        await chatgptPage.goto(AI_PROVIDER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        if (!await this.waitForPrompt(chatgptPage, 60000)) {
          if (!await isLikelyChatGptLoginPage(chatgptPage)) {
            await chatgptPage.screenshot({ path: `${debugBasePath}-prompt-not-ready.png`, fullPage: true }).catch(() => {});
            fs.writeFileSync(`${debugBasePath}-prompt-not-ready.html`, await chatgptPage.content().catch(() => ""));
            throw new Error("ChatGPT prompt was not ready in background Chrome; saved debug page without opening login window");
          }
          const loginPage = chatgptPage;
          chatgptPage = null;
          await this.waitForManualIntervention({
            page: loginPage,
            trackedPage: true,
            kind: "login",
            url: AI_PROVIDER_URL,
            onStatus: (status, message) => onProgress({
              status,
              processed: completedCount(),
              total,
              company: items[0]?.company || "",
              message
            })
          });
          chatgptPage = await this.newWorkerPage((freeMemoryMb) => {
            progress(`Waiting for free system memory (${freeMemoryMb} MB available)`);
          });
          await chatgptPage.goto(AI_PROVIDER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
          if (!await this.waitForPrompt(chatgptPage, 60000)) {
            throw new Error("ChatGPT prompt was not available after manual login");
          }
        }
        const highMode = await selectChatGptHighMode(chatgptPage);
        if (highMode) {
          progress(`ChatGPT mode: ${highMode}`);
        }
        await fillPrompt(chatgptPage, prompt);
        if (!this.headless && this.promptReviewMs > 0) {
          progress(`ChatGPT batch ${batchIndex + 1}/${totalBatches}: visible prompt review`);
          await chatgptPage.waitForTimeout(this.promptReviewMs);
        }
        progress(`ChatGPT batch ${batchIndex + 1}/${totalBatches}: sending ${items.length} query inputs`);
        await sendPrompt(chatgptPage, prompt, debugBasePath);
        progress(`ChatGPT batch ${batchIndex + 1}/${totalBatches}: waiting for ${items.length} JSON objects`);
        parsedResults = await waitForChatGPTBatchJson(
          chatgptPage,
          items.length,
          this.batchTimeoutMs,
          debugBasePath,
          items.map((item) => item.batchId)
        );
      } catch (error) {
        errorMessage = cleanText(error?.message || error);
      }

      const byId = new Map();
      for (const parsed of parsedResults) {
        byId.set(cleanText(parsed.batch_id || parsed.id), parsed);
      }
      items.forEach((item) => {
        const parsed = byId.get(item.batchId) || null;
        const reason = item.error
          ? `Query input unavailable: ${item.error}`
          : (errorMessage ? `ChatGPT batch issue: ${errorMessage}` : "");
        applyBatchChatGPTResult(output, item, parsed, reason);
      });
      fs.writeFileSync(`${debugBasePath}-chatgpt-batch-summary.json`, JSON.stringify({
        batch: batchIndex + 1,
        totalBatches,
        requested: items.map((item) => item.batchId),
        received: parsedResults.map((result) => cleanText(result.batch_id || result.id)),
        error: errorMessage
      }, null, 2));

      const message = errorMessage
        ? `ChatGPT batch ${batchIndex + 1}/${totalBatches}: saved fallback blanks for ${items.length}`
        : `ChatGPT batch ${batchIndex + 1}/${totalBatches}: received ${parsedResults.length}/${items.length} JSON objects`;
      onProgress({
        status: "running",
        processed: completedCount() + items.length,
        total,
        company: items[items.length - 1]?.company || "",
        message,
        rows: output
      });

      return {
        company: items[items.length - 1]?.company || "",
        message
      };
    } finally {
      await this.closeWorkerPage(chatgptPage);
    }
  }

  async close() {
    await this.closeContext();
  }
}

module.exports = {
  ChatGptPlaywrightAgent,
  loadEnv,
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
  totalMemoryMb,
  adaptiveParallelismLimit,
  hardwareParallelismCap
};
