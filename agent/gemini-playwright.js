const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const BLOCKED_HOSTS = [
  "google.",
  "googleusercontent.",
  "gstatic.",
  "googleadservices.",
  "doubleclick.",
  "facebook.",
  "instagram.",
  "linkedin.",
  "youtube.",
  "x.com",
  "twitter.",
  "eximpedia.",
  "tradeindata.",
  "trademo.",
  "trademe.",
  "volza.",
  "seair.",
  "exportersindia.",
  "exportgenius.",
  "importgenius.",
  "importkey.",
  "panjiva.",
  "zaubacorp.",
  "tofler.",
  "dnb.",
  "indiamart.",
  "tradeindia.",
  "exporthub.",
  "go4worldbusiness.",
  "connect2india.",
  "justdial.",
  "yellowpages.",
  "yelp.",
  "2gis.",
  "hidubai.",
  "tendata.",
  "kompass.",
  "zoominfo.",
  "apollo.",
  "rocketreach.",
  "crunchbase."
];

const NON_WEBSITE_RESULT_HOSTS = [
  "google.",
  "googleusercontent.",
  "gstatic.",
  "googleadservices.",
  "doubleclick.",
  "facebook.",
  "instagram.",
  "linkedin.",
  "youtube.",
  "x.com",
  "twitter.",
  "tiktok.",
  "pinterest."
];

const GENERIC_PORTAL_CONTACT_HOSTS = [
  "exportersindia.com",
  "tendata.com",
  "trademo.com",
  "volza.com",
  "panjiva.com",
  "eximpedia.app"
];

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
    throw new Error(`Google screenshot is not a valid PNG: ${filePath}`);
  }
  return {
    bytes: stats.size,
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20)
  };
}

function assertScreenshotReady(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Google screenshot was not created: ${filePath}`);
  }
  const info = readPngInfo(filePath);
  if (info.bytes < 25000) {
    throw new Error(`Google screenshot is too small to read (${info.bytes} bytes)`);
  }
  if (info.width < 900 || info.height < 500) {
    throw new Error(`Google screenshot is too small to read (${info.width}x${info.height})`);
  }
  return info;
}

function companyKey(row) {
  return [
    cleanText(row.websiteName || row.companyName || row.consignee).toLowerCase(),
    cleanText(row.country).toLowerCase()
  ].join("|");
}

function googleQueryUrl(row) {
  const existing = cleanText(row.consigneeUrl);
  try {
    const parsed = new URL(existing);
    if ((parsed.hostname === "google.com" || parsed.hostname.endsWith(".google.com")) && parsed.searchParams.get("q")) {
      return parsed.href;
    }
  } catch (error) {
    // Build a stable Google query below.
  }
  const query = [
    cleanText(row.websiteName || row.companyName || row.consignee),
    cleanText(row.country)
  ].filter(Boolean).join(" ");
  return "https://www.google.com/search?num=10&hl=en&q=" + encodeURIComponent(query);
}

function isBlockedUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return !["http:", "https:"].includes(parsed.protocol)
      || BLOCKED_HOSTS.some((part) => host.includes(part));
  } catch (error) {
    return true;
  }
}

function isNonWebsiteResultUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return !["http:", "https:"].includes(parsed.protocol)
      || NON_WEBSITE_RESULT_HOSTS.some((part) => host.includes(part));
  } catch (error) {
    return true;
  }
}

function hostIncludes(value, hosts) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return hosts.some((part) => host.includes(part));
  } catch (error) {
    return false;
  }
}

function normalizeUrl(value) {
  const text = cleanText(value);
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
  const text = cleanText(value);
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
  const text = cleanText(value).replace(/^tel:/i, "");
  if (/^none|null|n\/a$/i.test(text)) {
    return "";
  }
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 16 ? text : "";
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
            output.push(JSON.parse(source.slice(start, index + 1)));
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

function parseJsonObject(value) {
  return parseJsonObjects(value)[0] || {};
}

function isGeminiResult(value) {
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

function organicResultsText(results) {
  if (!results.length) {
    return "No non-sponsored organic results were extracted.";
  }
  return results.map((result) => [
    `Rank ${result.rank}: ${cleanText(result.title) || "(no title)"}`,
    `URL: ${result.url}`,
    `Snippet: ${cleanText(result.snippet).slice(0, 650) || "(no snippet)"}`
  ].join("\n")).join("\n\n");
}

function contactCandidatesText(candidates) {
  if (!candidates.length) {
    return "No visible contact candidates were extracted from the organic result pages.";
  }
  return candidates.map((candidate, index) => [
    `Candidate ${index + 1}: ${candidate.type.toUpperCase()} ${candidate.value}`,
    `Source rank: ${candidate.rank}`,
    `Source URL: ${candidate.source_url}`,
    `Evidence: ${cleanText(candidate.evidence).slice(0, 350)}`
  ].join("\n")).join("\n\n");
}

function resultPrompt(row, queryUrl, organicResults = [], contactCandidates = []) {
  const company = cleanText(row.websiteName || row.companyName || row.consignee);
  const country = cleanText(row.country);
  const firstOrganicUrl = organicResults[0]?.url || "";
  return [
    "CRITICAL OUTPUT CONTRACT:",
    "Return exactly one raw JSON object and nothing else.",
    "Do not use markdown, code fences, bullets, headings, explanations, apologies, tables, or surrounding text.",
    "The first character of your response must be { and the last character must be }.",
    "The JSON must parse with JSON.parse without cleanup.",
    "Use double quotes for every key and string value.",
    "Do not add extra keys. Do not omit any key.",
    "Required exact keys in this exact order: company_name, website_url, phone_number, email, source_url, confidence, notes.",
    "If a value is unavailable, use an empty string. Never use null, undefined, N/A, none, unknown, arrays, or nested objects.",
    "confidence must be a number from 0 to 1.",
    "notes must always be a short non-empty string explaining the Rank 1 source checked, even when email and phone are blank.",
    "If you cannot access/check the page, still return the valid JSON object with blanks and a notes reason.",
    "Valid empty-contact example:",
    '{"company_name":"Example Company","website_url":"https://example.com/","phone_number":"","email":"","source_url":"https://example.com/","confidence":0,"notes":"Rank 1 checked; no visible same-company email or phone found."}',
    "",
    "The Google organic search results below were extracted from the exact trade-report query URL.",
    "Use the Google query URL and the extracted results exactly. Do not rebuild a new search from other columns.",
    "Your job is to extract contact data from Rank 1, the FIRST non-sponsored organic result in the list.",
    "Ignore sponsored/ad results. The list is already ordered top-to-bottom from Google organic results.",
    "Use Rank 1 as the target when it matches the same company/listing. If Rank 1 is clearly unrelated, use the next rank that matches and explain that in notes.",
    "Return website_url as that first result page URL itself. Do not replace it with a later result, a guessed official website, or a different domain.",
    "Do not reject import/export portals, trade-data sites, directories, marketplaces, or profile pages when they are the first non-sponsored result. Use the first result page as the source.",
    "Reject only sponsored ads, Google redirect/cache pages, social networks, map listings, and unrelated similarly named companies.",
    "Open/check the first result page and extract only the email and phone shown for the same company/listing on that page or a direct details/contact page linked from that same first-result site.",
    "If Rank 1 hides or masks contact details, use the contact candidates below from the extracted top organic result pages, but only when the source page is clearly for the same company/listing.",
    "If the contact candidates are empty or only masked, perform focused web searches for the exact company name plus phone, email, contact, WhatsApp, 2GIS, and HiDubai before returning blanks.",
    "You may accept a full phone/email from a local business listing such as 2GIS or HiDubai when the listing name and country/address match the same company, even if website_url remains Rank 1.",
    "Prefer full phone numbers from tel: links, WhatsApp links, or visible contact sections over masked text such as '+971 52213...'.",
    "Do not use generic portal support/sales/corporate numbers from site headers or footers, including ExportersIndia, Tendata, Volza, Panjiva, Trademo, or Eximpedia support numbers.",
    "Do not invent a phone/email and never complete a masked or partially hidden number.",
    "If no full same-company email or phone is visible in Rank 1 or the contact candidates, use an empty string for that field.",
    "Always set company_name to the Company value, even when every contact field is blank.",
    "The notes field must briefly say which first result URL was used and which source provided each contact field, or why contact fields are blank.",
    "FINAL RESPONSE FORMAT: Return ONLY one JSON object with exactly these keys:",
    '{"company_name":"","website_url":"","phone_number":"","email":"","source_url":"","confidence":0,"notes":""}',
    `Company: ${company}`,
    `Country: ${country}`,
    `HSN Code: ${cleanText(row.hsCode)}`,
    `Google query URL: ${queryUrl}`,
    `Rank 1 organic result URL: ${firstOrganicUrl || "none"}`,
    "Extracted Google organic results:",
    organicResultsText(organicResults),
    "Extracted contact candidates from organic result pages:",
    contactCandidatesText(contactCandidates)
  ].join("\n");
}

async function findPromptBox(page) {
  const selectors = [
    'textarea[placeholder*="Ask"]',
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

async function dismissGoogleConsent(page) {
  const buttons = [
    page.getByRole("button", { name: /accept all/i }),
    page.getByRole("button", { name: /i agree/i }),
    page.getByRole("button", { name: /agree/i })
  ];
  for (const button of buttons) {
    if (await button.count() && await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      break;
    }
  }
}

async function firstOrganicGoogleUrl(page) {
  const results = await googleOrganicResults(page, 1);
  return results[0]?.url || "";
}

async function googleOrganicResults(page, limit = 15) {
  const rawResults = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const unwrap = (href) => {
      try {
        const parsed = new URL(href, window.location.href);
        if (parsed.hostname.includes("google.") && parsed.pathname === "/url") {
          return parsed.searchParams.get("q") || parsed.searchParams.get("url") || href;
        }
        return parsed.href;
      } catch (error) {
        return href || "";
      }
    };
    const sponsoredSelector = [
      "[data-text-ad]",
      "[aria-label*='Ads']",
      "[aria-label*='Sponsored']",
      "[data-rw]",
      "[data-ta-slot]"
    ].join(",");
    const output = [];
    const seen = new Set();
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const titleElement = anchor.querySelector("h3");
      if (!titleElement || anchor.closest(sponsoredSelector)) {
        continue;
      }
      const url = unwrap(anchor.href || anchor.getAttribute("href") || "");
      const title = clean(titleElement.innerText || anchor.innerText);
      if (!url || !title || seen.has(url)) {
        continue;
      }
      seen.add(url);
      let container = titleElement;
      let bestText = "";
      for (let depth = 0; depth < 9 && container; depth += 1) {
        const text = clean(container.innerText || container.textContent || "");
        if (text.includes(title)
          && text.length > bestText.length
          && text.length < 1800
          && !/people also ask|related searches/i.test(text)) {
          bestText = text;
        }
        container = container.parentElement;
      }
      const snippet = bestText
        .replace(title, "")
        .replace(url, "")
        .replace(/\b(?:http|https):\/\/\S+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      output.push({ title, url, snippet });
    }
    return output;
  });
  const results = [];
  const seen = new Set();
  for (const result of rawResults) {
    const url = normalizeFirstResultUrl(result.url);
    if (!url || seen.has(url) || isNonWebsiteResultUrl(url)) {
      continue;
    }
    seen.add(url);
    results.push({
      rank: results.length + 1,
      title: cleanText(result.title),
      url,
      snippet: cleanText(result.snippet)
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

function normalizeCandidatePhone(value) {
  const text = cleanText(value);
  if (!text || /\.\.\.|(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}|\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text)) {
    return "";
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 16) {
    return "";
  }
  if (/^\+/.test(text)) {
    return text;
  }
  return text;
}

function phoneFromHref(href) {
  const text = cleanText(href);
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text, "https://example.com/");
    if (parsed.protocol === "tel:") {
      return normalizeCandidatePhone(decodeURIComponent(parsed.pathname));
    }
    if (parsed.hostname.includes("wa.me")) {
      const digits = parsed.pathname.replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 16 ? `+${digits}` : "";
    }
    if (parsed.hostname.includes("api.whatsapp.com") || parsed.hostname.includes("whatsapp.com")) {
      const digits = String(parsed.searchParams.get("phone") || "").replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 16 ? `+${digits}` : "";
    }
  } catch (error) {
    // Regex fallback below.
  }
  const match = text.match(/(?:phone=|wa\.me\/)(\+?\d{8,16})/i);
  return match ? `+${match[1].replace(/\D/g, "")}` : "";
}

function addContactCandidate(candidates, seen, candidate) {
  const type = cleanText(candidate.type).toLowerCase();
  const value = type === "email"
    ? normalizeFirstResultEmail(candidate.value)
    : normalizeCandidatePhone(candidate.value);
  if (!type || !value) {
    return;
  }
  const evidence = cleanText(candidate.evidence);
  const sourceUrl = normalizeFirstResultUrl(candidate.source_url);
  if (!sourceUrl) {
    return;
  }
  const lowEvidence = evidence.toLowerCase();
  const lowUrl = sourceUrl.toLowerCase();
  const digits = value.replace(/\D/g, "");
  const sourceDigits = sourceUrl.replace(/\D/g, "");
  if (type === "phone" && (
    /\b(ip|utc|robot|captcha|suspicious|verify|verification|error|access denied)\b/i.test(evidence)
    || (digits.length >= 8 && sourceDigits.includes(digits))
    || (!/^\+/.test(value) && !/\b(phone|mobile|tel|telephone|whatsapp|contact|call)\b/i.test(evidence))
    || (hostIncludes(sourceUrl, GENERIC_PORTAL_CONTACT_HOSTS)
      && /\b(sales|support|pre-sales|after-sale|consulting|customer relationship|franchise|copyright|icp|public network security|tendata|exportersindia|weblink\.in|purchase a full-year plan)\b/i.test(evidence))
  )) {
    return;
  }
  if (type === "phone"
    && /exportersindia\.com/.test(lowUrl)
    && (/^\+?91\b/.test(value) || /\b(sales|support|for help|post buy requirement|my exportersindia|weblink\.in)\b/.test(lowEvidence))) {
    return;
  }
  const key = `${type}|${value}|${sourceUrl}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({
    type,
    value,
    rank: Number(candidate.rank || 0),
    source_url: sourceUrl,
    evidence
  });
}

function trustedFallbackCandidate(candidate) {
  if (!candidate || !candidate.source_url) {
    return false;
  }
  if (hostIncludes(candidate.source_url, GENERIC_PORTAL_CONTACT_HOSTS)) {
    return false;
  }
  return !/\b(rejected|support|sales|copyright|icp|public network security|captcha|robot|ip:)\b/i.test(candidate.evidence || "");
}

function shouldClearRejectedContact(result) {
  const notes = cleanText(result.notes).toLowerCase();
  return /\b(rejected|generic|support|corporate|not specific|not tied|not verified|not originate|portal support)\b/.test(notes);
}

async function extractPageContactCandidates(page, result) {
  const pageCandidates = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const contextFor = (element) => {
      let current = element;
      for (let depth = 0; depth < 4 && current; depth += 1) {
        const text = clean(current.innerText || current.textContent || "");
        if (text.length >= 12) {
          return text.slice(0, 500);
        }
        current = current.parentElement;
      }
      return clean(element.innerText || element.textContent || element.getAttribute("href") || "");
    };
    const output = [];
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") || "";
      const text = clean(anchor.innerText || anchor.textContent || href);
      if (/^mailto:/i.test(href)) {
        output.push({ type: "email", value: href.replace(/^mailto:/i, "").split("?")[0], evidence: contextFor(anchor) });
      }
      if (/^tel:/i.test(href) || /wa\.me\/|whatsapp\.com/i.test(href)) {
        output.push({ type: "phone", value: href, evidence: contextFor(anchor) || text });
      }
    }
    const bodyText = clean(document.body?.innerText || "");
    const emailMatches = bodyText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    for (const email of emailMatches.slice(0, 12)) {
      const index = bodyText.toLowerCase().indexOf(email.toLowerCase());
      output.push({
        type: "email",
        value: email,
        evidence: bodyText.slice(Math.max(0, index - 120), index + email.length + 120)
      });
    }
    const phoneMatches = bodyText.match(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,15}\d/g) || [];
    for (const phone of phoneMatches.slice(0, 20)) {
      const compact = phone.replace(/\D/g, "");
      if (compact.length < 8 || compact.length > 16) {
        continue;
      }
      const index = bodyText.indexOf(phone);
      output.push({
        type: "phone",
        value: phone,
        evidence: bodyText.slice(Math.max(0, index - 140), index + phone.length + 140)
      });
    }
    return output;
  }).catch(() => []);
  return pageCandidates.map((candidate) => ({
    ...candidate,
    rank: result.rank,
    source_url: result.url,
    value: candidate.type === "phone" ? (phoneFromHref(candidate.value) || candidate.value) : candidate.value
  }));
}

async function collectContactCandidates(context, organicResults, onProgress = () => {}, reusablePage = null) {
  const candidates = [];
  const seen = new Set();
  const page = reusablePage || await context.newPage();
  try {
    for (const result of organicResults.slice(0, 8)) {
      onProgress(result);
      const snippetText = `${result.title}\n${result.url}\n${result.snippet}`;
      const snippetEmails = snippetText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
      for (const email of snippetEmails) {
        addContactCandidate(candidates, seen, {
          type: "email",
          value: email,
          rank: result.rank,
          source_url: result.url,
          evidence: `Google result snippet: ${result.snippet}`
        });
      }
      const snippetPhones = snippetText.match(/(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,15}\d/g) || [];
      for (const phone of snippetPhones) {
        addContactCandidate(candidates, seen, {
          type: "phone",
          value: phone,
          rank: result.rank,
          source_url: result.url,
          evidence: `Google result snippet: ${result.snippet}`
        });
      }
      try {
        await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 12000 });
        await page.waitForTimeout(900);
        const pageCandidates = await extractPageContactCandidates(page, result);
        for (const candidate of pageCandidates) {
          addContactCandidate(candidates, seen, candidate);
        }
      } catch (error) {
        // Some result pages block automation; snippets and remaining pages still help.
      }
      if (candidates.filter((candidate) => candidate.type === "phone").length >= 3
        && candidates.filter((candidate) => candidate.type === "email").length >= 2) {
        break;
      }
    }
  } finally {
    if (!reusablePage) {
      await page.close().catch(() => {});
    }
  }
  return candidates.slice(0, 16);
}

async function captureGoogleScreenshot(page, screenshotPath) {
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
  await page.locator("body").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    scale: "css"
  });
  return assertScreenshotReady(screenshotPath);
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
  throw new Error("Gemini did not show a ready screenshot attachment");
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
  throw new Error("No Gemini image file input was available");
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
  throw new Error("Gemini upload button was not found");
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
  const box = await clickPromptBox(page, "Gemini prompt box not found before screenshot paste");
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
    throw new Error(`Gemini screenshot attachment failed. ${attempts.join(" | ")}`);
  }
  return signal;
}

async function fillPrompt(page, prompt) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const box = await clickPromptBox(page, "Gemini prompt box not found. Complete login in the Playwright Chrome window.");
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
      throw new Error("Gemini prompt text was not fully written");
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(800);
    }
  }
  throw new Error(`Gemini prompt fill failed: ${cleanText(lastError?.message || lastError)}`);
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
    throw new Error("Screenshot attachment disappeared before Gemini send");
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
  const box = await clickPromptBox(page, "Gemini prompt box not found before send.");
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
    const retryButton = await findSendButton(page, box);
    if (retryButton) {
      if (attachedSignal) {
        await ensureScreenshotStillAttached(page, attachedSignal, debugBasePath);
      }
      await retryButton.click();
      await page.waitForTimeout(2200);
      remaining = tagName === "TEXTAREA"
        ? await box.inputValue().catch(() => "")
        : await box.innerText().catch(() => "");
    }
  }
  if (cleanText(remaining).includes(cleanText(prompt).slice(-80))) {
    if (debugBasePath) {
      await page.screenshot({ path: `${debugBasePath}-gemini-send-failed.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`${debugBasePath}-gemini-send-failed.html`, await page.content().catch(() => ""));
    }
    throw new Error("Gemini prompt was filled, but the Send button was not activated");
  }
}

async function waitForGeminiJson(page, timeoutMs, debugBasePath) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const blocks = await page.locator("pre, code").allTextContents().catch(() => []);
    for (const candidate of [...blocks].reverse()) {
      const parsed = parseJsonObjects(candidate).reverse().find(isGeminiResult);
      if (parsed) {
        return parsed;
      }
    }
    const mainText = await page.locator("body").innerText().catch(() => "");
    const blockingMessage = geminiBlockingMessage(mainText);
    if (blockingMessage) {
      if (debugBasePath) {
        await page.screenshot({ path: `${debugBasePath}-gemini-blocked.png`, fullPage: true }).catch(() => {});
        fs.writeFileSync(`${debugBasePath}-gemini-blocked.txt`, mainText);
      }
      throw new Error(blockingMessage);
    }
    if (mainText && mainText === lastText) {
      stableSince = stableSince || Date.now();
      if (Date.now() - stableSince > 3500) {
        const parsed = parseJsonObjects(mainText.slice(-20000)).reverse().find(isGeminiResult);
        if (parsed) {
          return parsed;
        }
      }
    } else {
      lastText = mainText;
      stableSince = 0;
    }
    await page.waitForTimeout(1000);
  }
  if (debugBasePath) {
    fs.writeFileSync(`${debugBasePath}-gemini-timeout.txt`, lastText);
  }
  throw new Error("Gemini JSON response timed out");
}

function geminiBlockingMessage(value) {
  const text = String(value || "").slice(-16000);
  if (!text) {
    return "";
  }
  if (/you(?:'| a)?ve reached (?:your )?(?:limit|usage limit)|rate limit|too many requests|quota exceeded|try again later/i.test(text)) {
    return "Gemini limit reached or rate limited";
  }
  if (/storage (?:is )?full|not enough storage|data (?:is )?full|browser data full/i.test(text)) {
    return "Gemini browser storage/data is full";
  }
  if (/something went wrong|server error|couldn(?:'|\u2019)?t complete|response stopped|failed to generate/i.test(text)) {
    return "Gemini showed a server/response error";
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
  maxParallelism = 15,
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
    return "Google CAPTCHA/rate limit detected. Slow down or wait before retrying.";
  }
  return "";
}

function rowCompanyName(row) {
  return cleanText(row.websiteName || row.companyName || row.consignee);
}

function workerMessage(workerIndex, parallelism, message) {
  return parallelism > 1 ? `Gemini ${workerIndex + 1}: ${message}` : message;
}

function applySkippedResult(output, entry, message) {
  for (const index of entry.indexes) {
    output[index] = {
      ...output[index],
      websiteUrl: "",
      email: "",
      phone: "",
      contactSource: `Gemini Playwright skipped: ${message}`
    };
  }
}

function applyGeminiResult(output, entry, result, resultListPath) {
  for (const index of entry.indexes) {
    output[index] = {
      ...output[index],
      websiteUrl: result.website_url,
      email: result.email,
      phone: result.phone_number,
      contactSource: [
        "Gemini Playwright",
        result.source_url,
        resultListPath,
        result.notes
      ].filter(Boolean).join("; ")
    };
  }
}

function isRetryableGeminiJsonError(message) {
  return /Gemini JSON response timed out|Gemini showed a server\/response error|Gemini prompt was filled, but the Send button was not activated|Gemini browser storage\/data is full/i
    .test(String(message || ""));
}

function fallbackGeminiResult(row, sourceUrl, reason) {
  const company = cleanText(row.websiteName || row.companyName || row.consignee);
  const url = normalizeFirstResultUrl(sourceUrl);
  return {
    company_name: company,
    website_url: url,
    phone_number: "",
    email: "",
    source_url: url,
    confidence: 0,
    notes: cleanText(`Empty JSON fallback after Gemini timeout: ${reason || "no strict JSON returned"}`)
  };
}

class GeminiPlaywrightAgent {
  constructor() {
    loadEnv(path.resolve(process.cwd(), ".env"));
    this.profileDir = path.resolve(process.cwd(), process.env.GEMINI_PROFILE_DIR || "agent-data/gemini-profile");
    this.headless = booleanEnv("GEMINI_HEADLESS", true);
    this.timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 30000);
    this.geminiJsonRetries = 0;
    this.parallelism = numericEnv("GEMINI_PARALLELISM", numericEnv("PLAYWRIGHT_AGENT_PARALLELISM", 15, 1, 30), 1, 30);
    this.parallelismAuto = booleanEnv("GEMINI_PARALLELISM_AUTO", false);
    this.maxParallelism = numericEnv("GEMINI_MAX_PARALLELISM", 15, 1, 30);
    this.pageMemoryMb = numericEnv("GEMINI_PAGE_MEMORY_MB", 700, 256, 4096);
    this.systemReserveMemoryMb = numericEnv("GEMINI_SYSTEM_RESERVE_MEMORY_MB", defaultSystemReserveMemoryMb(), 512, 32768);
    this.diskCacheMb = numericEnv("GEMINI_DISK_CACHE_MB", 128, 32, 1024);
    this.blockHeavyResources = booleanEnv("GEMINI_BLOCK_HEAVY_RESOURCES", true);
    this.minFreeMemoryMb = numericEnv("GEMINI_MIN_FREE_MEMORY_MB", 2048, 0, 32768);
    this.workerStaggerMs = numericEnv("GEMINI_WORKER_STAGGER_MS", 900, 0, 10000);
    this.googleSearchGapMs = numericEnv("GOOGLE_SEARCH_GAP_MS", 4000, 1000, 60000);
    this.googleCaptchaCooldownMs = numericEnv("GOOGLE_CAPTCHA_COOLDOWN_MS", 180000, 30000, 1800000);
    this.googleNextSearchAt = 0;
    this.googleCooldownUntil = 0;
    this.context = null;
    this.contextHeadless = null;
    this.geminiPage = null;
    this.activeWorkerPages = 0;
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
          "Gemini Playwright profile is already open. Stop the `npm run agent:login` terminal "
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
        const blockedTypes = headless
          ? ["font", "image", "media", "texttrack", "stylesheet"]
          : ["font", "image", "media", "texttrack"];
        if (!isAuthChallenge && blockedTypes.includes(resourceType)) {
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
    this.geminiPage = this.geminiPage && !this.geminiPage.isClosed()
      ? this.geminiPage
      : (reusablePage || await context.newPage());
    await this.geminiPage.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
    return this.geminiPage;
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
      onStatus?.("waiting_login", "Complete Gemini login in the Playwright Chrome window.");
      await page.waitForTimeout(2000);
    }
    throw new Error("Gemini login timed out");
  }

  async waitForPrompt(page, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await findPromptBox(page)) {
        return true;
      }
      await page.waitForTimeout(750);
    }
    return false;
  }

  async closeContext() {
    await this.context?.close().catch(() => {});
    this.context = null;
    this.contextHeadless = null;
    this.geminiPage = null;
    this.activeWorkerPages = 0;
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
          ? "Opening Chrome now for CAPTCHA. Interrupted rows will retry automatically."
          : "Opening Chrome now for Gemini login. Interrupted rows will retry automatically."
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
        : "Complete Gemini login in the opened Chrome window. Background processing will resume automatically.";
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

  async ensureGeminiLogin(onStatus = () => {}) {
    const page = await this.openLogin();
    if (await this.waitForPrompt(page, 15000)) {
      await page.close().catch(() => {});
      this.geminiPage = null;
      return;
    }
    this.geminiPage = null;
    await this.waitForManualIntervention({
      page,
      trackedPage: false,
      kind: "login",
      url: "https://gemini.google.com/app",
      onStatus
    });
  }

  async waitForGoogleSearchTurn(onWait = () => {}) {
    while (this.manualIntervention) {
      await this.manualIntervention.promise;
    }
    while (true) {
      const now = Date.now();
      const waitMs = Math.max(this.googleNextSearchAt, this.googleCooldownUntil) - now;
      if (waitMs <= 0) {
        this.googleNextSearchAt = Date.now() + this.googleSearchGapMs;
        return;
      }
      onWait(Math.ceil(waitMs / 1000));
      await delay(Math.min(waitMs, 5000));
    }
  }

  noteGoogleCaptcha() {
    this.googleCooldownUntil = Math.max(this.googleCooldownUntil, Date.now() + this.googleCaptchaCooldownMs);
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
      return await context.newPage();
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
    await this.ensureGeminiLogin((status, message) => onProgress({ status, message }));
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

    const requestedParallelism = Math.min(this.parallelism, entries.length);
    const parallelism = this.effectiveParallelism(entries.length);
    this.currentPageLimit = parallelism;
    let nextPosition = 0;
    let completed = 0;
    const adaptiveMessage = this.parallelismAuto && parallelism < requestedParallelism
      ? ` (adaptive safe limit from requested ${requestedParallelism})`
      : "";
    onProgress({
      status: "running",
      processed: 0,
      total: entries.length,
      company: "",
      message: `Starting ${parallelism} parallel Gemini tab${parallelism === 1 ? "" : "s"}${adaptiveMessage}`,
      rows: output
    });

    const workers = Array.from({ length: parallelism }, async (_, workerIndex) => {
      if (workerIndex && this.workerStaggerMs) {
        await new Promise((resolve) => setTimeout(resolve, workerIndex * this.workerStaggerMs));
      }
      while (true) {
        const position = nextPosition;
        nextPosition += 1;
        if (position >= entries.length) {
          break;
        }
        const result = await this.processEntry({
          entry: entries[position],
          position,
          total: entries.length,
          jobDir,
          output,
          workerIndex,
          parallelism,
          completedCount: () => completed,
          onProgress
        });
        completed += 1;
        onProgress({
          status: "running",
          processed: completed,
          total: entries.length,
          company: result.company,
          message: workerMessage(workerIndex, parallelism, result.message),
          rows: output
        });
      }
    });

    await Promise.all(workers);
    return output;
  }

  async processEntry({
    entry,
    position,
    total,
    jobDir,
    output,
    workerIndex,
    parallelism,
    completedCount,
    onProgress
  }) {
    const row = entry.row;
    let observedInterventionSerial = this.interventionSerial;
    let searchPage = null;
    let geminiPage = null;
    let organicResults = [];
    let contactCandidates = [];
    const company = rowCompanyName(row);
    const queryUrl = googleQueryUrl(row);
    const resultListPath = path.join(jobDir, `${String(position + 1).padStart(5, "0")}-google-results.json`);
    const progress = (message, status = "running") => onProgress({
      status,
      processed: completedCount(),
      total,
      company,
      message: workerMessage(workerIndex, parallelism, message)
    });

    try {
      for (let searchAttempt = 0; searchAttempt < 2; searchAttempt += 1) {
        progress(searchAttempt ? "Resuming Google query after CAPTCHA" : "Opening Google query");
        await this.waitForGoogleSearchTurn((seconds) => {
          progress(`Google cooldown ${seconds}s`);
        });
        searchPage = await this.newWorkerPage((freeMemoryMb) => {
          progress(`Waiting for free system memory (${freeMemoryMb} MB available)`);
        });
        await searchPage.goto(queryUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await dismissGoogleConsent(searchPage);
        await searchPage.waitForTimeout(1800);
        const captchaMessage = await googleCaptchaMessage(searchPage);
        if (captchaMessage) {
          const challengeUrl = searchPage.url() || queryUrl;
          const challengePage = searchPage;
          searchPage = null;
          await this.waitForManualIntervention({
            page: challengePage,
            trackedPage: true,
            kind: "captcha",
            url: challengeUrl,
            onStatus: (status, message) => onProgress({
              status,
              processed: completedCount(),
              total,
              company,
              message: workerMessage(workerIndex, parallelism, message)
            })
          });
          observedInterventionSerial = this.interventionSerial;
          continue;
        }
        organicResults = await googleOrganicResults(searchPage, 15);
        break;
      }
      fs.writeFileSync(resultListPath, JSON.stringify({
        queryUrl,
        company,
        country: cleanText(row.country),
        results: organicResults
      }, null, 2));
      if (!organicResults.length) {
        throw new Error("No non-sponsored Google organic results were extracted");
      }
      progress(`Checking organic result pages for visible contacts (${organicResults.length} links)`);
      contactCandidates = await collectContactCandidates(this.context, organicResults, () => {}, searchPage);
      if (this.interventionSerial > observedInterventionSerial) {
        throw new Error("Browser context switched for manual CAPTCHA/login");
      }
      fs.writeFileSync(resultListPath, JSON.stringify({
        queryUrl,
        company,
        country: cleanText(row.country),
        results: organicResults,
        contactCandidates
      }, null, 2));
      const firstOrganicUrl = organicResults[0].url;

      await this.closeWorkerPage(searchPage);
      searchPage = null;

      const openReadyGeminiPage = async () => {
        geminiPage = await this.newWorkerPage((freeMemoryMb) => {
          progress(`Waiting for free system memory (${freeMemoryMb} MB available)`);
        });
        await geminiPage.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded", timeout: 45000 });
        if (await this.waitForPrompt(geminiPage, 15000)) {
          return;
        }
        const loginPage = geminiPage;
        geminiPage = null;
        await this.waitForManualIntervention({
          page: loginPage,
          trackedPage: true,
          kind: "login",
          url: "https://gemini.google.com/app",
          onStatus: (status, message) => onProgress({
            status,
            processed: completedCount(),
            total,
            company,
            message: workerMessage(workerIndex, parallelism, message)
          })
        });
        observedInterventionSerial = this.interventionSerial;
        geminiPage = await this.newWorkerPage((freeMemoryMb) => {
          progress(`Waiting for free system memory (${freeMemoryMb} MB available)`);
        });
        await geminiPage.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded", timeout: 45000 });
        if (!await this.waitForPrompt(geminiPage, 15000)) {
          throw new Error("Gemini prompt was not available after manual login");
        }
      };

      const debugBasePath = path.join(jobDir, String(position + 1).padStart(5, "0"));
      const prompt = resultPrompt(row, queryUrl, organicResults, contactCandidates);
      let parsed = null;
      let usedFallback = false;
      await openReadyGeminiPage();
      await fillPrompt(geminiPage, prompt);
      progress(`Google results sent to Gemini (${organicResults.length} links, ${contactCandidates.length} contact candidates)`);
      await sendPrompt(geminiPage, prompt, debugBasePath);
      progress("Waiting up to 30 seconds for strict Gemini JSON");
      try {
        parsed = await waitForGeminiJson(
          geminiPage,
          this.timeoutMs,
          debugBasePath
        );
      } catch (error) {
        const message = cleanText(error?.message || error);
        if (!isRetryableGeminiJsonError(message)) {
          throw error;
        }
        parsed = fallbackGeminiResult(row, firstOrganicUrl, message);
        usedFallback = true;
      }
      const result = normalizedFirstResult(parsed, row, firstOrganicUrl);
      if (result.phone_number && shouldClearRejectedContact(result)) {
        result.phone_number = "";
      }
      if (result.email && shouldClearRejectedContact(result)) {
        result.email = "";
      }
      if (!result.phone_number) {
        const phoneCandidate = contactCandidates.find((candidate) => candidate.type === "phone" && trustedFallbackCandidate(candidate));
        if (phoneCandidate) {
          result.phone_number = phoneCandidate.value;
          result.source_url = phoneCandidate.source_url || result.source_url;
          result.notes = cleanText(`${result.notes} Phone fallback from rank ${phoneCandidate.rank}: ${phoneCandidate.source_url}.`);
        }
      }
      if (!result.email) {
        const emailCandidate = contactCandidates.find((candidate) => candidate.type === "email" && trustedFallbackCandidate(candidate));
        if (emailCandidate) {
          result.email = emailCandidate.value;
          result.source_url = result.source_url || emailCandidate.source_url;
          result.notes = cleanText(`${result.notes} Email fallback from rank ${emailCandidate.rank}: ${emailCandidate.source_url}.`);
        }
      }
      applyGeminiResult(output, entry, result, resultListPath);
      return {
        company: result.company_name || company,
        message: usedFallback
          ? "Gemini timed out; empty output saved"
          : "Gemini JSON received"
      };
    } catch (error) {
      if (this.interventionSerial > observedInterventionSerial) {
        searchPage = null;
        geminiPage = null;
        while (this.manualIntervention) {
          await this.manualIntervention.promise;
        }
        progress("Retrying row after manual CAPTCHA/login");
        return this.processEntry({
          entry,
          position,
          total,
          jobDir,
          output,
          workerIndex,
          parallelism,
          completedCount,
          onProgress
        });
      }
      const message = cleanText(error?.message || error);
      applySkippedResult(output, entry, message);
      return {
        company,
        message: `Skipped: ${message}`
      };
    } finally {
      await this.closeWorkerPage(searchPage);
      await this.closeWorkerPage(geminiPage);
    }
  }

  async close() {
    await this.closeContext();
  }
}

module.exports = {
  GeminiPlaywrightAgent,
  loadEnv,
  parseJsonObject,
  parseJsonObjects,
  isGeminiResult,
  normalizedResult,
  normalizedFirstResult,
  googleQueryUrl,
  isRetryableGeminiJsonError,
  fallbackGeminiResult,
  clearProfileCaches,
  availableMemoryMb,
  totalMemoryMb,
  adaptiveParallelismLimit,
  hardwareParallelismCap
};
