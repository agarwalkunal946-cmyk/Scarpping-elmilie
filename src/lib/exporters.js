(function attachExporters(global) {
  function escapeCsv(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }


  function relationshipEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();
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

  function safeHyperlinkUrl(value, options = {}) {
    const url = normalizeExternalLink(value);
    if (!url) {
      return "";
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (!["http:", "https:"].includes(parsed.protocol) || !host.includes(".") || host.includes("%") || host.includes(" ")) {
        return "";
      }
      parsed.hash = "";
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  function cellLinkUrl(row, key) {
    if (key === "websiteUrl" || key === "website") {
      return safeHyperlinkUrl(row?.[key], { companyWebsite: true });
    }
    if (key === "consignee" || key === "exporter") {
      const exactUrl = safeHyperlinkUrl(row?.[`${key}Url`]) || safeHyperlinkUrl(row?.[key]);
      if (exactUrl) {
        return exactUrl;
      }
    }
    return "";
  }

  function exportValue(row, column) {
    return row[column.key] || "";
  }

  function toCsv(rows, columns) {
    const lines = [];
    lines.push(columns.map((column) => escapeCsv(column.label)).join(","));
    for (const row of rows) {
      lines.push(columns.map((column) => escapeCsv(exportValue(row, column))).join(","));
    }
    return `\ufeff${lines.join("\r\n")}`;
  }

  function excelColumnName(index) {
    let name = "";
    let current = index + 1;
    while (current > 0) {
      const modulo = (current - 1) % 26;
      name = String.fromCharCode(65 + modulo) + name;
      current = Math.floor((current - modulo) / 26);
    }
    return name;
  }

  function worksheetXml(rows, columns) {
    const header = columns.map((column) => column.label);
    const values = [header, ...rows.map((row) => columns.map((column) => exportValue(row, column)))];
    const links = [];
    const sheetRows = values.map((cells, rowIndex) => {
      const cellXml = cells.map((value, colIndex) => {
        const ref = `${excelColumnName(colIndex)}${rowIndex + 1}`;
        const column = columns[colIndex];
        const row = rows[rowIndex - 1];
        const url = rowIndex > 0 ? cellLinkUrl(row, column.key) : "";
        const linkId = url ? `rId${links.length + 1}` : "";
        if (url) {
          links.push({ ref, id: linkId, url });
        }
        const style = rowIndex === 0 ? ' s="1"' : url ? ' s="2"' : "";
        return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    }).join("");

    const cols = columns.map((column, index) => {
      const width = Math.max(12, Math.min(42, column.label.length + 8));
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    }).join("");

    const hyperlinkXml = links.length
      ? `<hyperlinks>${links.map((link) => `<hyperlink ref="${link.ref}" r:id="${link.id}"/>`).join("")}</hyperlinks>`
      : "";

    return {
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${sheetRows}</sheetData>
  ${hyperlinkXml}
  <autoFilter ref="A1:${excelColumnName(columns.length - 1)}${Math.max(rows.length + 1, 1)}"/>
</worksheet>`,
      links
    };
  }

  function workbookXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="EXIM Export" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><u/><color rgb="FF0563C1"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;
  }

  function contentTypesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  }

  function packageRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  }

  function workbookRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  }


  function worksheetRelsXml(links) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${links.map((link) => `<Relationship Id="${link.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${relationshipEscape(link.url)}" TargetMode="External"/>`).join("\n  ")}
</Relationships>`;
  }

  function coreXml() {
    const created = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>EXIM Elite Report Exporter</dc:creator>
  <cp:lastModifiedBy>EXIM Elite Report Exporter</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
  }

  function appXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>EXIM Elite Report Exporter</Application>
</Properties>`;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = Math.max(1980, date.getFullYear()) - 1980;
    return {
      time,
      date: (year << 9) | (month << 5) | day
    };
  }

  function writeUint16(buffer, offset, value) {
    buffer[offset] = value & 0xff;
    buffer[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32(buffer, offset, value) {
    buffer[offset] = value & 0xff;
    buffer[offset + 1] = (value >>> 8) & 0xff;
    buffer[offset + 2] = (value >>> 16) & 0xff;
    buffer[offset + 3] = (value >>> 24) & 0xff;
  }

  function concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function zip(files) {
    const encoder = new TextEncoder();
    const dateParts = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(dataBytes);
      const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
      writeUint32(local, 0, 0x04034b50);
      writeUint16(local, 4, 20);
      writeUint16(local, 6, 0x0800);
      writeUint16(local, 8, 0);
      writeUint16(local, 10, dateParts.time);
      writeUint16(local, 12, dateParts.date);
      writeUint32(local, 14, crc);
      writeUint32(local, 18, dataBytes.length);
      writeUint32(local, 22, dataBytes.length);
      writeUint16(local, 26, nameBytes.length);
      writeUint16(local, 28, 0);
      local.set(nameBytes, 30);
      local.set(dataBytes, 30 + nameBytes.length);
      localParts.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      writeUint32(central, 0, 0x02014b50);
      writeUint16(central, 4, 20);
      writeUint16(central, 6, 20);
      writeUint16(central, 8, 0x0800);
      writeUint16(central, 10, 0);
      writeUint16(central, 12, dateParts.time);
      writeUint16(central, 14, dateParts.date);
      writeUint32(central, 16, crc);
      writeUint32(central, 20, dataBytes.length);
      writeUint32(central, 24, dataBytes.length);
      writeUint16(central, 28, nameBytes.length);
      writeUint16(central, 30, 0);
      writeUint16(central, 32, 0);
      writeUint16(central, 34, 0);
      writeUint16(central, 36, 0);
      writeUint32(central, 38, 0);
      writeUint32(central, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);

      offset += local.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const end = new Uint8Array(22);
    writeUint32(end, 0, 0x06054b50);
    writeUint16(end, 4, 0);
    writeUint16(end, 6, 0);
    writeUint16(end, 8, files.length);
    writeUint16(end, 10, files.length);
    writeUint32(end, 12, centralDirectory.length);
    writeUint32(end, 16, offset);
    writeUint16(end, 20, 0);

    return concatBytes([...localParts, centralDirectory, end]);
  }

  function toXlsxBlob(rows, columns) {
    const worksheet = worksheetXml(rows, columns);
    const files = [
      { name: "[Content_Types].xml", data: contentTypesXml() },
      { name: "_rels/.rels", data: packageRelsXml() },
      { name: "docProps/core.xml", data: coreXml() },
      { name: "docProps/app.xml", data: appXml() },
      { name: "xl/workbook.xml", data: workbookXml() },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml() },
      { name: "xl/styles.xml", data: stylesXml() },
      { name: "xl/worksheets/sheet1.xml", data: worksheet.xml }
    ];
    if (worksheet.links.length) {
      files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: worksheetRelsXml(worksheet.links) });
    }

    const bytes = zip(files);
    return new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }


  function toCsvBlob(rows, columns) {
    return new Blob([toCsv(rows, columns)], {
      type: "text/csv;charset=utf-8"
    });
  }

  async function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  function exportFilename(extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `exim-elite-export-${stamp}.${extension}`;
  }

  global.EximExporter = {
    toCsv,
    toCsvBlob,
    toXlsxBlob,
    downloadBlob,
    exportFilename
  };
})(window);
