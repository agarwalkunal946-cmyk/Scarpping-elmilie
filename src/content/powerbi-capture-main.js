(function installEximPowerBiCapture() {
  const key = "__EXIM_ELITE_PBI_CAPTURE__";
  const maxSavedResponses = 80;
  const maxSavedRequests = 30;

  if (window[key]?.version >= 2) {
    return;
  }

  const previous = window[key] || {};
  const state = {
    installed: true,
    version: 2,
    responses: Array.isArray(previous.responses) ? previous.responses : [],
    requests: Array.isArray(previous.requests) ? previous.requests : [],
    originalFetch: previous.originalFetch || window.fetch,
    originalOpen: previous.originalOpen || XMLHttpRequest.prototype.open,
    originalSend: previous.originalSend || XMLHttpRequest.prototype.send,
    originalSetRequestHeader: previous.originalSetRequestHeader || XMLHttpRequest.prototype.setRequestHeader
  };

  function safeString(value) {
    try {
      return String(value ?? "");
    } catch (error) {
      return "";
    }
  }

  function isQueryDataUrl(url) {
    return /\/querydata\b/i.test(safeString(url));
  }

  function headersToObject(headers) {
    const output = {};
    try {
      if (!headers) {
        return output;
      }
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach((value, name) => {
          output[name] = value;
        });
        return output;
      }
      if (Array.isArray(headers)) {
        for (const [name, value] of headers) {
          output[name] = value;
        }
        return output;
      }
      if (typeof headers === "object") {
        for (const [name, value] of Object.entries(headers)) {
          output[name] = value;
        }
      }
    } catch (error) {
      // Header capture is best-effort only.
    }
    return output;
  }

  function bodyToText(body) {
    if (body === undefined || body === null) {
      return "";
    }
    if (typeof body === "string") {
      return body;
    }
    if (body instanceof URLSearchParams) {
      return body.toString();
    }
    if (body instanceof ArrayBuffer) {
      return new TextDecoder().decode(body);
    }
    if (ArrayBuffer.isView(body)) {
      return new TextDecoder().decode(body.buffer);
    }
    return "";
  }

  function saveResponse(url, body, kind) {
    try {
      const text = safeString(body);
      if (!isQueryDataUrl(url) || !text.includes('"results"')) {
        return;
      }
      state.responses.push({
        url: safeString(url),
        body: text,
        kind,
        capturedAt: new Date().toISOString()
      });
      if (state.responses.length > maxSavedResponses) {
        state.responses.splice(0, state.responses.length - maxSavedResponses);
      }
    } catch (error) {
      // Capture must never interfere with the report.
    }
  }

  function saveRequest(url, method, body, kind, headers) {
    try {
      const text = safeString(body);
      if (!isQueryDataUrl(url) || !text.includes("SemanticQueryDataShapeCommand")) {
        return;
      }
      state.requests.push({
        url: safeString(url),
        method: safeString(method || "POST").toUpperCase(),
        body: text,
        headers: headersToObject(headers),
        kind,
        capturedAt: new Date().toISOString()
      });
      if (state.requests.length > maxSavedRequests) {
        state.requests.splice(0, state.requests.length - maxSavedRequests);
      }
    } catch (error) {
      // Request capture is best-effort only.
    }
  }

  function requestInfoFromFetch(args) {
    const input = args[0];
    const init = args[1] || {};
    const url = typeof input === "string" || input instanceof URL ? safeString(input) : input?.url;
    const method = init.method || input?.method || "GET";
    const headers = {
      ...headersToObject(input?.headers),
      ...headersToObject(init.headers)
    };

    const directBody = bodyToText(init.body);
    if (directBody) {
      saveRequest(url, method, directBody, "fetch", headers);
    } else if (input?.clone && typeof input.clone === "function") {
      try {
        input.clone().text().then((body) => saveRequest(url, method, body, "fetch-request", headers)).catch(() => {});
      } catch (error) {
        // Some Request bodies cannot be cloned.
      }
    }

    return { url, method, headers };
  }

  function sanitizeFetchHeaders(headers) {
    const output = {};
    for (const [name, value] of Object.entries(headersToObject(headers))) {
      const lower = name.toLowerCase();
      if (
        lower === "accept-encoding"
        || lower === "content-length"
        || lower === "cookie"
        || lower === "host"
        || lower === "origin"
        || lower === "referer"
        || lower === "user-agent"
        || lower.startsWith("sec-")
      ) {
        continue;
      }
      output[name] = value;
    }
    if (!output.Accept && !output.accept) {
      output.Accept = "application/json, text/plain, */*";
    }
    if (!output["Content-Type"] && !output["content-type"]) {
      output["Content-Type"] = "application/json;charset=UTF-8";
    }
    return output;
  }

  function dataShapeCommands(payload) {
    return (payload?.queries || [])
      .flatMap((query) => query?.Query?.Commands || [])
      .map((command) => command?.SemanticQueryDataShapeCommand)
      .filter(Boolean);
  }

  function isReportTableRequest(request) {
    const body = safeString(request?.body).toLowerCase();
    return body.includes("hs code")
      && body.includes("consignee")
      && (body.includes("expoerter") || body.includes("exporter"))
      && body.includes("product description");
  }

  function latestQueryRequest() {
    const requests = [...state.requests].reverse().filter((item) => item?.body && isQueryDataUrl(item.url));
    return requests.find(isReportTableRequest) || requests[0] || null;
  }

  function prepareQueryBody(body, options) {
    const payload = JSON.parse(body);
    const count = Math.max(1, Math.floor(Number(options?.count) || 500));
    const tokenMode = options?.tokenMode || "full";
    const hasToken = Object.prototype.hasOwnProperty.call(options || {}, "restartToken")
      && options.restartToken !== undefined
      && options.restartToken !== null;

    for (const command of dataShapeCommands(payload)) {
      const binding = command.Binding || (command.Binding = {});
      const dataReduction = binding.DataReduction || (binding.DataReduction = {});
      const primary = dataReduction?.Primary || (dataReduction.Primary = {});
      const window = primary.Window || (primary.Window = {});
      window.Count = count;
      if (hasToken) {
        window.RestartTokens = tokenMode === "values" && Array.isArray(options.restartToken)
          ? options.restartToken[1] || options.restartToken
          : options.restartToken;
      } else {
        delete window.RestartTokens;
      }
    }

    return JSON.stringify(payload);
  }

  async function replayLatest(options = {}) {
    const request = latestQueryRequest();
    if (!request) {
      return {
        ok: false,
        error: "No Power BI querydata request captured yet. Refresh the report once, then click Capture All.",
        requestCount: state.requests.length,
        href: window.location.href
      };
    }

    try {
      const body = prepareQueryBody(request.body, options);
      const response = await state.originalFetch.call(window, request.url, {
        method: "POST",
        headers: sanitizeFetchHeaders(request.headers),
        body,
        credentials: "include",
        cache: "no-store",
        mode: "cors"
      });
      const text = await response.text();
      saveRequest(request.url, "POST", body, "direct-fetch", request.headers);
      saveResponse(request.url, text, "direct-fetch");
      return {
        ok: response.ok,
        status: response.status,
        url: request.url,
        body: text,
        href: window.location.href,
        requestCapturedAt: request.capturedAt,
        requestCount: state.requests.length,
        responseBytes: text.length,
        directWindowCount: Math.max(1, Math.floor(Number(options?.count) || 500))
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || safeString(error),
        url: request.url,
        href: window.location.href,
        requestCapturedAt: request.capturedAt,
        requestCount: state.requests.length
      };
    }
  }

  function reset(options = {}) {
    if (options.responses !== false) {
      state.responses = [];
    }
    if (options.requests === true) {
      state.requests = [];
    }
    return status();
  }

  function status() {
    return {
      ok: true,
      installed: true,
      version: state.version,
      href: window.location.href,
      responses: state.responses.length,
      requests: state.requests.length,
      latestRequestAt: state.requests[state.requests.length - 1]?.capturedAt || "",
      latestResponseAt: state.responses[state.responses.length - 1]?.capturedAt || ""
    };
  }

  window.fetch = async function patchedFetch(...args) {
    const info = requestInfoFromFetch(args);
    const response = await state.originalFetch.apply(this, args);
    try {
      if (isQueryDataUrl(info.url)) {
        response.clone().text().then((body) => saveResponse(info.url, body, "fetch")).catch(() => {});
      }
    } catch (error) {
      // Best-effort only.
    }
    return response;
  };

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__eximPbiUrl = url;
    this.__eximPbiMethod = method;
    this.__eximPbiHeaders = {};
    return state.originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    try {
      this.__eximPbiHeaders = this.__eximPbiHeaders || {};
      this.__eximPbiHeaders[name] = value;
    } catch (error) {
      // Best-effort only.
    }
    return state.originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    try {
      saveRequest(this.__eximPbiUrl, this.__eximPbiMethod, bodyToText(body), "xhr", this.__eximPbiHeaders);
      this.addEventListener("load", function onLoad() {
        try {
          saveResponse(this.__eximPbiUrl, this.responseText, "xhr");
        } catch (error) {
          // Best-effort only.
        }
      });
    } catch (error) {
      // Best-effort only.
    }
    return state.originalSend.call(this, body);
  };

  state.saveResponse = saveResponse;
  state.saveRequest = saveRequest;
  state.replayLatest = replayLatest;
  state.reset = reset;
  state.status = status;
  window[key] = state;
})();
