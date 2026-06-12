(function attachPowerBiDsr(global) {
  const REPORT_FIELDS = [
    "hsCode",
    "consignee",
    "exporter",
    "productDescription",
    "quantity",
    "country",
    "fobValue"
  ];

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lowerKey(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function isValidHsCode(value) {
    return /^\d{4,10}$/.test(normalizeText(value).replace(/\s/g, ""));
  }

  function fieldFromSelect(select) {
    const groupKey = select?.GroupKeys?.[0]?.Source?.Property || "";
    const name = lowerKey([
      select?.NativeReferenceName,
      select?.Name,
      groupKey
    ].filter(Boolean).join(" "));

    if (name.includes("hs code") || name.includes("hscode")) {
      return "hsCode";
    }
    if (name.includes("consignee")) {
      return "consignee";
    }
    if (name.includes("expoerter") || name.includes("exporter")) {
      return "exporter";
    }
    if (name.includes("product description")) {
      return "productDescription";
    }
    if (name.includes("foreign country") || name === "country" || name.includes(" country")) {
      return "country";
    }
    if (name.includes("quantity") || name.includes(" qty")) {
      return "quantity";
    }
    if (name.includes("fob")) {
      return "fobValue";
    }
    return "";
  }

  function selectMap(descriptor) {
    const byValue = new Map();
    for (const select of descriptor?.Select || []) {
      const value = normalizeText(select.Value);
      const field = fieldFromSelect(select);
      if (value && field) {
        byValue.set(value, field);
      }
    }
    return byValue;
  }

  function formatNumber(value, field) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    if (typeof value !== "number") {
      return normalizeText(value);
    }
    if (field === "quantity" || field === "fobValue") {
      return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
    return String(value);
  }

  function decodeLiteral(value) {
    const text = normalizeText(value);
    if (/^'.*'$/.test(text)) {
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (/^-?\d+(?:\.\d+)?D$/.test(text)) {
      return Number(text.slice(0, -1));
    }
    return value;
  }

  function decodeCell(value, schemaEntry, valueDicts, field) {
    const decoded = decodeLiteral(value);
    if (schemaEntry?.DN && typeof decoded === "number") {
      const dict = valueDicts?.[schemaEntry.DN] || [];
      if (dict[decoded] !== undefined) {
        return normalizeText(dict[decoded]);
      }
    }
    return formatNumber(decoded, field);
  }

  function decodeRows(rows, valueDicts, bySelectValue) {
    const output = [];
    let schema = [];
    let previous = [];

    for (const item of rows || []) {
      if (Array.isArray(item.S)) {
        schema = item.S.map((entry) => ({
          ...entry,
          field: bySelectValue.get(normalizeText(entry.N)) || ""
        }));
      }
      if (!Array.isArray(item.C) || !schema.length) {
        continue;
      }

      const repeatMask = Number(item.R || 0);
      const decoded = [];
      let cursor = 0;

      for (let index = 0; index < schema.length; index += 1) {
        const entry = schema[index];
        if (repeatMask & (1 << index)) {
          decoded[index] = previous[index] ?? "";
        } else {
          decoded[index] = decodeCell(item.C[cursor], entry, valueDicts, entry.field);
          cursor += 1;
        }
      }

      previous = decoded;
      const row = {};
      for (let index = 0; index < schema.length; index += 1) {
        const field = schema[index].field;
        if (field) {
          row[field] = normalizeText(decoded[index]);
        }
      }

      if (isValidHsCode(row.hsCode) && row.consignee && row.exporter) {
        output.push({
          hsCode: normalizeText(row.hsCode),
          consignee: normalizeText(row.consignee),
          exporter: normalizeText(row.exporter),
          productDescription: normalizeText(row.productDescription),
          country: normalizeText(row.country),
          quantity: normalizeText(row.quantity),
          fobValue: normalizeText(row.fobValue),
          sourceMethod: "powerbi-querydata",
          capturedAt: new Date().toISOString()
        });
      }
    }

    return output;
  }

  function parseData(data) {
    const bySelectValue = selectMap(data?.descriptor || {});
    const rows = [];
    const restartTokens = [];

    for (const dataset of data?.dsr?.DS || []) {
      if (Array.isArray(dataset.RT)) {
        restartTokens.push(dataset.RT);
      }
      for (const phase of dataset.PH || []) {
        for (const [name, records] of Object.entries(phase || {})) {
          if (!/^DM\d+$/i.test(name) || !Array.isArray(records)) {
            continue;
          }
          rows.push(...decodeRows(records, dataset.ValueDicts || {}, bySelectValue));
        }
      }
    }

    return { rows, restartTokens };
  }

  function parseResponse(input) {
    const payload = typeof input === "string" ? JSON.parse(input) : input;
    const rows = [];
    const restartTokens = [];
    const results = Array.isArray(payload?.results) ? payload.results : [];

    for (const result of results) {
      const parsed = parseData(result?.result?.data || result?.data || {});
      rows.push(...parsed.rows);
      restartTokens.push(...parsed.restartTokens);
    }

    return { rows, restartTokens };
  }

  function rowKey(row) {
    return REPORT_FIELDS.map((field) => lowerKey(row[field])).join("|");
  }

  function uniqueRows(rows) {
    const seen = new Set();
    const output = [];
    for (const row of rows) {
      const key = rowKey(row);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(row);
    }
    return output;
  }

  function parseResponses(items) {
    const rows = [];
    const restartTokens = [];
    const seenBodies = new Set();
    let parsedResponses = 0;

    for (const item of items || []) {
      const body = item?.body ?? item?.responseText ?? item;
      if (!body) {
        continue;
      }
      const bodyKey = String(body);
      if (seenBodies.has(bodyKey)) {
        continue;
      }
      seenBodies.add(bodyKey);
      try {
        const parsed = parseResponse(body);
        if (parsed.rows.length) {
          parsedResponses += 1;
          rows.push(...parsed.rows);
          restartTokens.push(...parsed.restartTokens);
        }
      } catch (error) {
        // Ignore non-querydata or malformed bodies captured from the page.
      }
    }

    return {
      rows,
      restartTokens,
      parsedResponses
    };
  }

  function dataShapeCommands(payload) {
    return (payload?.queries || [])
      .flatMap((query) => query?.Query?.Commands || [])
      .map((command) => command?.SemanticQueryDataShapeCommand)
      .filter(Boolean);
  }

  function requestFieldNames(input) {
    try {
      const payload = typeof input === "string" ? JSON.parse(input) : input;
      return dataShapeCommands(payload)
        .flatMap((command) => command?.Query?.Select || [])
        .map((select) => normalizeText([
          select?.NativeReferenceName,
          select?.Name,
          select?.Column?.Property,
          select?.Aggregation?.Expression?.Column?.Property
        ].filter(Boolean).join(" | ")))
        .filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function boostQueryDataWindow(input, options = {}) {
    const payload = typeof input === "string" ? JSON.parse(input) : JSON.parse(JSON.stringify(input));
    const count = Math.max(1, Math.floor(Number(options.count) || 500));
    const hasRestartToken = Object.prototype.hasOwnProperty.call(options, "restartToken")
      && options.restartToken !== undefined
      && options.restartToken !== null;

    for (const command of dataShapeCommands(payload)) {
      const binding = command.Binding || (command.Binding = {});
      const dataReduction = binding.DataReduction || (binding.DataReduction = {});
      const primary = dataReduction?.Primary || (dataReduction.Primary = {});
      const window = primary.Window || (primary.Window = {});
      window.Count = count;
      if (hasRestartToken) {
        window.RestartTokens = options.restartToken;
      } else {
        delete window.RestartTokens;
      }
    }

    return JSON.stringify(payload);
  }

  global.EximPowerBiDsr = {
    parseResponse,
    parseResponses,
    parseData,
    uniqueRows,
    requestFieldNames,
    boostQueryDataWindow
  };
})(window);
