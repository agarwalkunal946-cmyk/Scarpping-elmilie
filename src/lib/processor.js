(function attachProcessor(global) {
  const REPORT_COLUMNS = [
    { key: "hsCode", label: "HS Code" },
    { key: "consignee", label: "Consignee" },
    { key: "exporter", label: "Exporter" },
    { key: "productDescription", label: "Product Description" },
    { key: "country", label: "Country" },
    { key: "quantity", label: "Quantity" },
    { key: "fobValue", label: "FOB Value" }
  ];

  const CONTACT_COLUMNS = [
    { key: "hsCode", label: "HSN Code" },
    { key: "websiteName", label: "Website Name" },
    { key: "websiteUrl", label: "Website URL" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" }
  ];

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const BLOCKED_HOST_PARTS = [
    "google.",
    "googleusercontent.",
    "gstatic.",
    "googleadservices.",
    "doubleclick.",
    "vertexaisearch.cloud.google.com",
    "bing.",
    "duckduckgo.",
    "powerbi.",
    "eximelite.",
    "facebook.",
    "instagram.",
    "linkedin.",
    "youtube.",
    "twitter.",
    "x.com",
    "wikipedia.",
    "reddit.",
    "pinterest.",
    "crunchbase.",
    "bloomberg.",
    "glassdoor.",
    "indeed.",
    "mapquest.",
    "hidubai.",
    "2gis.",
    "indiamart.",
    "tradeindia.",
    "justdial.",
    "sulekha.",
    "yellowpages.",
    "yelp.",
    "kompass.",
    "dnb.",
    "zaubacorp.",
    "tofler.",
    "companycheck.",
    "ambitionbox.",
    "opencorporates.",
    "zoominfo.",
    "rocketreach.",
    "apollo.",
    "signalhire.",
    "seair.",
    "volza.",
    "exportgenius.",
    "importgenius.",
    "eximpedia.",
    "tradeindata.",
    "trademo.",
    "trademe.",
    "panjiva.",
    "importkey.",
    "exporthub.",
    "go4worldbusiness.",
    "connect2india.",
    "fliarbi.",
    "falconebiz.",
    "companylist.",
    "yelu.",
    "cybo.",
    "yellow.place",
    "localsearch.",
    "clutch.",
    "sortlist.",
    "businesslist.",
    "uaeplusplus.",
    "dubiki.",
    "aihitdata.",
    "thecompanycheck.",
    "corporatedir.",
    "globaldatabase.",
    "sgpbusiness.",
    "opensanctions.",
    "datanyze.",
    "lusha.",
    "hunter.io",
    "clearbit.",
    "lead411.",
    "adapt.io",
    "salesblink.",
    "skrapp.",
    "arounddeal.",
    "growjo."
  ];

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lowerKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function cleanUrl(value) {
    const raw = normalizeText(value).replace(/[),.;]+$/g, "");
    if (!raw) {
      return "";
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || !hasUsableWebsiteHost(parsed) || isBlockedWebsite(parsed.href)) {
        return "";
      }
      parsed.hash = "";
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  function isLikelyUrl(value) {
    return /^(?:https?:\/\/|www\.)/i.test(normalizeText(value));
  }

  function isValidHsCode(value) {
    return /^\d{4,10}$/.test(normalizeText(value).replace(/\s/g, ""));
  }

  function normalizeHsCode(value) {
    return normalizeText(value).replace(/\s/g, "");
  }

  function isSelectorOrHeaderText(value) {
    const key = lowerKey(value);
    return key === "select row"
      || key === "selected row"
      || key === "row selector"
      || key === "hs"
      || key === "hs code"
      || key === "hsn"
      || key === "hsn code";
  }

  function safeCompanyName(value) {
    const name = cleanCompanyName(value);
    if (!name || isSelectorOrHeaderText(name) || isValidHsCode(name)) {
      return "";
    }
    return name;
  }

  function stripTrailingCountry(companyName, country) {
    const name = normalizeText(companyName);
    const countryText = normalizeText(country);
    const countryKey = lowerKey(countryText);
    if (!name || !countryKey) {
      return name;
    }

    const nameKey = lowerKey(name);
    if (!nameKey.endsWith(` ${countryKey}`)) {
      return name;
    }

    const nameParts = name.split(/\s+/);
    const countryPartCount = countryKey.split(" ").length;
    if (nameParts.length <= countryPartCount) {
      return name;
    }
    return nameParts.slice(0, -countryPartCount).join(" ");
  }

  function normalizeExternalLink(value) {
    const text = normalizeText(value);
    if (!text) {
      return "";
    }
    if (/^https?:\/\//i.test(text)) {
      return text;
    }
    if (/^\/\//.test(text)) {
      return `https:${text}`;
    }
    return "";
  }

  function linkFromRaw(explicit, value) {
    return normalizeExternalLink(explicit) || normalizeExternalLink(value);
  }

  function companyFromSearchUrl(value) {
    const text = normalizeText(value);
    if (!isLikelyUrl(text)) {
      return text;
    }
    try {
      const parsed = new URL(text);
      const host = parsed.hostname.toLowerCase();
      if (host === "google.com" || host.endsWith(".google.com")) {
        const query = parsed.searchParams.get("q") || parsed.searchParams.get("query");
        return cleanCompanyName(query || "");
      }
      if (host === "bing.com" || host.endsWith(".bing.com")) {
        return cleanCompanyName(parsed.searchParams.get("q") || "");
      }
      if (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) {
        return cleanCompanyName(parsed.searchParams.get("q") || "");
      }
      return "";
    } catch (error) {
      return "";
    }
  }

  function safeDecodeCompanyText(value) {
    const text = String(value || "").replace(/\+/g, " ");
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text.replace(/%20/gi, " ").replace(/%[0-9a-f]{0,2}/gi, " ");
    }
  }

  function cleanCompanyName(value) {
    return normalizeText(safeDecodeCompanyText(value))
      .replace(/\b(?:official website|website|email|phone|contact)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isBlockedWebsite(value) {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (host.includes("%") || path.includes("/aclk") || path.includes("/ads/")) {
        return true;
      }
      if (BLOCKED_HOST_PARTS.some((part) => {
        if (part.endsWith(".")) {
          return host.includes(part);
        }
        return host === part || host.endsWith("." + part);
      })) {
        return true;
      }
      return false;
    } catch (error) {
      return true;
    }
  }

  function hasUsableWebsiteHost(parsed) {
    const host = parsed.hostname.toLowerCase();
    return Boolean(host)
      && !host.includes("%")
      && !host.includes(" ")
      && !/^\d+(?:\.\d+){3}$/.test(host)
      && host.includes(".");
  }

  function validPhone(value, options = {}) {
    const text = normalizeText(value);
    const digits = text.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15 || !/(?:\+?\d[\d\s().-]{8,}\d)/.test(text)) {
      return false;
    }
    if (/^(\d)\1+$/.test(digits)) {
      return false;
    }
    const trimmed = text.trim();
    const hasInternationalSignal = trimmed.startsWith("+") || digits.startsWith("00");
    const trustedContext = options.allowCompact === true || options.labelled === true;
    if (!hasInternationalSignal && !trustedContext) {
      return false;
    }
    return true;
  }

  function normalizePhones(values) {
    return uniqueJoined(values.flatMap(splitValues).filter((value) => validPhone(value)));
  }

  function normalizeWebsites(values) {
    return uniqueJoined(values.flatMap(splitValues).map(cleanUrl).filter(Boolean));
  }

  function validWebsiteUrl(value) {
    const url = cleanUrl(value);
    if (!url) {
      return "";
    }
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol) && hasUsableWebsiteHost(parsed) && !isBlockedWebsite(url) ? url : "";
    } catch (error) {
      return "";
    }
  }

  function splitValues(value) {
    return normalizeText(value)
      .split(/[;,]\s*/)
      .map(normalizeText)
      .filter(Boolean);
  }

  function uniqueJoined(values) {
    const seen = new Set();
    const output = [];
    for (const value of values.flatMap(splitValues)) {
      const key = lowerKey(value);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(value);
    }
    return output.join("; ");
  }

  function chooseCompany(row, companySource) {
    const consignee = safeCompanyName(stripTrailingCountry(companyFromSearchUrl(row.consignee), row.country));
    const exporter = safeCompanyName(stripTrailingCountry(companyFromSearchUrl(row.exporter), row.country));
    if (companySource === "exporter") {
      return normalizeText(exporter || consignee);
    }
    if (companySource === "both") {
      return uniqueJoined([consignee, exporter]);
    }
    return normalizeText(consignee || exporter);
  }

  function makeReviewStatus(row) {
    if (row.email || row.phone) {
      return row.websiteUrl ? "Contact found" : "Contact found, website missing";
    }
    if (row.websiteUrl) {
      return "Website found, contact unavailable";
    }
    return "Website not found";
  }

  function firstJoinedValue(value) {
    return splitValues(value)[0] || "";
  }

  function normalizeRow(raw, settings) {
    const companyName = chooseCompany(raw, settings.companySource || "consignee");
    const contactHints = extractContactHints([raw.websiteUrl, raw.website, raw.email, raw.phone].join(" "));
    const websiteUrl = firstJoinedValue(normalizeWebsites([
      raw.websiteUrl,
      raw.website,
      contactHints.websites.join("; ")
    ]));
    const email = firstJoinedValue(uniqueJoined([raw.email, contactHints.emails.join("; ")]));
    const phone = firstJoinedValue(normalizePhones([raw.phone, contactHints.phones.join("; ")]));
    const row = {
      hsCode: normalizeHsCode(raw.hsCode),
      websiteName: companyName,
      websiteUrl,
      email,
      phone,
      reviewStatus: "",
      contactSource: email || phone || websiteUrl ? "Report/table text" : "",
      companyName,
      consignee: safeCompanyName(stripTrailingCountry(companyFromSearchUrl(raw.consignee), raw.country)),
      consigneeUrl: linkFromRaw(raw.consigneeUrl, raw.consignee),
      exporter: safeCompanyName(stripTrailingCountry(companyFromSearchUrl(raw.exporter), raw.country)),
      exporterUrl: linkFromRaw(raw.exporterUrl, raw.exporter),
      productDescription: normalizeText(raw.productDescription),
      country: normalizeText(raw.country),
      quantity: normalizeText(raw.quantity),
      fobValue: normalizeText(raw.fobValue),
      duplicateCount: Number(raw.duplicateCount || 1),
      sourceMethod: normalizeText(raw.sourceMethod),
      sourceFrame: normalizeText(raw.sourceFrame),
      capturedAt: normalizeText(raw.capturedAt || new Date().toISOString())
    };
    row.reviewStatus = makeReviewStatus(row);
    return row;
  }

  function extractContactHints(text) {
    const emails = new Set((text.match(EMAIL_RE) || []).map((email) => email.toLowerCase()));
    const phones = new Set((text.match(PHONE_RE) || []).map(normalizeText).filter(validPhone));
    const websites = new Set((text.match(URL_RE) || []).map(cleanUrl));
    return {
      emails: [...emails],
      phones: [...phones],
      websites: [...websites].filter(Boolean)
    };
  }

  function dedupeKey(row) {
    return [row.hsCode, row.websiteName, row.country].map(lowerKey).join("|");
  }

  function mergeValue(current, incoming) {
    const left = normalizeText(current);
    const right = normalizeText(incoming);
    if (!left || left === right) {
      return right || left;
    }
    if (!right) {
      return left;
    }
    return `${left}; ${right}`;
  }

  function mergeUrlValue(current, incoming) {
    const left = normalizeExternalLink(current);
    const right = normalizeExternalLink(incoming);
    return left || right || normalizeText(current) || normalizeText(incoming);
  }

  function mergeRows(current, incoming) {
    const merged = { ...current };
    for (const key of Object.keys(incoming)) {
      if (["duplicateCount", "reviewStatus", "contactSource"].includes(key)) {
        continue;
      }
      merged[key] = /Url$/.test(key) ? mergeUrlValue(current[key], incoming[key]) : mergeValue(current[key], incoming[key]);
    }
    merged.duplicateCount = Number(current.duplicateCount || 1) + Number(incoming.duplicateCount || 1);
    merged.contactSource = uniqueJoined([current.contactSource, incoming.contactSource]);
    merged.reviewStatus = makeReviewStatus(merged);
    return merged;
  }

  function processRows(rawRows, settings = {}) {
    const normalized = rawRows
      .map((row) => normalizeRow(row, settings))
      .filter((row) => isValidHsCode(row.hsCode) && row.consignee && row.exporter);

    if (settings.dedupe === false) {
      return {
        rows: normalized,
        duplicatesRemoved: 0,
        columns: CONTACT_COLUMNS
      };
    }

    const byKey = new Map();
    let duplicatesRemoved = 0;
    for (const row of normalized) {
      const key = dedupeKey(row);
      if (!key.trim()) {
        continue;
      }
      if (byKey.has(key)) {
        byKey.set(key, mergeRows(byKey.get(key), row));
        duplicatesRemoved += 1;
      } else {
        byKey.set(key, row);
      }
    }

    return {
      rows: [...byKey.values()],
      duplicatesRemoved,
      columns: CONTACT_COLUMNS
    };
  }

  function summary(rows, duplicatesRemoved = 0) {
    return {
      total: rows.length,
      withWebsite: rows.filter((row) => row.websiteUrl).length,
      withEmail: rows.filter((row) => row.email).length,
      withPhone: rows.filter((row) => row.phone).length,
      duplicatesRemoved
    };
  }

  function websiteCandidates(row) {
    return splitValues(row.websiteUrl)
      .map(cleanUrl)
      .filter(Boolean)
      .filter((url) => {
        try {
          const parsed = new URL(url);
          return ["http:", "https:"].includes(parsed.protocol) && !isBlockedWebsite(url);
        } catch (error) {
          return false;
        }
      });
  }

  async function fetchGeminiResponse(url, timeoutMs = 9000, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        credentials: init.credentials || "omit",
        redirect: init.redirect || "follow",
        cache: init.cache || "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      const readable = /text|html|xml|json/i.test(contentType);
      const html = readable ? await response.text() : "";
      return {
        html,
        url: response.url || url,
        status: response.status,
        ok: response.ok
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function googleSearchUrlForRow(row) {
    const exact = normalizeExternalLink(row.consigneeUrl);
    try {
      if (exact) {
        const parsed = new URL(exact);
        if ((parsed.hostname === "google.com" || parsed.hostname.endsWith(".google.com")) && parsed.searchParams.get("q")) {
          return exact;
        }
      }
    } catch (error) {
      // Fall through to a stable query built from the report row.
    }
    const query = [row.websiteName || row.companyName, row.country].map(normalizeText).filter(Boolean).join(" ");
    return query ? "https://www.google.com/search?num=10&hl=en&q=" + encodeURIComponent(query) : "";
  }

  function normalizeEmail(value) {
    const email = normalizeText(value)
      .replace(/^mailto:/i, "")
      .split(/[?&#]/)[0]
      .replace(/[),.;:]+$/g, "")
      .toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return "";
    }
    if (/example\.(?:com|org|net)$|sentry\.io$|wixpress\.com$|cloudflare\.com$|schema\.org$/i.test(email)) {
      return "";
    }
    return email;
  }

  function normalizePhone(value) {
    const text = normalizeText(value);
    const isTel = /^tel:/i.test(text);
    const raw = text.replace(/^tel:/i, "").split(/[?&#]/)[0];
    if (!validPhone(raw, { allowCompact: isTel })) {
      return "";
    }
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  function stripJsonFence(value) {
    const text = String(value || "").trim();
    const fence = "```";
    if (text.startsWith(fence)) {
      let body = text.slice(fence.length).trim();
      if (body.toLowerCase().startsWith("json")) {
        body = body.slice(4).trim();
      }
      const end = body.lastIndexOf(fence);
      return (end >= 0 ? body.slice(0, end) : body).trim();
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return text.slice(first, last + 1);
    }
    return text;
  }

  function parseGeminiResponseText(value) {
    try {
      const parsed = JSON.parse(stripJsonFence(value));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function collectGeminiText(response) {
    return (response?.candidates || [])
      .flatMap((candidate) => candidate?.content?.parts || [])
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function collectGroundingUrls(response) {
    return (response?.candidates || [])
      .flatMap((candidate) => candidate?.groundingMetadata?.groundingChunks || [])
      .map((chunk) => chunk?.web?.uri || "")
      .filter(Boolean);
  }

  function normalizeSourceUrls(values) {
    const input = Array.isArray(values) ? values : splitValues(values);
    const output = [];
    for (const value of input) {
      const url = validWebsiteUrl(value);
      if (url) {
        output.push(url);
      }
    }
    return [...new Set(output)];
  }

  function sourceValues(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value == null) {
      return [];
    }
    return splitValues(value);
  }

  function normalizeGeminiContact(parsed = {}, groundingUrls = []) {
    const sourceUrls = sourceValues(parsed.sourceUrls);
    const mergedSources = normalizeSourceUrls([
      ...sourceUrls,
      ...(sourceUrls.length ? [] : groundingUrls)
    ]);
    const websiteUrl = validWebsiteUrl(parsed.websiteUrl);
    if (!websiteUrl) {
      return {
        websiteUrl: "",
        email: "",
        phone: "",
        source: "Gemini official website unavailable",
        sourceUrls: mergedSources,
        confidence: Number(parsed.confidence || 0),
        notes: normalizeText(parsed.notes)
      };
    }
    const email = normalizeEmail(parsed.email);
    const phone = normalizePhone(parsed.phone) || (validPhone(parsed.phone, { allowCompact: true }) ? normalizeText(parsed.phone) : "");
    return {
      websiteUrl,
      email,
      phone,
      source: "Gemini Google Search: " + websiteUrl,
      sourceUrls: mergedSources,
      confidence: Number(parsed.confidence || 0),
      notes: normalizeText(parsed.notes)
    };
  }

  function failedGeminiContact(message) {
    return {
      websiteUrl: "",
      email: "",
      phone: "",
      source: "Gemini lookup failed: " + normalizeText(message || "Gemini request failed"),
      sourceUrls: []
    };
  }

  function geminiPrompt(row) {
    const company = normalizeText(row.websiteName || row.companyName || row.consignee);
    const country = normalizeText(row.country);
    const hsn = normalizeText(row.hsCode);
    const googleUrl = googleSearchUrlForRow(row);
    return [
      "You are filling an Excel export for an EXIM/Power BI trade report.",
      "Use Google Search grounding only. Do not guess and do not use sponsored results.",
      "Task: find the real official active website, public email, and public phone for the exact company.",
      "Reject sponsored results, ads, Google redirects, social profiles, map listings, marketplaces, trade portals, import/export data portals, data brokers, directories, profile pages, news pages, and unrelated similarly named companies.",
      "Blocked examples: Eximpedia, TradeInData, Trademo, Trademe, Volza, Seair, ExportGenius, ImportGenius, Panjiva, ZaubaCorp, Tofler, DNB, LinkedIn, Facebook, Instagram, YouTube, IndiaMART, TradeIndia, Justdial, Sulekha, YellowPages, Yelp, Kompass, ZoomInfo, Apollo, RocketReach, Crunchbase, Google cache/redirect URLs.",
      "Website rule: websiteUrl must be the company's own official domain. If Google only shows trade/data portals or AI says no official active website exists, return an empty websiteUrl.",
      "Contact rule: email and phone must belong to that same official company/domain. Never return a portal's email/phone, for example never use info@eximpedia.app or Eximpedia phone for another company.",
      "If official website/contact details cannot be verified from grounded Google results/snippets, return empty strings for those fields.",
      "Prefer a direct business email such as info/contact/sales if it is clearly for the company. Format phone with country code where available.",
      "Return only compact JSON with keys: websiteUrl, email, phone, confidence, sourceUrls, notes.",
      "Company: " + company,
      "Country: " + country,
      "HSN Code: " + hsn,
      "Reference Google query URL: " + googleUrl
    ].join("\n");
  }

  function geminiPayload(row, tools, withSchema) {
    const payload = {
      contents: [{
        role: "user",
        parts: [{ text: geminiPrompt(row) }]
      }],
      tools,
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    };
    if (withSchema) {
      payload.generationConfig.responseSchema = {
        type: "object",
        properties: {
          websiteUrl: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          confidence: { type: "number" },
          sourceUrls: { type: "array", items: { type: "string" } },
          notes: { type: "string" }
        },
        required: ["websiteUrl", "email", "phone", "confidence", "sourceUrls"]
      };
    }
    return payload;
  }

  function geminiBatchItems(candidates) {
    return candidates.map(({ row, index }) => ({
      index,
      company: normalizeText(row.websiteName || row.companyName || row.consignee),
      country: normalizeText(row.country),
      hsnCode: normalizeText(row.hsCode),
      googleQueryUrl: googleSearchUrlForRow(row)
    }));
  }

  function geminiBatchPrompt(candidates) {
    return [
      "You are filling an Excel export for an EXIM/Power BI trade report.",
      "Use Google Search grounding only. Do not guess and do not use sponsored results.",
      "Task: for every input row, find the real official active website, public email, and public phone for the exact company.",
      "Process the whole input table in this single request and return one result for every input index.",
      "Reject sponsored results, ads, Google redirects, social profiles, map listings, marketplaces, trade portals, import/export data portals, data brokers, directories, profile pages, news pages, and unrelated similarly named companies.",
      "Blocked examples: Eximpedia, TradeInData, Trademo, Trademe, Volza, Seair, ExportGenius, ImportGenius, Panjiva, ZaubaCorp, Tofler, DNB, LinkedIn, Facebook, Instagram, YouTube, IndiaMART, TradeIndia, Justdial, Sulekha, YellowPages, Yelp, Kompass, ZoomInfo, Apollo, RocketReach, Crunchbase, Google cache/redirect URLs.",
      "Website rule: websiteUrl must be the company's own official domain. If Google only shows trade/data portals or AI says no official active website exists, return an empty websiteUrl.",
      "Contact rule: email and phone must belong to that same official company/domain. Never return a portal's email/phone, for example never use info@eximpedia.app or Eximpedia phone for another company.",
      "If official website/contact details cannot be verified from grounded Google results/snippets, return empty strings for those fields.",
      "Prefer a direct business email such as info/contact/sales if it is clearly for the company. Format phone with country code where available.",
      "Return only compact JSON. Shape: {\"results\":[{\"index\":0,\"websiteUrl\":\"\",\"email\":\"\",\"phone\":\"\",\"confidence\":0,\"sourceUrls\":[],\"notes\":\"\"}]}",
      "Input rows JSON:",
      JSON.stringify(geminiBatchItems(candidates))
    ].join("\n");
  }

  function geminiBatchPayload(candidates, tools, withSchema) {
    const payload = {
      contents: [{
        role: "user",
        parts: [{ text: geminiBatchPrompt(candidates) }]
      }],
      tools,
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 12000
      }
    };
    if (withSchema) {
      payload.generationConfig.responseSchema = {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "number" },
                websiteUrl: { type: "string" },
                email: { type: "string" },
                phone: { type: "string" },
                confidence: { type: "number" },
                sourceUrls: { type: "array", items: { type: "string" } },
                notes: { type: "string" }
              },
              required: ["index", "websiteUrl", "email", "phone", "confidence", "sourceUrls"]
            }
          }
        },
        required: ["results"]
      };
    }
    return payload;
  }

  function geminiEndpoint(model) {
    return "https://generativelanguage.googleapis.com/v1beta/models/"
      + encodeURIComponent(model)
      + ":generateContent";
  }

  function batchResultList(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.results)) {
      return parsed.results;
    }
    if (Array.isArray(parsed.rows)) {
      return parsed.rows;
    }
    if (Array.isArray(parsed.companies)) {
      return parsed.companies;
    }
    return [];
  }

  async function geminiBatchContactLookup(candidates, options = {}) {
    const apiKey = normalizeText(options.geminiApiKey);
    const activeCandidates = candidates.filter(({ row }) => normalizeText(row.websiteName || row.companyName || row.consignee));
    const results = new Map();
    if (options.geminiEnabled === false || !apiKey || !activeCandidates.length) {
      return { results, error: "" };
    }

    const model = normalizeText(options.geminiModel) || "gemini-2.5-flash";
    const supportsToolSchema = /^gemini-3(?:\.|-|$)/i.test(model);
    const payload = geminiBatchPayload(activeCandidates, [{ google_search: {} }], supportsToolSchema);
    let lastError = "";

    try {
      const page = await fetchGeminiResponse(geminiEndpoint(model), options.geminiTimeoutMs || 45000, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(payload),
        credentials: "omit"
      });
      if (!page.html) {
        lastError = "empty Gemini response (HTTP " + page.status + ")";
      } else {
        const json = JSON.parse(page.html);
        if (json.error) {
          lastError = json.error.message || "Gemini API error";
        } else {
          const parsed = parseGeminiResponseText(collectGeminiText(json));
          const groundingUrls = collectGroundingUrls(json);
          const allowedIndexes = new Set(activeCandidates.map(({ index }) => index));
          for (const result of batchResultList(parsed)) {
            const index = Number(result?.index);
            if (allowedIndexes.has(index)) {
              results.set(index, normalizeGeminiContact(result, groundingUrls));
            }
          }
          if (!results.size) {
            lastError = "Gemini batch response did not include usable results";
          }
        }
      }
    } catch (error) {
      lastError = error?.message || error?.name || "Gemini request failed";
    }

    if (lastError) {
      for (const { index } of activeCandidates) {
        results.set(index, failedGeminiContact(lastError));
      }
    }
    return { results, error: lastError };
  }

  async function geminiContactLookup(row, options = {}) {
    const apiKey = normalizeText(options.geminiApiKey);
    if (options.geminiEnabled === false || !apiKey || !normalizeText(row.websiteName || row.companyName || row.consignee)) {
      return { websiteUrl: "", email: "", phone: "", source: "", sourceUrls: [] };
    }

    const model = normalizeText(options.geminiModel) || "gemini-2.5-flash";
    const endpoint = geminiEndpoint(model);
    const supportsToolSchema = /^gemini-3(?:\.|-|$)/i.test(model);
    const payloads = [geminiPayload(row, [{ google_search: {} }], supportsToolSchema)];
    let lastError = "";

    for (const payload of payloads) {
      try {
        const page = await fetchGeminiResponse(endpoint, options.geminiTimeoutMs || 18000, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(payload),
          credentials: "omit"
        });
        if (!page.html) {
          lastError = "empty Gemini response (HTTP " + page.status + ")";
          continue;
        }
        const json = JSON.parse(page.html);
        if (json.error) {
          lastError = json.error.message || "Gemini API error";
          continue;
        }
        return normalizeGeminiContact(parseGeminiResponseText(collectGeminiText(json)), collectGroundingUrls(json));
      } catch (error) {
        lastError = error?.message || error?.name || "Gemini request failed";
      }
    }

    return {
      ...failedGeminiContact(lastError)
    };
  }

  function applyGeminiContact(row, ai) {
    const next = {
      ...row,
      websiteUrl: validWebsiteUrl(ai.websiteUrl),
      email: normalizeEmail(ai.email),
      phone: normalizePhone(ai.phone) || (validPhone(ai.phone, { allowCompact: true }) ? normalizeText(ai.phone) : ""),
      contactSource: uniqueJoined([
        ai.source,
        ...(ai.sourceUrls || []),
        ai.notes
      ])
    };
    next.reviewStatus = makeReviewStatus(next);
    return next;
  }

  async function enrichRow(row, options = {}) {
    return applyGeminiContact(row, await geminiContactLookup(row, options));
  }

  async function enrichRows(rows, options = {}, onProgress = () => {}) {
    const requestedLimit = Number(options.limit || 0);
    const limit = requestedLimit > 0 ? requestedLimit : rows.length;
    const output = [...rows];
    const candidates = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.websiteName)
      .slice(0, limit);
    let processed = 0;
    const batch = await geminiBatchContactLookup(candidates, options);
    const cache = new Map();

    for (const current of candidates) {
      const key = [
        lowerKey(current.row.websiteName),
        lowerKey(current.row.country),
        normalizeText(current.row.consigneeUrl)
      ].join("|");
      const enriched = cache.has(key)
        ? { ...current.row, ...cache.get(key) }
        : applyGeminiContact(current.row, batch.results.get(current.index) || {});
      cache.set(key, {
        websiteUrl: enriched.websiteUrl,
        email: enriched.email,
        phone: enriched.phone,
        contactSource: enriched.contactSource,
        reviewStatus: enriched.reviewStatus
      });
      output[current.index] = enriched;
      processed += 1;
      onProgress({ processed, total: candidates.length, row: enriched });
    }
    return output;
  }

  global.EximProcessor = {
    columns: CONTACT_COLUMNS,
    reportColumns: REPORT_COLUMNS,
    contactColumns: CONTACT_COLUMNS,
    processRows,
    summary,
    enrichRows,
    websiteCandidates,
    cleanUrl,
    uniqueJoined,
    test: {
      googleSearchUrlForRow,
      parseGeminiResponseText,
      validWebsiteUrl,
      validPhone
    }
  };
})(window);
