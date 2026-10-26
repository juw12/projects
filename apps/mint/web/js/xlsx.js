/*
 * Mint XLSX writer — builds a real .xlsx (Office Open XML) from a template spec
 * with live formulas, dropdowns, colour rules, theme styling and a Dashboard tab.
 * Zero dependencies: own UTF-8 encoder, CRC32 and STORE-method zip.
 * Exposed as globalThis.MintXlsx. Requires MintCore.
 */
(function (root) {
  "use strict";

  var Core = root.MintCore;
  var PREPARED_ROWS = 200;

  // ------------------------------------------------------------------ bytes
  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      } else {
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return new Uint8Array(out);
  }

  var CRC_TABLE = (function () {
    var table = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    function u16(v) {
      return [v & 0xff, (v >>> 8) & 0xff];
    }

    function u32(v) {
      return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    }

    files.forEach(function (file) {
      var name = utf8(file.name);
      var data = typeof file.data === "string" ? utf8(file.data) : file.data;
      var crc = crc32(data);
      var header = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)
      );
      chunks.push(new Uint8Array(header), name, data);
      central.push(new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      )), name);
      offset += header.length + name.length + data.length;
    });
    var centralSize = central.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);
    var end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)
    ));
    var all = chunks.concat(central, [end]);
    var total = all.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (part) {
      out.set(part, pos);
      pos += part.length;
    });
    return out;
  }

  // ------------------------------------------------------------------ xml helpers
  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  }

  function colLetter(index) {
    var s = "";
    var n = index + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetRef(name) {
    return "'" + name.replace(/'/g, "''") + "'";
  }

  // ------------------------------------------------------------------ styles
  function StyleBook(theme, currency) {
    var cur = Core.CURRENCIES[currency] || Core.CURRENCIES.USD;
    var symbol = cur.symbol.replace(/"/g, "");
    var moneyFmt = "\"" + symbol + (symbol.length > 1 ? " " : "") + "\"#,##0" + (cur.decimals ? ".00" : "") + ";-\"" + symbol + (symbol.length > 1 ? " " : "") + "\"#,##0" + (cur.decimals ? ".00" : "");
    this.numFmts = [
      { id: 164, code: moneyFmt },
      { id: 165, code: "0.0%" },
      { id: 166, code: "yyyy-mm-dd" },
      { id: 167, code: "#,##0.##" }
    ];
    this.formatIds = { currency: 164, percent: 165, date: 166, number: 0, text: 49 };
    var bodyText = theme.bodyText;
    this.fonts = [
      "<font><sz val=\"11\"/><color rgb=\"FF" + bodyText + "\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FF" + theme.headerText + "\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"18\"/><color rgb=\"FF" + theme.header + "\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><i/><sz val=\"10\"/><color rgb=\"FF6B7280\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"16\"/><color rgb=\"FF" + bodyText + "\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
    ];
    this.fills = [
      "<fill><patternFill patternType=\"none\"/></fill>",
      "<fill><patternFill patternType=\"gray125\"/></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF" + theme.header + "\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF" + theme.band + "\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF" + theme.body + "\"/><bgColor indexed=\"64\"/></patternFill></fill>"
    ];
    this.borders = [
      "<border><left/><right/><top/><bottom/><diagonal/></border>",
      "<border><left/><right/><top/><bottom style=\"thin\"><color rgb=\"FF" + theme.accent + "\"/></bottom><diagonal/></border>"
    ];
    this.xfs = ["<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"];
    this.cache = {};
  }

  StyleBook.prototype.xf = function (font, fill, border, numFmt, wrap) {
    var key = [font, fill, border, numFmt, wrap ? 1 : 0].join("|");
    if (this.cache[key] !== undefined) {
      return this.cache[key];
    }
    var attrs = "numFmtId=\"" + numFmt + "\" fontId=\"" + font + "\" fillId=\"" + fill + "\" borderId=\"" + border + "\" xfId=\"0\"";
    attrs += numFmt ? " applyNumberFormat=\"1\"" : "";
    attrs += font ? " applyFont=\"1\"" : "";
    attrs += fill ? " applyFill=\"1\"" : "";
    attrs += border ? " applyBorder=\"1\"" : "";
    var xml = "<xf " + attrs + (wrap ? " applyAlignment=\"1\"><alignment vertical=\"center\" wrapText=\"1\"/></xf>" : "/>");
    this.xfs.push(xml);
    this.cache[key] = this.xfs.length - 1;
    return this.cache[key];
  };

  StyleBook.prototype.xml = function () {
    var dxfs = [
      ["166534", "DCFCE7"],
      ["991B1B", "FEE2E2"],
      ["92400E", "FEF3C7"]
    ].map(function (pair) {
      return "<dxf><font><b/><color rgb=\"FF" + pair[0] + "\"/></font><fill><patternFill patternType=\"solid\"><bgColor rgb=\"FF" + pair[1] + "\"/></patternFill></fill></dxf>";
    });
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
      "<numFmts count=\"" + this.numFmts.length + "\">" + this.numFmts.map(function (f) {
        return "<numFmt numFmtId=\"" + f.id + "\" formatCode=\"" + esc(f.code) + "\"/>";
      }).join("") + "</numFmts>" +
      "<fonts count=\"" + this.fonts.length + "\">" + this.fonts.join("") + "</fonts>" +
      "<fills count=\"" + this.fills.length + "\">" + this.fills.join("") + "</fills>" +
      "<borders count=\"" + this.borders.length + "\">" + this.borders.join("") + "</borders>" +
      "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
      "<cellXfs count=\"" + this.xfs.length + "\">" + this.xfs.join("") + "</cellXfs>" +
      "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
      "<dxfs count=\"3\">" + dxfs.join("") + "</dxfs>" +
      "</styleSheet>";
  };

  var DXF = { good: 0, bad: 1, warn: 2 };

  // ------------------------------------------------------------------ cells
  function strCell(ref, text, style) {
    return "<c r=\"" + ref + "\" t=\"inlineStr\" s=\"" + style + "\"><is><t xml:space=\"preserve\">" + esc(text) + "</t></is></c>";
  }

  function numCell(ref, value, style) {
    return "<c r=\"" + ref + "\" s=\"" + style + "\"><v>" + value + "</v></c>";
  }

  function formulaCell(ref, formula, style, isText) {
    return "<c r=\"" + ref + "\" s=\"" + style + "\"" + (isText ? " t=\"str\"" : "") + "><f>" + esc(formula) + "</f></c>";
  }

  function emptyCell(ref, style) {
    return "<c r=\"" + ref + "\" s=\"" + style + "\"/>";
  }

  // ------------------------------------------------------------------ build
  function build(rawSpec, options) {
    options = options || {};
    var spec = Core.normalize(rawSpec);
    var theme = Core.themeById(spec.theme);
    var styles = new StyleBook(theme, spec.currency);
    var cols = spec.sheet.columns;
    var dataRows = spec.sheet.rows;
    var lastRow = 1 + Math.max(PREPARED_ROWS, dataRows.length + 50);
    var dataName = "Data";
    var letters = {};
    cols.forEach(function (c, i) {
      letters[c.name.toLowerCase()] = colLetter(i);
    });
    var keyCol = null;
    for (var k = 0; k < cols.length; k++) {
      if (cols[k].type !== "formula") {
        keyCol = colLetter(k);
        break;
      }
    }
    var bodyFill = theme.dark ? 4 : 0;
    var headerStyle = styles.xf(1, 2, 1, 0, true);
    var formulaAsts = {};
    cols.forEach(function (c) {
      if (c.type === "formula" && !Core.validateFormula(spec, c.formula, c.name)) {
        formulaAsts[c.id] = Core.parse(c.formula);
      }
    });

    function bodyStyle(col, rowNumber) {
      var fmt = Core.columnFormat(col);
      var fill = rowNumber % 2 === 0 ? bodyFill : 3;
      return styles.xf(0, fill, 0, styles.formatIds[fmt] || 0, fmt === "text");
    }

    // --- Data sheet rows
    var rowsXml = [];
    var header = cols.map(function (c, i) {
      return strCell(colLetter(i) + "1", c.name, headerStyle);
    }).join("");
    rowsXml.push("<row r=\"1\" ht=\"24\" customHeight=\"1\">" + header + "</row>");
    for (var r = 2; r <= lastRow; r++) {
      var src = dataRows[r - 2];
      var cells = cols.map(function (col, i) {
        var ref = colLetter(i) + r;
        var style = bodyStyle(col, r);
        if (col.type === "formula") {
          var ast = formulaAsts[col.id];
          if (!ast) {
            return emptyCell(ref, style);
          }
          var expr = Core.toExcel(ast, function (name) {
            return (letters[String(name).toLowerCase()] || "A") + r;
          });
          var guarded = keyCol ? "IF(" + keyCol + r + "=\"\",\"\"," + expr + ")" : expr;
          return formulaCell(ref, guarded, style, Core.columnFormat(col) === "text");
        }
        var raw = src ? src[col.id] : "";
        if (raw === undefined || raw === null || raw === "") {
          return emptyCell(ref, style);
        }
        if (col.type === "date") {
          var serial = Core.serialFromIso(raw);
          return serial === null ? strCell(ref, raw, style) : numCell(ref, serial, style);
        }
        if (col.type === "number" || col.type === "currency" || col.type === "percent") {
          var n = parseFloat(raw);
          return isNaN(n) ? strCell(ref, raw, style) : numCell(ref, n, style);
        }
        return strCell(ref, raw, style);
      }).join("");
      rowsXml.push("<row r=\"" + r + "\">" + cells + "</row>");
    }

    var lastCol = colLetter(cols.length - 1);
    var colsXml = "<cols>" + cols.map(function (c, i) {
      var width = c.type === "text" ? 24 : c.type === "date" ? 13 : c.type === "formula" ? 16 : 14;
      width = Math.max(width, Math.min(40, c.name.length + 4));
      return "<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" + width + "\" customWidth=\"1\"/>";
    }).join("") + "</cols>";

    // conditional formatting
    var cf = [];
    var priority = 1;
    spec.rules.forEach(function (rule) {
      var letter = letters[String(rule.column).toLowerCase()];
      if (!letter) {
        return;
      }
      var range = letter + "2:" + letter + lastRow;
      var isNum = typeof rule.value === "number" || (rule.value !== "" && !isNaN(parseFloat(rule.value)) && isFinite(rule.value));
      var value = isNum ? String(parseFloat(rule.value)) : "\"" + String(rule.value).replace(/"/g, "\"\"") + "\"";
      var op = rule.op === "<" ? "lessThan" : rule.op === ">" ? "greaterThan" : "equal";
      var guardFormula;
      if (isNum && rule.op !== "=") {
        guardFormula = "AND(ISNUMBER(" + letter + "2)," + letter + "2" + rule.op + value + ")";
        cf.push("<conditionalFormatting sqref=\"" + range + "\"><cfRule type=\"expression\" dxfId=\"" + DXF[rule.style] + "\" priority=\"" + priority + "\"><formula>" + esc(guardFormula) + "</formula></cfRule></conditionalFormatting>");
      } else {
        cf.push("<conditionalFormatting sqref=\"" + range + "\"><cfRule type=\"cellIs\" dxfId=\"" + DXF[rule.style] + "\" priority=\"" + priority + "\" operator=\"" + op + "\"><formula>" + esc(value) + "</formula></cfRule></conditionalFormatting>");
      }
      priority += 1;
    });

    // data validation
    var dv = [];
    cols.forEach(function (c, i) {
      var range = colLetter(i) + "2:" + colLetter(i) + lastRow;
      if (c.type === "select" && c.options && c.options.length) {
        var list = c.options.map(function (o) {
          return String(o).replace(/[,"]/g, " ").trim();
        }).join(",").slice(0, 250);
        dv.push("<dataValidation type=\"list\" allowBlank=\"1\" showInputMessage=\"1\" showErrorMessage=\"1\" sqref=\"" + range + "\"><formula1>" + esc("\"" + list + "\"") + "</formula1></dataValidation>");
      } else if (c.type === "check") {
        dv.push("<dataValidation type=\"list\" allowBlank=\"1\" showErrorMessage=\"1\" sqref=\"" + range + "\"><formula1>\"Yes,No\"</formula1></dataValidation>");
      } else if (c.type === "date") {
        dv.push("<dataValidation type=\"date\" operator=\"greaterThan\" allowBlank=\"1\" showErrorMessage=\"1\" errorTitle=\"Date\" error=\"Enter a date (yyyy-mm-dd)\" sqref=\"" + range + "\"><formula1>1</formula1></dataValidation>");
      }
    });

    var dataSheet = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
      "<sheetPr><tabColor rgb=\"FF" + theme.header + "\"/></sheetPr>" +
      "<dimension ref=\"A1:" + lastCol + lastRow + "\"/>" +
      "<sheetViews><sheetView workbookViewId=\"0\"" + (options.activeData ? " tabSelected=\"1\"" : "") + "><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>" +
      "<sheetFormatPr defaultRowHeight=\"18\"/>" + colsXml +
      "<sheetData>" + rowsXml.join("") + "</sheetData>" +
      "<autoFilter ref=\"A1:" + lastCol + lastRow + "\"/>" +
      cf.join("") +
      (dv.length ? "<dataValidations count=\"" + dv.length + "\">" + dv.join("") + "</dataValidations>" : "") +
      "<pageMargins left=\"0.5\" right=\"0.5\" top=\"0.6\" bottom=\"0.6\" header=\"0.3\" footer=\"0.3\"/>" +
      "</worksheet>";

    // --- Dashboard sheet
    var titleStyle = styles.xf(2, 0, 0, 0, false);
    var noteStyle = styles.xf(3, 0, 0, 0, false);
    var labelStyle = styles.xf(0, 3, 1, 0, false);
    var dashRows = [];
    dashRows.push("<row r=\"1\" ht=\"30\" customHeight=\"1\">" + strCell("B1", spec.title, titleStyle) + "</row>");
    dashRows.push("<row r=\"2\">" + strCell("B2", spec.description || "Dashboard", noteStyle) + "</row>");
    var rowIndex = 4;
    dashRows.push("<row r=\"" + rowIndex + "\">" + strCell("B4", "Metric", headerStyle) + strCell("C4", "Value", headerStyle) + "</row>");
    spec.summary.forEach(function (s) {
      var letter = letters[String(s.column).toLowerCase()];
      if (!letter) {
        return;
      }
      rowIndex += 1;
      var range = sheetRef(dataName) + "!$" + letter + "$2:$" + letter + "$" + lastRow;
      var col = null;
      cols.forEach(function (c) {
        if (c.name.toLowerCase() === String(s.column).toLowerCase()) {
          col = c;
        }
      });
      var formula;
      if (s.fn === "COUNTA") {
        formula = "SUMPRODUCT((LEN(" + range + ")>0)*1)";
      } else if (s.fn === "COUNTIF") {
        formula = "COUNTIF(" + range + ",\"" + String(s.match).replace(/"/g, "\"\"") + "\")";
      } else if (s.fn === "AVERAGE") {
        formula = "IFERROR(AVERAGE(" + range + "),0)";
      } else {
        formula = s.fn + "(" + range + ")";
      }
      var fmt = s.fn === "COUNTA" || s.fn === "COUNTIF" ? "number" : Core.columnFormat(col);
      var valueStyle = styles.xf(4, 0, 1, styles.formatIds[fmt === "text" ? "number" : fmt] || 0, false);
      dashRows.push("<row r=\"" + rowIndex + "\" ht=\"26\" customHeight=\"1\">" + strCell("B" + rowIndex, s.label, labelStyle) + formulaCell("C" + rowIndex, formula, valueStyle, false) + "</row>");
    });
    rowIndex += 2;
    var tips = [
      "How to use: add rows on the \u201c" + dataName + "\u201d tab \u2014 calculated columns, colours and this dashboard update automatically.",
      "Dropdown columns only accept listed values. Dates use yyyy-mm-dd.",
      "Works in Microsoft Excel and Google Sheets (File \u203a Import). " + (options.footer || "Made with Mint.")
    ];
    tips.forEach(function (tip) {
      dashRows.push("<row r=\"" + rowIndex + "\">" + strCell("B" + rowIndex, tip, noteStyle) + "</row>");
      rowIndex += 1;
    });
    var dashSheet = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
      "<sheetPr><tabColor rgb=\"FF" + theme.accent + "\"/></sheetPr>" +
      "<dimension ref=\"A1:C" + rowIndex + "\"/>" +
      "<sheetViews><sheetView showGridLines=\"0\" workbookViewId=\"0\"" + (options.activeData ? "" : " tabSelected=\"1\"") + "/></sheetViews>" +
      "<sheetFormatPr defaultRowHeight=\"18\"/>" +
      "<cols><col min=\"1\" max=\"1\" width=\"3\" customWidth=\"1\"/><col min=\"2\" max=\"2\" width=\"36\" customWidth=\"1\"/><col min=\"3\" max=\"3\" width=\"22\" customWidth=\"1\"/></cols>" +
      "<sheetData>" + dashRows.join("") + "</sheetData>" +
      "<pageMargins left=\"0.5\" right=\"0.5\" top=\"0.6\" bottom=\"0.6\" header=\"0.3\" footer=\"0.3\"/>" +
      "</worksheet>";

    var workbook = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
      "<bookViews><workbookView activeTab=\"" + (options.activeData ? 1 : 0) + "\"/></bookViews>" +
      "<sheets><sheet name=\"Dashboard\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"" + dataName + "\" sheetId=\"2\" r:id=\"rId2\"/></sheets>" +
      "<definedNames><definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"1\" hidden=\"1\">" + esc(sheetRef(dataName) + "!$A$1:$" + lastCol + "$" + lastRow) + "</definedName></definedNames>" +
      "<calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/>" +
      "</workbook>";

    var files = [
      {
        name: "[Content_Types].xml",
        data: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
          "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
          "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
          "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
          "<Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
          "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
          "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
          "</Types>"
      },
      {
        name: "_rels/.rels",
        data: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
          "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
          "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
          "</Relationships>"
      },
      {
        name: "docProps/core.xml",
        data: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
          "<dc:title>" + esc(spec.title) + "</dc:title><dc:creator>" + esc(options.author || "Mint") + "</dc:creator><dc:description>" + esc(spec.description) + "</dc:description>" +
          "</cp:coreProperties>"
      },
      { name: "xl/workbook.xml", data: workbook },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
          "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
          "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>" +
          "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
          "</Relationships>"
      },
      { name: "xl/worksheets/sheet1.xml", data: dashSheet },
      { name: "xl/worksheets/sheet2.xml", data: dataSheet },
      { name: "xl/styles.xml", data: styles.xml() }
    ];
    return zip(files);
  }

  function toCsv(rawSpec) {
    var spec = Core.normalize(rawSpec);
    var result = Core.compute(spec);
    function cell(v) {
      var s = v === undefined || v === null ? "" : String(v);
      return /[",\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
    }
    var lines = [spec.sheet.columns.map(function (c) {
      return cell(c.name);
    }).join(",")];
    result.rows.forEach(function (row) {
      lines.push(row.cells.map(function (c) {
        return cell(c.col.type === "date" ? c.display : (typeof c.value === "number" ? c.value : c.display));
      }).join(","));
    });
    return lines.join("\n") + "\n";
  }

  function base64(bytes) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i];
      var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += chars[a >> 2] + chars[((a & 3) << 4) | (b >> 4)];
      out += i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6)] : "=";
      out += i + 2 < bytes.length ? chars[c & 63] : "=";
    }
    return out;
  }

  root.MintXlsx = {
    build: build,
    toCsv: toCsv,
    base64: base64,
    crc32: crc32,
    utf8: utf8,
    colLetter: colLetter
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
