(() => {
  if (window.__EXIM_ELITE_EXTRACTOR__) {
    return;
  }

  const FIELD_ALIASES = {
    hsCode: ["hs code", "hsn code", "hscode", "hsn", "hs"],
    consignee: ["consignee", "buyer", "importer"],
    exporter: ["exporter", "seller", "shipper"],
    productDescription: ["product description", "description", "product"],
    country: ["country", "destination", "origin"],
    quantity: ["quantity", "qty"],
    fobValue: ["fob value", "fob", "value"]
  };

  const POSITIONAL_FIELDS = [
    "hsCode",
    "consignee",
    "exporter",
    "productDescription",
    "country",
    "quantity",
    "fobValue"
  ];

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/;
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const POWER_BI_CELL_SELECTOR = [
    ".tablixCellContent",
    ".pivotTableCellWrap",
    ".pivotTableCellNoWrap",
    ".cell-interactive",
    ".tableEx [role='gridcell']",
    ".tableEx [role='cell']",
    ".tableEx [role='columnheader']",
    ".bodyCells [role='gridcell']",
    ".columnHeaders [role='columnheader']",
    "[data-automation-type='visualContainer'] [role='gridcell']",
    "[data-automation-type='visualContainer'] [role='cell']",
    "[data-testid*='cell' i]",
    "[class*='tablix' i] [role='gridcell']",
    "[class*='pivot' i] [role='gridcell']"
  ].join(", ");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lowerKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isLikelyUrl(value) {
    return /^(?:https?:\/\/|www\.)/i.test(normalizeText(value));
  }

  function cleanDataText(value) {
    let text = normalizeText(value)
      .replace(/^[\s:.-]+|[\s:.-]+$/g, "")
      .replace(/\b(?:selected|not selected|blank|null)\b/gi, "")
      .replace(/\b(?:row|column)\s+\d+\b/gi, "");

    for (const aliases of Object.values(FIELD_ALIASES)) {
      for (const alias of aliases) {
        const escaped = escapeRegExp(alias);
        text = text
          .replace(new RegExp(`^${escaped}\\s*[:\\-]?\\s+`, "i"), "")
          .replace(new RegExp(`\\s+${escaped}\\s*[:\\-]?$`, "i"), "");
      }
    }

    return normalizeText(text);
  }

  function isSelectorCellText(value) {
    const key = lowerKey(value);
    return key === "select row"
      || key === "selected row"
      || key === "row selector"
      || key === "select"
      || key === "checkbox";
  }

  function stripSelectorElements(elements) {
    return elements.filter((element) => {
      const rawText = readElementText(element, { raw: true });
      const text = cleanDataText(rawText);
      return !isSelectorCellText(rawText) && !isSelectorCellText(text);
    });
  }

  function stripSelectorItems(items) {
    return items.filter((item) => !isSelectorCellText(item.rawText || item.text));
  }

  function isValidHsCode(value) {
    return /^\d{4,10}$/.test(normalizeText(value).replace(/\s/g, ""));
  }

  function bestText(values) {
    const cleaned = values.map(normalizeText).filter(Boolean);
    if (!cleaned.length) {
      return "";
    }

    const withoutUiNoise = cleaned
      .filter((value) => !/^(sort|more options|focus mode|back to report|microsoft power bi)$/i.test(value))
      .filter((value) => !/^https?:\/\/app\.powerbi\.com/i.test(value));

    const nonUrlCandidates = withoutUiNoise.filter((value) => !isLikelyUrl(value));
    const candidates = nonUrlCandidates.length ? nonUrlCandidates : (withoutUiNoise.length ? withoutUiNoise : cleaned);
    return candidates.sort((a, b) => {
      const aHasEllipsis = /…|\.\.\./.test(a) ? 1 : 0;
      const bHasEllipsis = /…|\.\.\./.test(b) ? 1 : 0;
      if (aHasEllipsis !== bHasEllipsis) {
        return aHasEllipsis - bHasEllipsis;
      }
      return b.length - a.length;
    })[0];
  }

  function readElementText(element, options = {}) {
    if (!element) {
      return "";
    }

    const attrs = [
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-tooltip"),
      element.getAttribute?.("data-value"),
      element.getAttribute?.("data-text"),
      element.getAttribute?.("alt"),
      element.getAttribute?.("value")
    ];
    const descendants = [];
    if (element.querySelectorAll && (options.includeDescendants || element.children.length <= 8)) {
      for (const child of element.querySelectorAll("[title], [aria-label], [data-tooltip], [data-value]")) {
        descendants.push(
          child.getAttribute("title"),
          child.getAttribute("aria-label"),
          child.getAttribute("data-tooltip"),
          child.getAttribute("data-value")
        );
      }
    }

    const text = bestText([
      element.innerText,
      element.textContent,
      ...attrs,
      ...descendants
    ]);

    return options.raw ? normalizeText(text) : cleanDataText(text);
  }

  function visible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  }

  function firstMatch(values, aliases) {
    const cleanAliases = aliases.map(lowerKey);
    for (const value of values) {
      const key = lowerKey(value);
      if (cleanAliases.some((alias) => key === alias || key.includes(alias))) {
        return value;
      }
    }
    return "";
  }

  function fieldForHeader(headerText) {
    const key = lowerKey(headerText);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((alias) => key === alias || key.includes(alias))) {
        return field;
      }
    }
    return "";
  }

  function readLinks(container) {
    const links = [];
    if (!container || !container.querySelectorAll) {
      return links;
    }

    for (const anchor of container.querySelectorAll("a[href]")) {
      const href = normalizeText(anchor.href || anchor.getAttribute("href"));
      const label = readElementText(anchor);
      if (!href || href === "#") {
        continue;
      }
      links.push({
        href,
        label,
        kind: href.startsWith("mailto:")
          ? "email"
          : href.startsWith("tel:")
            ? "phone"
            : /^https?:\/\//i.test(href)
              ? "website"
              : "link"
      });
    }
    return links;
  }

  function linkForValue(links, value) {
    const valueKey = lowerKey(value);
    if (!valueKey) {
      return "";
    }
    const candidates = (links || []).filter((link) => /^https?:\/\//i.test(link.href));
    const exact = candidates.find((link) => lowerKey(link.label) === valueKey);
    if (exact) {
      return exact.href;
    }
    const fuzzy = candidates.find((link) => {
      const labelKey = lowerKey(link.label);
      return labelKey && (labelKey.includes(valueKey) || valueKey.includes(labelKey));
    });
    return fuzzy?.href || "";
  }

  function extractContactHints(text, links) {
    const emails = new Set((text.match(EMAIL_RE) || []).map((email) => email.toLowerCase()));
    const phones = new Set();
    const websites = new Set();

    for (const url of text.match(URL_RE) || []) {
      websites.add(cleanUrl(url));
    }

    for (const link of links || []) {
      if (link.kind === "email") {
        emails.add(link.href.replace(/^mailto:/i, "").split("?")[0].toLowerCase());
      } else if (link.kind === "phone") {
        const phone = normalizeText(link.href.replace(/^tel:/i, ""));
        if (validPhone(phone)) {
          phones.add(phone);
        }
      } else if (link.kind === "website") {
        websites.add(cleanUrl(link.href));
      }
    }

    return {
      email: [...emails].join("; "),
      phone: [...phones].join("; "),
      website: [...websites].join("; ")
    };
  }

  function cleanUrl(value) {
    const raw = normalizeText(value).replace(/[),.;]+$/g, "");
    if (!raw) {
      return "";
    }
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }

  function validPhone(value) {
    const text = normalizeText(value);
    const digits = text.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 && PHONE_RE.test(text);
  }

  function makeRow(fields, source) {
    const text = Object.values(fields).join(" ");
    const hints = extractContactHints(text, fields.__links || []);
    const links = fields.__links || [];
    const row = {
      hsCode: normalizeText(fields.hsCode),
      consignee: normalizeText(fields.consignee),
      consigneeUrl: normalizeText(fields.consigneeUrl || linkForValue(links, fields.consignee)),
      exporter: normalizeText(fields.exporter),
      exporterUrl: normalizeText(fields.exporterUrl || linkForValue(links, fields.exporter)),
      productDescription: normalizeText(fields.productDescription),
      country: normalizeText(fields.country),
      quantity: normalizeText(fields.quantity),
      fobValue: normalizeText(fields.fobValue),
      website: normalizeText(fields.website || hints.website),
      email: normalizeText(fields.email || hints.email),
      phone: normalizeText(fields.phone || hints.phone),
      detailUrl: normalizeText(fields.detailUrl),
      sourceMethod: source.method,
      sourceFrame: window.location.href,
      sourcePageTitle: document.title,
      capturedAt: new Date().toISOString()
    };

    if (!isLikelyDataRow(row)) {
      return null;
    }
    return row;
  }

  function isLikelyDataRow(row) {
    const hs = normalizeText(row.hsCode);
    const consignee = normalizeText(row.consignee);
    const exporter = normalizeText(row.exporter);

    if (!consignee || !exporter) {
      return false;
    }
    if (lowerKey(consignee).includes("consignee") || lowerKey(exporter).includes("exporter")) {
      return false;
    }
    if (isSelectorCellText(hs) || isSelectorCellText(consignee) || isSelectorCellText(exporter)) {
      return false;
    }
    if (/^(hs|hs code|hsn|hsn code)$/i.test(hs) || !isValidHsCode(hs)) {
      return false;
    }
    if (isValidHsCode(consignee) || isValidHsCode(exporter)) {
      return false;
    }
    return true;
  }

  function extractFromHtmlTables(root) {
    const rows = [];
    for (const table of root.querySelectorAll("table")) {
      if (!visible(table)) {
        continue;
      }
      const trs = [...table.querySelectorAll("tr")].filter(visible);
      if (trs.length < 2) {
        continue;
      }

      let headers = stripSelectorElements([...trs[0].querySelectorAll("th,td")])
        .map((cell) => readElementText(cell, { raw: true }));
      if (!headers.some((header) => fieldForHeader(header))) {
        const headerRow = trs.find((tr) => [...tr.querySelectorAll("th,td")].some((cell) => fieldForHeader(readElementText(cell, { raw: true }))));
        if (headerRow) {
          headers = stripSelectorElements([...headerRow.querySelectorAll("th,td")])
            .map((cell) => readElementText(cell, { raw: true }));
        }
      }

      const fieldMap = headers.map((header, index) => fieldForHeader(header) || POSITIONAL_FIELDS[index] || "");

      for (const tr of trs) {
        const cells = stripSelectorElements([...tr.querySelectorAll("td")]);
        if (cells.length < 3) {
          continue;
        }
        const fields = { __links: readLinks(tr) };
        cells.forEach((cell, index) => {
          const field = fieldMap[index] || POSITIONAL_FIELDS[index];
          if (field) {
            fields[field] = readElementText(cell);
          }
        });
        const row = makeRow(fields, { method: "html-table" });
        if (row) {
          rows.push(row);
        }
      }
    }
    return rows;
  }

  function extractFromAriaGrids(root) {
    const rows = [];
    const scopes = [
      ...root.querySelectorAll('[role="grid"], [role="table"], [role="treegrid"]')
    ].filter(visible);

    if (!scopes.length) {
      scopes.push(root);
    }

    for (const scope of scopes) {
      const columnHeaders = [...scope.querySelectorAll('[role="columnheader"], [role="rowheader"]')].filter(visible);
      const headerByIndex = new Map();
      columnHeaders.forEach((header, index) => {
        const colIndex = Number(header.getAttribute("aria-colindex")) || index + 1;
        headerByIndex.set(colIndex, readElementText(header, { raw: true }));
      });

      const rowNodes = [...scope.querySelectorAll('[role="row"]')].filter(visible);
      for (const rowNode of rowNodes) {
        const cellNodes = stripSelectorElements([...rowNode.querySelectorAll('[role="gridcell"], [role="cell"], [role="columnheader"], [role="rowheader"]')].filter(visible));
        if (cellNodes.length < 3) {
          continue;
        }
        const fields = { __links: readLinks(rowNode) };
        cellNodes.forEach((cell, index) => {
          const colIndex = Number(cell.getAttribute("aria-colindex")) || index + 1;
          const header = headerByIndex.get(colIndex);
          const field = fieldForHeader(header) || POSITIONAL_FIELDS[index];
          if (field) {
            fields[field] = readElementText(cell);
          }
        });
        const row = makeRow(fields, { method: "aria-row" });
        if (row) {
          rows.push(row);
        }
      }

      const cellNodes = [...scope.querySelectorAll('[role="gridcell"], [role="cell"]')].filter(visible);
      const cellsByRow = new Map();
      for (const cell of cellNodes) {
        const rowIndex = Number(cell.getAttribute("aria-rowindex")) || Number(cell.parentElement?.getAttribute("aria-rowindex"));
        const colIndex = Number(cell.getAttribute("aria-colindex"));
        if (!rowIndex || !colIndex) {
          continue;
        }
        if (!cellsByRow.has(rowIndex)) {
          cellsByRow.set(rowIndex, []);
        }
        cellsByRow.get(rowIndex).push({ cell, colIndex });
      }

      for (const cells of cellsByRow.values()) {
        if (cells.length < 3) {
          continue;
        }
        const cleanCells = stripSelectorItems(cells.map((entry) => ({
          ...entry,
          rawText: readElementText(entry.cell, { raw: true }),
          text: readElementText(entry.cell)
        }))).sort((a, b) => a.colIndex - b.colIndex);
        if (cleanCells.length < 3) {
          continue;
        }
        const fields = { __links: cleanCells.flatMap(({ cell }) => readLinks(cell)) };
        cleanCells.forEach(({ cell, colIndex }, visualIndex) => {
          const header = headerByIndex.get(colIndex);
          const field = fieldForHeader(header) || POSITIONAL_FIELDS[visualIndex];
          if (field) {
            fields[field] = readElementText(cell);
          }
        });
        const row = makeRow(fields, { method: "aria-gridcell" });
        if (row) {
          rows.push(row);
        }
      }
    }

    return rows;
  }

  function findPowerBiScopes(root) {
    const base = root.body || root.documentElement || root;
    const selectors = [
      "[data-automation-type='visualContainer']",
      ".visualContainer",
      ".visualContainerHost",
      ".visualContent",
      ".tableEx",
      ".tablix",
      "[class*='pivotTable' i]",
      "[class*='bodyCells' i]",
      "[role='grid']",
      "[role='table']"
    ].join(", ");
    const scopes = [...root.querySelectorAll(selectors)].filter(visible);
    const text = lowerKey(normalizeText(base.innerText || base.textContent || "").slice(0, 20000));
    if (["hs code", "consignee", "exporter", "product", "country"].some((term) => text.includes(term))) {
      scopes.push(base);
    }

    const unique = [];
    for (const scope of scopes) {
      if (!unique.includes(scope)) {
        unique.push(scope);
      }
    }
    return unique;
  }

  function closestNumber(element, attributes) {
    let current = element;
    let depth = 0;
    while (current && depth < 4) {
      for (const attribute of attributes) {
        const value = Number(current.getAttribute?.(attribute));
        if (Number.isFinite(value) && value > 0) {
          return value;
        }
      }
      current = current.parentElement;
      depth += 1;
    }
    return 0;
  }

  function collectPowerBiCells(scope) {
    const nodes = [...scope.querySelectorAll(POWER_BI_CELL_SELECTOR)].filter(visible);
    const items = [];
    for (const element of nodes) {
      const rawText = readElementText(element, { raw: true });
      const text = cleanDataText(rawText);
      if (!text || text.length > 400) {
        continue;
      }
      if (isSelectorCellText(rawText) || isSelectorCellText(text)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        continue;
      }

      const classText = `${element.className || ""} ${element.parentElement?.className || ""}`;
      const role = normalizeText(element.getAttribute("role") || element.parentElement?.getAttribute("role"));
      const isHeader = Boolean(
        fieldForHeader(rawText) ||
        role === "columnheader" ||
        /columnheader|rowheader|header/i.test(classText)
      );

      items.push({
        element,
        text,
        rawText,
        rect,
        role,
        isHeader,
        rowIndex: closestNumber(element, ["aria-rowindex", "data-row-index", "data-row"]),
        colIndex: closestNumber(element, ["aria-colindex", "data-col-index", "data-column-index", "data-col"])
      });
    }
    return uniquePowerBiItems(items);
  }

  function uniquePowerBiItems(items) {
    const byKey = new Map();
    for (const item of items) {
      const key = [
        Math.round(item.rect.left),
        Math.round(item.rect.top),
        Math.round(item.rect.width),
        Math.round(item.rect.height),
        lowerKey(item.rawText || item.text)
      ].join("|");
      const current = byKey.get(key);
      if (!current || item.text.length > current.text.length || item.isHeader) {
        byKey.set(key, item);
      }
    }
    return [...byKey.values()];
  }

  function extractFromPowerBiTables(root) {
    const rows = [];
    for (const scope of findPowerBiScopes(root)) {
      const items = collectPowerBiCells(scope);
      if (items.length < 8) {
        continue;
      }
      rows.push(...extractPowerBiByIndex(items));
      rows.push(...extractPowerBiByPosition(items));
    }
    return rows;
  }

  function extractPowerBiByIndex(items) {
    const rows = [];
    const headerByCol = new Map();
    const headerRows = new Set();

    for (const item of items) {
      const field = fieldForHeader(item.rawText || item.text);
      if (field && item.colIndex) {
        headerByCol.set(item.colIndex, field);
        if (item.rowIndex) {
          headerRows.add(item.rowIndex);
        }
      }
    }

    if (headerByCol.size < 3) {
      const inferred = inferHeadersFromPositions(items);
      for (const header of inferred.headers) {
        if (header.colIndex && header.field) {
          headerByCol.set(header.colIndex, header.field);
        }
      }
      if (inferred.rowIndex) {
        headerRows.add(inferred.rowIndex);
      }
    }

    if (headerByCol.size < 3) {
      return rows;
    }

    const cellsByRow = new Map();
    for (const item of items) {
      if (!item.rowIndex || !item.colIndex || headerRows.has(item.rowIndex)) {
        continue;
      }
      if (!cellsByRow.has(item.rowIndex)) {
        cellsByRow.set(item.rowIndex, []);
      }
      cellsByRow.get(item.rowIndex).push(item);
    }

    for (const cells of cellsByRow.values()) {
      if (cells.length < 3) {
        continue;
      }
      const cleanCells = stripSelectorItems(cells)
        .sort((a, b) => a.colIndex - b.colIndex || a.rect.left - b.rect.left);
      if (cleanCells.length < 3) {
        continue;
      }
      const fields = { __links: cleanCells.flatMap((item) => readLinks(item.element)) };
      cleanCells
        .forEach((cell, index) => {
          const field = headerByCol.get(cell.colIndex) || POSITIONAL_FIELDS[index];
          if (field) {
            fields[field] = fields[field] ? `${fields[field]} ${cell.text}` : cell.text;
          }
        });
      const row = makeRow(fields, { method: "powerbi-indexed" });
      if (row) {
        rows.push(row);
      }
    }

    return rows;
  }

  function inferHeadersFromPositions(items) {
    const headerItems = items.filter((item) => fieldForHeader(item.rawText || item.text));
    if (headerItems.length < 3) {
      return { headers: [], rowIndex: 0 };
    }

    const clusters = clusterHeaderRows(headerItems);
    const best = clusters
      .map((cluster) => ({
        cluster,
        fields: new Set(cluster.map((item) => fieldForHeader(item.rawText || item.text)).filter(Boolean))
      }))
      .sort((a, b) => b.fields.size - a.fields.size)[0];

    if (!best || best.fields.size < 3) {
      return { headers: [], rowIndex: 0 };
    }

    const sorted = best.cluster.sort((a, b) => a.rect.left - b.rect.left);
    return {
      rowIndex: sorted.find((item) => item.rowIndex)?.rowIndex || 0,
      headers: sorted.map((item, index) => ({
        ...item,
        colIndex: item.colIndex || index + 1,
        field: fieldForHeader(item.rawText || item.text)
      }))
    };
  }

  function extractPowerBiByPosition(items) {
    const headerItems = items.filter((item) => fieldForHeader(item.rawText || item.text));
    if (headerItems.length < 3) {
      return [];
    }

    const clusters = clusterHeaderRows(headerItems);
    const bestHeaderRow = clusters
      .map((cluster) => ({
        cluster,
        fields: new Set(cluster.map((item) => fieldForHeader(item.rawText || item.text)).filter(Boolean))
      }))
      .sort((a, b) => b.fields.size - a.fields.size)[0];

    if (!bestHeaderRow || bestHeaderRow.fields.size < 3) {
      return [];
    }

    const headers = bestHeaderRow.cluster
      .map((item) => ({ ...item, field: fieldForHeader(item.rawText || item.text) }))
      .filter((item) => item.field)
      .sort((a, b) => a.rect.left - b.rect.left);

    const top = Math.min(...headers.map((item) => item.rect.bottom));
    const left = Math.min(...headers.map((item) => item.rect.left)) - 16;
    const right = Math.max(...headers.map((item) => item.rect.right)) + 120;
    const headerY = average(headers.map((item) => item.rect.top));

    const rowItems = items
      .filter((item) => !fieldForHeader(item.rawText || item.text))
      .filter((item) => !isSelectorCellText(item.rawText || item.text))
      .filter((item) => item.rect.top > top - 3 && item.rect.top < window.innerHeight + 500)
      .filter((item) => item.rect.left >= left && item.rect.left <= right)
      .filter((item) => Math.abs(item.rect.top - headerY) > 10)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    const rows = [];
    for (const cluster of clusterRows(rowItems)) {
      const fields = { __links: cluster.flatMap((item) => readLinks(item.element)) };
      for (const item of cluster) {
        const nearest = nearestHeader(headers, item.rect.left + item.rect.width / 2);
        if (!nearest) {
          continue;
        }
        fields[nearest.field] = fields[nearest.field]
          ? `${fields[nearest.field]} ${item.text}`
          : item.text;
      }
      const row = makeRow(fields, { method: "powerbi-positioned" });
      if (row) {
        rows.push(row);
      }
    }

    return rows;
  }

  function textLeafElements(root) {
    const result = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!visible(node)) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = node.tagName ? node.tagName.toLowerCase() : "";
        if (["script", "style", "noscript", "svg", "canvas", "iframe"].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        const text = readElementText(node, { raw: true });
        if (!text || text.length > 250) {
          return NodeFilter.FILTER_SKIP;
        }
        const visibleChildrenWithText = [...node.children].filter((child) => visible(child) && readElementText(child, { raw: true }));
        return visibleChildrenWithText.length ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const rawText = readElementText(node, { raw: true });
        result.push({
          element: node,
          text: readElementText(node),
          rawText,
          rect
        });
      }
      node = walker.nextNode();
    }
    return result;
  }

  function extractFromVisualLayout(root) {
    const leaves = textLeafElements(root);
    const headerLeaves = leaves.filter((item) => fieldForHeader(item.text));
    if (headerLeaves.length < 3) {
      return [];
    }

    const clusters = clusterHeaderRows(headerLeaves);
    const bestHeaderRow = clusters
      .map((cluster) => ({
        cluster,
        fields: new Set(cluster.map((item) => fieldForHeader(item.text)).filter(Boolean))
      }))
      .sort((a, b) => b.fields.size - a.fields.size)[0];

    if (!bestHeaderRow || bestHeaderRow.fields.size < 3) {
      return [];
    }

    const headers = bestHeaderRow.cluster
      .map((item) => ({ ...item, field: fieldForHeader(item.text) }))
      .filter((item) => item.field)
      .sort((a, b) => a.rect.left - b.rect.left);

    const top = Math.min(...headers.map((item) => item.rect.bottom));
    const left = Math.min(...headers.map((item) => item.rect.left)) - 12;
    const right = Math.max(...headers.map((item) => item.rect.right)) + 80;
    const headerY = average(headers.map((item) => item.rect.top));

    const rowItems = leaves
      .filter((item) => !fieldForHeader(item.rawText || item.text))
      .filter((item) => !isSelectorCellText(item.rawText || item.text))
      .filter((item) => item.rect.top > top - 3 && item.rect.top < window.innerHeight + 300)
      .filter((item) => item.rect.left >= left && item.rect.left <= right)
      .filter((item) => Math.abs(item.rect.top - headerY) > 10)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    const rowClusters = clusterRows(rowItems);
    const rows = [];
    for (const cluster of rowClusters) {
      const fields = { __links: cluster.flatMap((item) => readLinks(item.element)) };
      for (const item of cluster) {
        const nearest = nearestHeader(headers, item.rect.left + item.rect.width / 2);
        if (!nearest) {
          continue;
        }
        fields[nearest.field] = fields[nearest.field]
          ? `${fields[nearest.field]} ${item.text}`
          : item.text;
      }
      const row = makeRow(fields, { method: "visual-layout" });
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  function clusterHeaderRows(items) {
    const sorted = [...items].sort((a, b) => a.rect.top - b.rect.top);
    const clusters = [];
    for (const item of sorted) {
      let cluster = clusters.find((group) => Math.abs(average(group.map((entry) => entry.rect.top)) - item.rect.top) < 18);
      if (!cluster) {
        cluster = [];
        clusters.push(cluster);
      }
      cluster.push(item);
    }
    return clusters;
  }

  function clusterRows(items) {
    const clusters = [];
    for (const item of items) {
      let cluster = clusters.find((group) => Math.abs(average(group.map((entry) => entry.rect.top)) - item.rect.top) < Math.max(10, item.rect.height * 0.8));
      if (!cluster) {
        cluster = [];
        clusters.push(cluster);
      }
      cluster.push(item);
    }
    return clusters
      .filter((cluster) => cluster.length >= 3)
      .map((cluster) => cluster.sort((a, b) => a.rect.left - b.rect.left));
  }

  function nearestHeader(headers, x) {
    let nearest = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const header of headers) {
      const headerX = header.rect.left + header.rect.width / 2;
      const nextDistance = Math.abs(headerX - x);
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = header;
      }
    }
    return nearest;
  }

  function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  }

  function rowKey(row) {
    return [
      row.hsCode,
      row.consignee,
      row.exporter,
      row.productDescription,
      row.country,
      row.quantity,
      row.fobValue
    ].map(lowerKey).join("|");
  }

  function uniqueRows(rows) {
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const key = rowKey(row);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(row);
    }
    return result;
  }

  function captureVisible() {
    const roots = [document];
    const rows = uniqueRows([
      ...extractFromHtmlTables(document),
      ...extractFromAriaGrids(document),
      ...extractFromPowerBiTables(document),
      ...extractFromVisualLayout(document)
    ]);

    return {
      ok: true,
      rows,
      rowCount: rows.length,
      href: window.location.href,
      title: document.title,
      frameElement: safeFrameName(),
      strategy: rows.length ? [...new Set(rows.map((row) => row.sourceMethod))].join(", ") : "none",
      rootsChecked: roots.length,
      diagnostics: diagnostics()
    };
  }

  function diagnostics() {
    return {
      hostname: window.location.hostname,
      isPowerBi: /powerbi\.com$/i.test(window.location.hostname) || /powerbi/i.test(document.title),
      iframeCount: document.querySelectorAll("iframe").length,
      powerBiCellCandidates: document.querySelectorAll(POWER_BI_CELL_SELECTOR).length,
      scrollContainers: [...document.querySelectorAll("body, main, section, div, [role='grid'], [role='table']")]
        .filter((element) => element.scrollHeight > element.clientHeight + 30 || element.scrollWidth > element.clientWidth + 30)
        .length
    };
  }

  function safeFrameName() {
    try {
      return window.frameElement ? normalizeText(window.frameElement.getAttribute("title") || window.frameElement.id || window.frameElement.name) : "top";
    } catch (error) {
      return "cross-origin-frame";
    }
  }

  function findScrollContainers() {
    const candidates = [...document.querySelectorAll([
      "body",
      "main",
      "section",
      "div",
      "iframe",
      "[role='grid']",
      "[role='table']",
      ".bodyCells",
      ".tableEx",
      ".tablix",
      ".scrollRegion",
      ".scrollWrapper",
      ".visualContainer",
      ".visualContainerHost",
      "[class*='scroll' i]",
      "[class*='viewport' i]",
      "[class*='virtual' i]"
    ].join(", "))]
      .filter((element) => visible(element))
      .filter((element) => element.scrollHeight > element.clientHeight + 30 || element.scrollWidth > element.clientWidth + 30);

    const scored = candidates.map((element) => {
      const text = lowerKey(normalizeText(element.innerText || element.textContent || element.getAttribute("aria-label") || "").slice(0, 8000));
      const hasReportWords = ["hs code", "consignee", "exporter", "product", "country"].reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
      const area = element.clientWidth * element.clientHeight;
      const classBonus = /bodyCells|tableEx|tablix|scroll|viewport|virtual/i.test(`${element.className || ""}`) ? 5000000 : 0;
      return { element, score: hasReportWords * 10000000 + classBonus + area + element.scrollHeight };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 8).map((entry) => entry.element);
  }

  function scrollState(element) {
    return {
      element,
      top: element.scrollTop,
      left: element.scrollLeft,
      maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
      maxLeft: Math.max(0, element.scrollWidth - element.clientWidth)
    };
  }

  function resetScrollTargets(targets, position = "top") {
    for (const target of targets) {
      if (position === "top") {
        target.scrollTop = 0;
        target.scrollLeft = 0;
      } else if (position && typeof position === "object") {
        target.scrollTop = position.top || 0;
        target.scrollLeft = position.left || 0;
      }
    }
  }

  function advanceScrollTargets(targets) {
    let moved = false;
    for (const target of targets) {
      const beforeTop = target.scrollTop;
      const beforeLeft = target.scrollLeft;
      const verticalStep = Math.max(180, Math.floor((target.clientHeight || window.innerHeight) * 0.72));
      const horizontalStep = Math.max(120, Math.floor((target.clientWidth || window.innerWidth) * 0.5));
      target.scrollTop = Math.min(target.scrollTop + verticalStep, Math.max(0, target.scrollHeight - target.clientHeight));
      if (target.scrollWidth > target.clientWidth + 30) {
        target.scrollLeft = Math.min(target.scrollLeft + horizontalStep, Math.max(0, target.scrollWidth - target.clientWidth));
      }
      moved = moved || target.scrollTop !== beforeTop || target.scrollLeft !== beforeLeft;
    }

    const wheelTarget = targets[0] || document.scrollingElement || document.documentElement;
    try {
      wheelTarget.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: Math.max(240, Math.floor(window.innerHeight * 0.7)),
        deltaMode: 0
      }));
    } catch (error) {
      // Synthetic wheel dispatch is only a fallback for visuals with custom handlers.
    }

    return moved;
  }

  function allTargetsAtEnd(targets) {
    return targets.every((target) => {
      const atVerticalEnd = target.scrollHeight <= target.clientHeight + 30 || target.scrollTop + target.clientHeight >= target.scrollHeight - 4;
      const atHorizontalEnd = target.scrollWidth <= target.clientWidth + 30 || target.scrollLeft + target.clientWidth >= target.scrollWidth - 4;
      return atVerticalEnd && atHorizontalEnd;
    });
  }

  async function captureWithScroll(options = {}) {
    const settings = {
      maxScrolls: Number(options.maxScrolls) || 150,
      scrollDelayMs: Number(options.scrollDelayMs) || 280,
      startFromTop: options.startFromTop !== false,
      restoreScroll: options.restoreScroll !== false
    };

    const containers = findScrollContainers();
    const documentTarget = document.scrollingElement || document.documentElement;
    const targets = uniqueElements([containers[0], ...containers, documentTarget].filter(Boolean));
    const originals = targets.map(scrollState);

    if (settings.startFromTop) {
      resetScrollTargets(targets, "top");
      await sleep(settings.scrollDelayMs);
    }

    const collected = [];
    let unchanged = 0;
    let previousCount = 0;

    for (let index = 0; index < settings.maxScrolls; index += 1) {
      const current = captureVisible();
      collected.push(...current.rows);
      const uniqueCount = uniqueRows(collected).length;
      const atEnd = allTargetsAtEnd(targets);

      if (uniqueCount === previousCount) {
        unchanged += 1;
      } else {
        unchanged = 0;
      }
      previousCount = uniqueCount;

      if (atEnd && unchanged >= 2) {
        break;
      }
      if (unchanged >= 12) {
        break;
      }

      const moved = advanceScrollTargets(targets);
      if (!moved && unchanged >= 2) {
        break;
      }
      await sleep(settings.scrollDelayMs);
    }

    if (settings.restoreScroll) {
      for (const original of originals) {
        resetScrollTargets([original.element], original);
      }
    }

    const rows = uniqueRows(collected);
    return {
      ok: true,
      rows,
      rowCount: rows.length,
      href: window.location.href,
      title: document.title,
      frameElement: safeFrameName(),
      strategy: rows.length ? "scroll-capture" : "none",
      scrollTargetCount: containers.length,
      diagnostics: diagnostics()
    };
  }

  function uniqueElements(elements) {
    const result = [];
    for (const element of elements) {
      if (element && !result.includes(element)) {
        result.push(element);
      }
    }
    return result;
  }

  window.__EXIM_ELITE_EXTRACTOR__ = {
    captureVisible,
    captureWithScroll
  };
})();
