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
      return host.includes("%") || path.includes("/aclk") || path.includes("/ads/");
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

  function parseChatGPTResponseText(value) {
    try {
      const parsed = JSON.parse(stripJsonFence(value));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
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

  async function enrichRow(row, options = {}) {
    const next = { ...row };
    next.reviewStatus = makeReviewStatus(next);
    return next;
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
    const cache = new Map();

    for (const current of candidates) {
      const key = [
        lowerKey(current.row.websiteName),
        lowerKey(current.row.country),
        normalizeText(current.row.consigneeUrl)
      ].join("|");
      const enriched = cache.has(key)
        ? { ...current.row, ...cache.get(key) }
        : await enrichRow(current.row, options);
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
      parseChatGPTResponseText,
      validWebsiteUrl,
      validPhone
    }
  };
})(window);
