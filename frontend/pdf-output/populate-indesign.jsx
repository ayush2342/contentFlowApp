// =============================================================================
// populate-indesign.jsx (server-safe)
// Reads tree_output.json and fills labeled frames in InDesign.
// Exports output.pdf in the SAME folder as this script.
// =============================================================================

/* global app, File, Folder, ExportFormat, FitOptions, UserInteractionLevels, ColorModel, ColorSpace, SaveOptions, PagesPerDocumentOptions, MeasurementUnits */

// -----------------------------------------------------------------------------
// Layout mode: true = create frames from proto:* prototypes (Option B)
//             false = fill pre-numbered frames (lessonTitle1, text2, …)
// -----------------------------------------------------------------------------
var USE_DYNAMIC_LAYOUT = true;

var DYNAMIC_LAYOUT = {
    protoPrefix: "proto:",
    // Spacing values are expressed in POINTS. The document ruler is forced to
    // points in normalizeDocumentForDynamicLayout() so these stay consistent
    // regardless of the template's saved measurement units.
    blockGap: 6,            // ~8px / 0.5rem uniform gap between every block
    imageCaptionGap: 6,
    imageCaptionReserve: 40, // height kept free below a full-bleed image for its caption
    afterImageGap: 12,      // space below image/caption before the next block
    listTailGap: 8,         // space after the last bullet/numbered item
    prototypeOffPageTop: -2000,
    minTextFrameHeight: 24,
    defaultImageFrameHeight: 180
};

var layoutState = null;
var contentLayer = null;

var PROTOTYPE_TEXT_FALLBACK = "proto:text";
var POPULATE_SCRIPT_VERSION = "dynamic-v27-scale-percent-always-honor-json";
var prototypeMetrics = {};
var scriptLogFolderPath = "";
var CURRENT_PAGE_TYPE = "opener";
var LAYOUT_FORMAT = null; // from layout-format.json / shared/formats/{id}.json
var LAYOUT_FORMAT_ID = "";

// -----------------------------------------------------------------------------
// Run headless (no popups/dialogs on server)
// -----------------------------------------------------------------------------
try {
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
} catch (interactionError) {
    // Best effort only.
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
function trimString(value) {
    return String(value).replace(/^\s+|\s+$/g, "");
}

function writeTextFile(filePath, content) {
    var f = File(filePath);
    var parentFolder;

    try {
        parentFolder = f.parent;
        if (parentFolder && !parentFolder.exists) {
            parentFolder.create();
        }
    } catch (folderError) {}

    // Always write UTF-8 so smart quotes / dashes round-trip correctly.
    f.encoding = "UTF-8";
    if (f.open("w")) {
        f.write(content);
        f.close();
        return true;
    }

    return false;
}

/** Read a text file as UTF-8 (required for curly quotes, em dashes, NBSP, etc.). */
function readTextFileUtf8(fileOrPath) {
    var f = fileOrPath instanceof File ? fileOrPath : File(fileOrPath);
    var content;

    if (!f || !f.exists) {
        return null;
    }

    f.encoding = "UTF-8";
    if (!f.open("r")) {
        return null;
    }

    content = f.read();
    f.close();
    return content;
}

/**
 * Repair common UTF-8→Latin-1 mojibake (â€™, â€œ, â€”, Â…) if a file
 * was previously read without UTF-8 encoding.
 */
function fixUtf8Mojibake(text) {
    var s = String(text == null ? "" : text);
    if (s.indexOf("\u00e2") < 0 && s.indexOf("\u00c2") < 0) {
        return s;
    }
    return s
        .replace(/\u00e2\u20ac\u2122/g, "\u2019")
        .replace(/\u00e2\u20ac\u0160/g, "\u2018")
        .replace(/\u00e2\u20ac\u0153/g, "\u201C")
        .replace(/\u00e2\u20ac\u009d/g, "\u201D")
        .replace(/\u00e2\u20ac\u201c/g, "\u201C")
        .replace(/\u00e2\u20ac\u201d/g, "\u201D")
        .replace(/\u00e2\u20ac\u2013/g, "\u2013")
        .replace(/\u00e2\u20ac\u2014/g, "\u2014")
        .replace(/\u00e2\u20ac\u00a6/g, "\u2026")
        .replace(/\u00e2\u20ac\u2122/g, "\u2019")
        .replace(/â€™/g, "\u2019")
        .replace(/â€˜/g, "\u2018")
        .replace(/â€œ/g, "\u201C")
        .replace(/â€/g, "\u201D")
        .replace(/â€“/g, "\u2013")
        .replace(/â€”/g, "\u2014")
        .replace(/â€¦/g, "\u2026")
        .replace(/\u00c2\u00a0/g, "\u00a0")
        .replace(/\u00c2 /g, " ")
        .replace(/\u00c2/g, "");
}

function sanitizeJsonStrings(value) {
    var i;
    var key;

    if (value == null) {
        return value;
    }
    if (typeof value === "string") {
        return fixUtf8Mojibake(value);
    }
    if (value.length !== undefined) {
        for (i = 0; i < value.length; i++) {
            value[i] = sanitizeJsonStrings(value[i]);
        }
        return value;
    }
    if (typeof value === "object") {
        for (key in value) {
            if (value.hasOwnProperty(key)) {
                value[key] = sanitizeJsonStrings(value[key]);
            }
        }
    }
    return value;
}

function buildRenderLogText(status, extraLines) {
    var logText = "";
    var w;

    logText = "Render log status: " + (status || "in-progress") + "\n";
    logText += "Script version: " + POPULATE_SCRIPT_VERSION + "\n";
    if (scriptLogFolderPath) {
        logText += "Log folder: " + scriptLogFolderPath + "\n";
        logText += "render.log: " + scriptLogFolderPath + "/render.log\n";
        logText += "error.log:  " + scriptLogFolderPath + "/error.log\n";
        logText += "output.pdf: " + scriptLogFolderPath + "/output.pdf\n";
    }
    logText += "Updated: " + new Date().toString() + "\n";

    if (extraLines) {
        logText += "\n" + extraLines + "\n";
    }

    if (renderLogEntries.length > 0) {
        logText += "\nBlock mapping log:\n";
        for (w = 0; w < renderLogEntries.length; w++) {
            logText += renderLogEntries[w] + "\n";
        }
    }

    return logText;
}

function flushRenderLog(status, extraLines) {
    var logText;
    var written;

    if (!scriptLogFolderPath) {
        return false;
    }

    logText = buildRenderLogText(status, extraLines);
    written = writeTextFile(scriptLogFolderPath + "/render.log", logText);
    return written;
}

function logInfo(scriptFolderPath, message) {
    try {
        writeTextFile(scriptFolderPath + "/render.log", message);
    } catch (e) {}
}

function logError(scriptFolderPath, message) {
    var errorText;

    try {
        errorText = message;
        if (renderLogEntries.length > 0) {
            errorText += "\n\nPartial block mapping log:\n";
            errorText += buildRenderLogText("failed").split("Block mapping log:\n").pop();
        }
        writeTextFile(scriptFolderPath + "/error.log", errorText);
        flushRenderLog("failed", message);
    } catch (e) {}
}

// -----------------------------------------------------------------------------
// LEGACY JSON PARSER (ES3-compatible for ExtendScript)
// -----------------------------------------------------------------------------
function parseJSON(text) {
    var at = 0;
    var ch = " ";

    function error(message) {
        throw new Error(message + " at position " + at);
    }

    function next() {
        ch = text.charAt(at);
        at += 1;
        return ch;
    }

    function white() {
        while (ch !== "" && ch <= " ") {
            next();
        }
    }

    function value() {
        white();
        switch (ch) {
            case "{":
                return object();
            case "[":
                return array();
            case '"':
                return string();
            case "-":
                return number();
            default:
                if (ch >= "0" && ch <= "9") {
                    return number();
                }
                if (ch === "t") {
                    if (text.substr(at - 1, 4) === "true") {
                        at += 3;
                        next();
                        return true;
                    }
                }
                if (ch === "f") {
                    if (text.substr(at - 1, 5) === "false") {
                        at += 4;
                        next();
                        return false;
                    }
                }
                if (ch === "n") {
                    if (text.substr(at - 1, 4) === "null") {
                        at += 3;
                        next();
                        return null;
                    }
                }
                error("Bad JSON value");
        }
    }

    function string() {
        var i;
        var s = "";
        var hex;

        if (ch === '"') {
            while (next()) {
                if (ch === '"') {
                    next();
                    return s;
                }
                if (ch === "\\") {
                    next();
                    if (ch === "b") {
                        s += "\b";
                    } else if (ch === "f") {
                        s += "\f";
                    } else if (ch === "n") {
                        s += "\n";
                    } else if (ch === "r") {
                        s += "\r";
                    } else if (ch === "t") {
                        s += "\t";
                    } else if (ch === "u") {
                        hex = "";
                        for (i = 0; i < 4; i += 1) {
                            hex += next();
                        }
                        s += String.fromCharCode(parseInt(hex, 16));
                    } else {
                        s += ch;
                    }
                } else {
                    s += ch;
                }
            }
        }
        error("Bad JSON string");
    }

    function number() {
        var n = "";

        if (ch === "-") {
            n = "-";
            next();
        }
        while (ch >= "0" && ch <= "9") {
            n += ch;
            next();
        }
        if (ch === ".") {
            n += ".";
            while (next() && ch >= "0" && ch <= "9") {
                n += ch;
            }
        }
        if (ch === "e" || ch === "E") {
            n += ch;
            next();
            if (ch === "-" || ch === "+") {
                n += ch;
                next();
            }
            while (ch >= "0" && ch <= "9") {
                n += ch;
                next();
            }
        }
        return Number(n);
    }

    function array() {
        var a = [];

        if (ch === "[") {
            next();
            white();
            if (ch === "]") {
                next();
                return a;
            }
            while (ch) {
                a.push(value());
                white();
                if (ch === "]") {
                    next();
                    return a;
                }
                if (ch !== ",") {
                    error("Bad JSON array");
                }
                next();
                white();
            }
        }
        error("Bad JSON array");
    }

    function object() {
        var k;
        var o = {};

        if (ch === "{") {
            next();
            white();
            if (ch === "}") {
                next();
                return o;
            }
            while (ch) {
                k = string();
                white();
                if (ch !== ":") {
                    error("Bad JSON object");
                }
                next();
                o[k] = value();
                white();
                if (ch === "}") {
                    next();
                    return o;
                }
                if (ch !== ",") {
                    error("Bad JSON object");
                }
                next();
                white();
            }
        }
        error("Bad JSON object");
    }

    if (typeof text !== "string") {
        error("JSON text must be a string");
    }

    next();
    white();
    var result = value();
    white();

    if (ch) {
        error("Unexpected text after JSON");
    }

    return result;
}

// -----------------------------------------------------------------------------
// Typography configuration loader
// Loads centralized styles from shared/typography-styles.json
// -----------------------------------------------------------------------------
function hexToRgb(hex) {
    var result;
    var hexClean = String(hex || "").replace(/^#/, "");
    
    if (hexClean.length === 6) {
        return [
            parseInt(hexClean.substring(0, 2), 16),
            parseInt(hexClean.substring(2, 4), 16),
            parseInt(hexClean.substring(4, 6), 16)
        ];
    }
    return [0, 0, 0];
}

function convertTypographyStyle(style) {
    var colorValue;

    if (!style || typeof style !== "object") {
        return {
            fontFamily: "",
            pointSize: 12,
            bold: false,
            italic: false,
            leftIndent: 0,
            color: [0, 0, 0],
            backgroundColor: null,
            altBackgroundColor: null
        };
    }

    if (style.color && typeof style.color !== "string" && style.color.length !== undefined) {
        colorValue = style.color;
    } else {
        colorValue = hexToRgb(style.color);
    }

    return {
        fontFamily: style.font || style.fontFamily || "",
        pointSize: style.size || style.pointSize || 12,
        // Accept true / "true" / 1 so any theme component bold/italic works.
        bold: isTruthyFlag(style.bold),
        italic: isTruthyFlag(style.italic),
        leftIndent: style.leftIndent || 0,
        color: colorValue,
        backgroundColor: style.backgroundColor || null,
        altBackgroundColor: style.altBackgroundColor || style.altbackgroundColor || null,
        // Theme-driven rules (e.g. sectionTitle "2px solid #CA5021") — any block.
        borderTop: style.borderTop || null,
        borderBottom: style.borderBottom || null,
        textTransform: style.textTransform || null
    };
}

function isTruthyFlag(value) {
    return value === true || value === 1 || value === "1" ||
        String(value || "").toLowerCase() === "true";
}

function isQuotationStyle(value) {
    return value &&
        typeof value === "object" &&
        value.text && typeof value.text === "object" &&
        value.author && typeof value.author === "object";
}

function isTableStyle(value) {
    return value &&
        typeof value === "object" &&
        (value.headingText || value.rowsText);
}

function isRawCompositeStyle(value) {
    return value &&
        typeof value === "object" &&
        value.text && typeof value.text === "object" &&
        value.number && typeof value.number === "object";
}

function normalizeTypographyEntry(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    if (isRawCompositeStyle(value)) {
        return null;
    }
    if (value.text && typeof value.text === "object") {
        return value.text;
    }
    return value;
}

function pickTypographyEntry(styleSet, keys) {
    var i;
    var key;
    var candidate;
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        if (styleSet.hasOwnProperty(key)) {
            candidate = normalizeTypographyEntry(styleSet[key]);
            if (candidate) {
                return candidate;
            }
        }
    }
    return null;
}

function pickRawTypographyEntry(styleSet, keys) {
    var i;
    var key;
    var candidate;

    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        if (styleSet.hasOwnProperty(key)) {
            candidate = styleSet[key];
            if (candidate && typeof candidate === "object") {
                return candidate;
            }
        }
    }
    return null;
}

function normalizePageType(pageType) {
    var rawMode = trimString(pageType || CURRENT_PAGE_TYPE || "opener").toLowerCase();

    if (rawMode === "non_opener" || rawMode === "non-opener" || rawMode === "nonopener") {
        return "nonOpener";
    }
    return "opener";
}

function getTypographyMode(config) {
    if (CURRENT_PAGE_TYPE) {
        return normalizePageType(CURRENT_PAGE_TYPE);
    }

    var rawMode = "";
    if (config && config.ACTIVE_STYLE_MODE) {
        rawMode = String(config.ACTIVE_STYLE_MODE);
    } else if (config && config.styleMode) {
        rawMode = String(config.styleMode);
    } else {
        rawMode = "opener";
    }

    return normalizePageType(rawMode);
}

function resolveConfigStyle(rawEntry) {
    if (!rawEntry) {
        return null;
    }
    if (isRawCompositeStyle(rawEntry)) {
        return {
            text: convertTypographyStyle(rawEntry.text),
            number: convertTypographyStyle(rawEntry.number)
        };
    }
    if (isQuotationStyle(rawEntry)) {
        return {
            text: convertTypographyStyle(rawEntry.text),
            author: convertTypographyStyle(rawEntry.author),
            backgroundColor: rawEntry.backgroundColor || null
        };
    }
    if (isTableStyle(rawEntry)) {
        return {
            headingText: convertTypographyStyle(rawEntry.headingText || {}),
            subHeadingText: convertTypographyStyle(rawEntry.subHeadingText || {}),
            rowsText: convertTypographyStyle(rawEntry.rowsText || {})
        };
    }
    return convertTypographyStyle(rawEntry);
}

function cloneFallbackStyle(key) {
    var fallback = FRAME_STYLES_DEFAULTS[key];

    if (!fallback) {
        return null;
    }
    if (fallback.text && fallback.number) {
        return {
            text: convertTypographyStyle(fallback.text),
            number: convertTypographyStyle(fallback.number)
        };
    }
    if (isQuotationStyle(fallback)) {
        return {
            text: convertTypographyStyle(fallback.text),
            author: convertTypographyStyle(fallback.author),
            backgroundColor: fallback.backgroundColor || null
        };
    }
    if (isTableStyle(fallback)) {
        return {
            headingText: convertTypographyStyle(fallback.headingText || {}),
            subHeadingText: convertTypographyStyle(fallback.subHeadingText || {}),
            rowsText: convertTypographyStyle(fallback.rowsText || {})
        };
    }
    return fallback;
}

function buildCanonicalStyleMap(styleSet) {
    var chapterHeading = pickTypographyEntry(styleSet, ["chapterHeading", "chapterNumber"]);
    var chapterNumber = pickTypographyEntry(styleSet, ["chapterNumber", "chapterHeading"]);
    var chapterTitle = pickTypographyEntry(styleSet, ["chapterTitle"]);
    var chapterOverview = pickTypographyEntry(styleSet, ["chapterOverview"]);
    var lessonOverview = pickRawTypographyEntry(styleSet, ["lessonOverview", "topic"]);
    var lessonTitle = pickTypographyEntry(styleSet, ["lessonTitle"]);
    var learningObjectives = pickTypographyEntry(styleSet, ["learningObjectives"]);
    var sectionTitle = pickRawTypographyEntry(styleSet, ["sectionTitle"]);
    var subTitlesList = pickRawTypographyEntry(styleSet, ["subTitlesList"]);
    var subSectionTitle = pickTypographyEntry(styleSet, ["subSectionTitle"]);
    var greenSubSectionTitle = pickTypographyEntry(styleSet, ["greenSubSectionTitle"]);
    var subTitle = pickTypographyEntry(styleSet, ["subTitle"]);
    var partNumber = pickTypographyEntry(styleSet, ["partNumber"]);
    var paragraphText = pickTypographyEntry(styleSet, ["paragraphText", "paragrapghText", "text"]);
    // Theme-only keys: do not invent from other styles when absent (e.g. theme 1).
    var bulletList = pickTypographyEntry(styleSet, ["bulletList", "bullestList"]);
    var numberedList = pickTypographyEntry(styleSet, ["numberedList"]);
    var imageFigureNumber = pickTypographyEntry(styleSet, ["imageFigureNumber"]);
    var imageFigureText = pickTypographyEntry(styleSet, ["imageFigureText", "imageCaption", "figureCaption"]);
    var quotation = pickRawTypographyEntry(styleSet, ["quotation", "quote"]);
    var table = pickRawTypographyEntry(styleSet, ["table"]);
    var footer = pickTypographyEntry(styleSet, ["footer"]);
    var subSectionHeading = pickTypographyEntry(styleSet, ["subSectionHeading", "subsectionHeading"]);

    return {
        chapterHeading: chapterHeading,
        chapterTitle: chapterTitle,
        chapterOverview: chapterOverview,
        lessonOverview: lessonOverview,
        lessonTitle: lessonTitle,
        learningObjectives: learningObjectives,
        sectionTitle: sectionTitle,
        subTitlesList: subTitlesList,
        subSectionTitle: subSectionTitle,
        greenSubSectionTitle: greenSubSectionTitle,
        subSectionHeading: subSectionHeading,
        subTitle: subTitle,
        partNumber: partNumber,
        paragraphText: paragraphText,
        bulletList: bulletList,
        numberedList: numberedList,
        imageFigureNumber: imageFigureNumber,
        imageFigureText: imageFigureText,
        chapterNumber: chapterNumber || chapterHeading,
        lessonNumber: chapterHeading,
        topic: lessonOverview,
        text: paragraphText,
        imageCaption: imageFigureText,
        figureCaption: imageFigureText,
        logoText: subSectionTitle || greenSubSectionTitle,
        quotation: quotation,
        table: table,
        footer: footer
    };
}

function loadTypographyConfig(scriptFolderPath) {
    var configPaths = [
        scriptFolderPath + "/typography-styles.json",
        scriptFolderPath + "/../../shared/typography-styles.json",
        scriptFolderPath + "/../../../shared/typography-styles.json"
    ];
    
    var configFile;
    var i;
    var rawJson;
    var config;
    var loadedPath = "";
    
    for (i = 0; i < configPaths.length; i++) {
        configFile = File(configPaths[i]);
        if (configFile.exists) {
            loadedPath = configFile.fsName;
            break;
        }
        configFile = null;
    }
    
    if (!configFile || !configFile.exists) {
        return null;
    }

    rawJson = readTextFileUtf8(configFile);
    if (rawJson === null) {
        return null;
    }

    try {
        config = parseJSON(rawJson);
        config.__loadedFrom = loadedPath;
        return config;
    } catch (parseError) {
        return null;
    }
}

function normalizeFormatIdToken(value) {
    var raw = trimString(String(value || "")).toLowerCase().replace(/[\s_]+/g, "");
    var match;

    if (!raw) {
        return "";
    }
    match = raw.match(/^(?:theme|format)?(\d+)$/);
    if (match) {
        return match[1];
    }
    return "";
}

function loadLayoutFormat(scriptFolderPath, preferredFormatId) {
    var formatId = normalizeFormatIdToken(preferredFormatId) || "2";
    var configPaths = [
        scriptFolderPath + "/layout-format.json",
        scriptFolderPath + "/../../shared/formats/" + formatId + ".json",
        scriptFolderPath + "/../../../shared/formats/" + formatId + ".json"
    ];
    var configFile;
    var i;
    var rawJson;
    var config;
    var layout;

    for (i = 0; i < configPaths.length; i++) {
        configFile = File(configPaths[i]);
        if (configFile.exists) {
            break;
        }
        configFile = null;
    }

    if (!configFile || !configFile.exists) {
        return null;
    }

    rawJson = readTextFileUtf8(configFile);
    if (rawJson === null) {
        return null;
    }

    try {
        config = parseJSON(rawJson);
        if (config && config.formatId) {
            LAYOUT_FORMAT_ID = normalizeFormatIdToken(config.formatId) || formatId;
        } else {
            LAYOUT_FORMAT_ID = formatId;
        }
        // Job file shape: { formatId, layout: { opener, non-opener } }
        if (config && config.layout && (config.layout.opener || config.layout["non-opener"])) {
            layout = config.layout;
        } else {
            layout = config;
        }
        appendRenderLog(
            "Layout format loaded from " + configFile.fsName +
            " (formatId=" + LAYOUT_FORMAT_ID + ")"
        );
        return layout;
    } catch (parseError) {
        return null;
    }
}

/** Page column count from format sheet (default: opener=1, non-opener=2). */
function resolvePageColumnCount(pageType, layoutFormat) {
    var key = String(pageType || "opener").toLowerCase();
    var section;

    if (key === "non_opener" || key === "non-opener" || key === "nonopener") {
        key = "non-opener";
    } else {
        key = "opener";
    }

    if (layoutFormat && layoutFormat[key] && layoutFormat[key].columns != null) {
        return Number(layoutFormat[key].columns) === 2 ? 2 : 1;
    }

    return key === "non-opener" ? 2 : 1;
}

/** Per-block columns from format sheet (e.g. opener.LessonOverview.columns = 2). */
function resolveComponentColumnCount(itemType, pageType, layoutFormat) {
    var key = String(pageType || "opener").toLowerCase();
    var section;
    var entry;
    var columns;

    if (key === "non_opener" || key === "non-opener" || key === "nonopener") {
        key = "non-opener";
    } else {
        key = "opener";
    }

    section = layoutFormat && layoutFormat[key];
    entry = section && section[itemType];
    columns = entry && entry.columns != null ? Number(entry.columns) : NaN;
    if (columns === 2) return 2;
    if (columns === 1) return 1;
    return resolvePageColumnCount(pageType, layoutFormat);
}

/**
 * Place consecutive LessonOverview (etc.) items in a 2-col grid on opener pages.
 * Splits half/half left|right — same intent as web componentTwoColumn.
 */
function placeTwoColumnTextGroup(layoutState, document, items, registryEntry) {
    var mid;
    var startY;
    var leftBottom;
    var rightBottom;
    var savedColumnCount;
    var savedColumn;
    var i;
    var cleanText;
    var frame;
    var protoHeight;
    var protoResult;
    var spacing;

    if (!items || !items.length || !registryEntry) {
        return;
    }

    mid = Math.ceil(items.length / 2);
    startY = layoutState.cursorY;
    savedColumnCount = layoutState.columnCount;
    savedColumn = layoutState.currentColumn;
    spacing = resolveBlockSpacing(registryEntry);
    // Theme 2: keep the existing roomy gap between LO rows.
    // Theme 1: do not force 24pt — that looks like a blank line between 9pt items.
    if (usesRoomyOverviewSpacing()) {
        spacing = Math.max(spacing, 24);
    }

    protoResult = resolveTextPrototype(document, registryEntry.prototype);
    protoHeight = protoResult
        ? getDynamicTextSeedHeight(
            protoResult.usedFallback ? protoResult.label : registryEntry.prototype,
            protoResult.usedFallback ? registryEntry.prototype : null
          )
        : DYNAMIC_LAYOUT.minTextFrameHeight;

    layoutState.columnCount = 2;
    layoutState.currentColumn = 0;
    layoutState.cursorY = startY;

    for (i = 0; i < mid; i++) {
        cleanText = getBlockText(items[i].data || {});
        if (!cleanText || isPlaceholderText(cleanText)) {
            continue;
        }
        try {
            frame = flowDynamicText(
                layoutState,
                cleanText,
                registryEntry.style,
                DYNAMIC_LAYOUT.minTextFrameHeight,
                protoHeight
            );
            advanceLayoutCursor(layoutState, frame, spacing);
            populatedCount += 1;
        } catch (leftError) {
            warnings.push("Two-column group left item failed: " + leftError.message);
        }
    }
    leftBottom = layoutState.cursorY;

    layoutState.currentColumn = 1;
    layoutState.cursorY = startY;

    for (i = mid; i < items.length; i++) {
        cleanText = getBlockText(items[i].data || {});
        if (!cleanText || isPlaceholderText(cleanText)) {
            continue;
        }
        try {
            frame = flowDynamicText(
                layoutState,
                cleanText,
                registryEntry.style,
                DYNAMIC_LAYOUT.minTextFrameHeight,
                protoHeight
            );
            advanceLayoutCursor(layoutState, frame, spacing);
            populatedCount += 1;
        } catch (rightError) {
            warnings.push("Two-column group right item failed: " + rightError.message);
        }
    }
    rightBottom = layoutState.cursorY;

    layoutState.columnCount = savedColumnCount || 1;
    layoutState.currentColumn = savedColumn || 0;
    layoutState.cursorY = Math.max(leftBottom, rightBottom);
    appendRenderLog(
        "Two-column text group placed (" + items.length + " items, mid=" + mid + ")"
    );
}

function buildFrameStylesFromConfig(typographyConfig) {
    var styles = {};
    var mode = getTypographyMode(typographyConfig);
    var sourceMap = typographyConfig;
    var canonicalMap;
    var key;
    var resolved;
    
    if (!typographyConfig) {
        return null;
    }

    // Final stylesheet: one shared map for all pages.
    // page_type only affects layout (1-col vs 2-col), not typography.
    if (typographyConfig.STYLES) {
        sourceMap = typographyConfig.STYLES;
    } else if (typographyConfig.NON_OPENER_STYLES || typographyConfig.OPENER_STYLES) {
        sourceMap = typographyConfig.NON_OPENER_STYLES || typographyConfig.OPENER_STYLES;
    }

    canonicalMap = buildCanonicalStyleMap(sourceMap);
    
    for (key in canonicalMap) {
        if (canonicalMap.hasOwnProperty(key)) {
            resolved = resolveConfigStyle(canonicalMap[key]);
            if (resolved) {
                styles[key] = resolved;
            }
        }
    }

    for (key in FRAME_STYLES_DEFAULTS) {
        if (!FRAME_STYLES_DEFAULTS.hasOwnProperty(key) || styles[key]) {
            continue;
        }
        // Do not invent Theme-2-only styles when the active theme omits them.
        if (
            key === "numberedList" ||
            key === "subSectionHeading" ||
            key === "partNumber" ||
            key === "quotation" ||
            key === "table" ||
            key === "footer" ||
            key === "greenSubSectionTitle" ||
            key === "subTitlesList" ||
            key === "subTitle"
        ) {
            continue;
        }
        styles[key] = cloneFallbackStyle(key);
        appendRenderLog("  style " + key + " -> FALLBACK");
    }
    
    // Ensure list styles have proper indent
    if (styles.bulletList) {
        styles.bulletList.leftIndent = 12;
    }
    if (styles.numberedList) {
        styles.numberedList.leftIndent = 12;
    }

    styles.__mode = mode;
    appendRenderLog(
        "Typography from STYLES (layout page_type=" + (CURRENT_PAGE_TYPE || "opener") + ")"
    );
    
    return styles;
}

// -----------------------------------------------------------------------------
// Styling maps - defaults (will be overridden by typography config if available)
// -----------------------------------------------------------------------------
var FRAME_STYLES_DEFAULTS = {
    lessonNumber: { pointSize: 36, bold: false, italic: false, leftIndent: 0, color: [255, 255, 255], backgroundColor: "#CA5027" },
    lessonTitle: { pointSize: 44, bold: false, italic: false, leftIndent: 0, color: [33, 72, 128] },
    chapterOverview: { pointSize: 9, bold: true, italic: false, leftIndent: 0, color: [0, 116, 188] },
    chapterHeading: { pointSize: 36, bold: false, italic: false, leftIndent: 0, color: [255, 255, 255], backgroundColor: "#CA5027" },
    topic: { pointSize: 11, bold: true, italic: false, leftIndent: 0, color: [0, 0, 0] },
    text: { pointSize: 10, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    sectionTitle: { pointSize: 18, bold: true, italic: false, leftIndent: 0, color: [33, 72, 128] },
    imageCaption: { pointSize: 7.5, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    chapterNumber: { pointSize: 36, bold: false, italic: false, leftIndent: 0, color: [255, 255, 255], backgroundColor: "#CA5027" },
    chapterTitle: { pointSize: 22, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    lessonOverview: { pointSize: 9, bold: true, italic: false, leftIndent: 0, color: [0, 0, 0] },
    paragraphText: { pointSize: 10, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    learningObjectives: { pointSize: 15, bold: true, italic: false, leftIndent: 0, color: [202, 80, 39] },
    bulletList: { pointSize: 10, bold: false, italic: false, leftIndent: 12, color: [0, 0, 0] },
    numberedList: { pointSize: 10, bold: false, italic: false, leftIndent: 12, color: [0, 0, 0] },
    logoText: { pointSize: 10, bold: true, italic: false, leftIndent: 0, color: [0, 0, 0] },
    subSectionTitle: { pointSize: 10, bold: true, italic: false, leftIndent: 0, color: [0, 0, 0] },
    subSectionHeading: { font: "Arial", pointSize: 12, bold: false, italic: false, leftIndent: 0, color: [202, 80, 39] },
    figureCaption: { pointSize: 7.5, bold: false, italic: true, leftIndent: 0, color: [64, 64, 64] },
    imageFigureNumber: { pointSize: 7.5, bold: true, italic: false, leftIndent: 0, color: [195, 20, 39] },
    imageFigureText: { pointSize: 7.5, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    partNumber: { font: "Arial", pointSize: 24, bold: false, italic: false, leftIndent: 0, color: [255, 255, 255], backgroundColor: "#CA5027" },
    subTitlesList: {
        text: { font: "Arial", size: 11, color: "#000000", bold: false },
        number: { font: "Arial", size: 11, color: "#CA5027", bold: true }
    },
    greenSubSectionTitle: { font: "Arial", pointSize: 15, bold: true, italic: false, leftIndent: 0, color: [0, 133, 74] },
    subTitle: { font: "Arial", pointSize: 12, bold: false, italic: false, leftIndent: 0, color: [202, 80, 39] },
    quotation: {
        text: { font: "Arial", size: 13, color: "#000000", bold: false },
        author: { font: "Arial", size: 10, color: "#000000", bold: false },
        backgroundColor: "#C1D4C3"
    },
    table: {
        headingText: {
            font: "Arial",
            size: 13,
            color: "#FFFFFF",
            bold: true,
            backgroundColor: "#CA5027"
        },
        subHeadingText: {
            font: "Arial",
            size: 11,
            color: "#000000",
            bold: false,
            backgroundColor: "#E7B193"
        },
        rowsText: {
            font: "Arial",
            size: 9,
            color: "#000000",
            bold: false,
            backgroundColor: "#FFFFFF",
            altBackgroundColor: "#F9E5D9"
        }
    },
    footer: { fontFamily: "Arial", pointSize: 9, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] }
};

var FRAME_STYLES = FRAME_STYLES_DEFAULTS;

// Theme-level layout switches (theme JSON "OPTIONS"), e.g. Theme 1's wider
// left margin. Themes without an OPTIONS block keep the template defaults.
var THEME_OPTIONS = {};

// Extra left inset (points) added to the template's left margin for body
// content. Full-bleed opener images ignore it and stay at the page edge.
function getContentLeftInset() {
    var raw = THEME_OPTIONS ? THEME_OPTIONS.contentLeftInset : 0;
    var value = parseFloat(raw);

    if (isNaN(value) || value <= 0) {
        return 0;
    }
    return value;
}

// Background band behind the opener figure caption (theme 1). Empty = no band.
function getOpenerCaptionBackground() {
    var raw = THEME_OPTIONS ? THEME_OPTIONS.openerCaptionBackground : "";
    return trimString(String(raw || ""));
}

// Color block filling the left inset strip beside the opener image (theme 1).
function getOpenerImageInsetBackground() {
    var raw = THEME_OPTIONS ? THEME_OPTIONS.openerImageInsetBackground : "";
    return trimString(String(raw || ""));
}

var BLOCK_REGISTRY = {
    LessonNumber: {
        label: "lessonNumber",
        style: FRAME_STYLES.lessonNumber,
        kind: "text",
        prototype: "proto:lessonNumber",
        spacingAfter: 8
    },
    LessonTitle: {
        label: "lessonTitle",
        style: FRAME_STYLES.lessonTitle,
        kind: "text",
        prototype: "proto:lessonTitle",
        spacingAfter: 16
    },
    ChapterOverview: {
        label: "chapterOverview",
        style: FRAME_STYLES.chapterOverview,
        kind: "text",
        prototype: "proto:chapterOverview",
        spacingAfter: 8
    },
    Topic: {
        label: "topic",
        style: FRAME_STYLES.topic,
        kind: "text",
        prototype: "proto:topic",
        spacingAfter: 6
    },
    SectionTitle: {
        label: "sectionTitle",
        style: FRAME_STYLES.sectionTitle,
        kind: "text",
        prototype: "proto:sectionTitle",
        spacingAfter: 14
    },
    SubSectionTitle: {
        label: "subSectionTitle",
        style: FRAME_STYLES.subSectionTitle,
        kind: "text",
        prototype: "proto:subSectionTitle",
        spacingAfter: 10
    },
    SubSectionHeading: {
        label: "subSectionHeading",
        style: FRAME_STYLES.subSectionHeading,
        kind: "text",
        prototype: "proto:subSectionHeading",
        spacingAfter: 10
    },
    FigureCaption: {
        label: "figureCaption",
        style: FRAME_STYLES.figureCaption,
        kind: "text",
        prototype: "proto:figureCaption",
        spacingAfter: 12
    },
    Text: {
        label: "text",
        style: FRAME_STYLES.text,
        kind: "text",
        prototype: "proto:text",
        spacingAfter: 12
    },
    Image: {
        frameLabel: "imageFrame",
        captionLabel: "imageCaption",
        framePrototype: "proto:imageFrame",
        captionPrototype: "proto:imageCaption",
        style: FRAME_STYLES.imageCaption,
        kind: "image",
        spacingAfter: 12
    },
    ChapterNumber: {
        label: "chapterNumber",
        style: FRAME_STYLES.chapterNumber,
        kind: "text",
        prototype: "proto:chapterNumber",
        spacingAfter: 28
    },
    ChapterTitle: {
        label: "chapterTitle",
        style: FRAME_STYLES.chapterTitle,
        kind: "text",
        prototype: "proto:chapterTitle",
        spacingAfter: 36
    },
    LessonOverview: {
        label: "lessonOverview",
        style: FRAME_STYLES.lessonOverview,
        kind: "text",
        prototype: "proto:lessonOverview",
        // Match web heading margin (~1rem+) between LO items in 2-col opener grid.
        spacingAfter: 24,
        spacingBefore: 14
    },
    ParagraphText: {
        label: "paragraphText",
        style: FRAME_STYLES.paragraphText,
        kind: "text",
        prototype: "proto:paragraphText",
        spacingAfter: 12
    },
    LearningObjectives: {
        label: "learningObjectives",
        style: FRAME_STYLES.learningObjectives,
        kind: "text",
        prototype: "proto:learningObjectives",
        spacingAfter: 8
    },
    BulletList: {
        label: "bulletList",
        style: FRAME_STYLES.bulletList,
        kind: "text",
        prototype: "proto:bulletList",
        spacingAfter: 6
    },
    NumberedList: {
        label: "numberedList",
        style: FRAME_STYLES.numberedList,
        kind: "text",
        prototype: "proto:numberedList",
        spacingAfter: 6
    },
    LogoWithText: {
        frameLabel: "logoFrame",
        captionLabel: "logoText",
        framePrototype: "proto:logoFrame",
        captionPrototype: "proto:logoText",
        style: FRAME_STYLES.logoText,
        kind: "logo",
        spacingAfter: 14
    },
    PartNumber: {
        label: "partNumber",
        style: FRAME_STYLES.partNumber,
        kind: "text",
        prototype: "proto:partNumber",
        spacingAfter: 8
    },
    SubTitlesList: {
        label: "subTitlesList",
        style: FRAME_STYLES.subTitlesList,
        kind: "text",
        prototype: "proto:subTitlesList",
        spacingAfter: 6
    },
    GreenSubSectionTitle: {
        label: "greenSubSectionTitle",
        style: FRAME_STYLES.greenSubSectionTitle,
        kind: "text",
        prototype: "proto:greenSubSectionTitle",
        spacingAfter: 10
    },
    SubTitle: {
        label: "subTitle",
        style: FRAME_STYLES.subTitle,
        kind: "text",
        prototype: "proto:subTitle",
        spacingAfter: 8
    },
    Quotation: {
        label: "quotation",
        style: FRAME_STYLES.quotation,
        kind: "quotation",
        spacingAfter: 6
    },
    Table: {
        label: "table",
        style: FRAME_STYLES.table,
        kind: "table",
        spacingAfter: 14
    },
    Footer: {
        label: "footer",
        style: FRAME_STYLES.footer,
        kind: "footer",
        spacingAfter: 0
    }
};

var warnings = [];
var populatedCount = 0;
var usedLabels = {};
var renderLogEntries = [];

function appendRenderLog(line) {
    renderLogEntries.push(String(line));
}

function markLabelUsed(labelName) {
    var label = trimString(labelName || "");
    if (label) {
        usedLabels[label] = true;
    }
}

function buildTextFrameLabel(labelPrefix, blockIndex) {
    return labelPrefix + blockIndex;
}

function getBlockTypeCount(typeCounts, itemType) {
    if (!typeCounts[itemType]) {
        typeCounts[itemType] = 0;
    }
    typeCounts[itemType] += 1;
    return typeCounts[itemType];
}

function logUnsupportedBlockType(itemType) {
    appendRenderLog("---");
    appendRenderLog("JSON block type: " + itemType);
    appendRenderLog("Resolved Script Label: (unsupported)");
    appendRenderLog("Status: not populated — unsupported block type");
    warnings.push('Skipped unknown block type: "' + itemType + '".');
}

function populateTextBlock(document, registryEntry, itemType, data, blockIndex) {
    var frameLabel = buildTextFrameLabel(registryEntry.label, blockIndex);
    var text = data.text || "";

    populateFrame(document, frameLabel, text, registryEntry.style, itemType);
}

function populateImageBlock(document, registryEntry, data, blockIndex, scriptFolder) {
    var frameLabel = buildTextFrameLabel(registryEntry.frameLabel, blockIndex);
    var captionLabel = buildTextFrameLabel(registryEntry.captionLabel, blockIndex);

    placeImageInFrame(document, frameLabel, data.url, scriptFolder, blockIndex, "Image");
    populateFrame(document, captionLabel, data.caption, registryEntry.style, "ImageCaption");
}

// -----------------------------------------------------------------------------
// Frame lookup helpers
// -----------------------------------------------------------------------------
function getItemLabel(item) {
    try {
        return item.label;
    } catch (e) {
        return "";
    }
}

function findTextFrameByLabel(document, labelName) {
    var i;
    var itemLabel;
    var targetLabel = trimString(labelName);

    for (i = 0; i < document.textFrames.length; i++) {
        itemLabel = trimString(getItemLabel(document.textFrames[i]));
        if (itemLabel === targetLabel) {
            return document.textFrames[i];
        }
    }
    return null;
}

function clearGraphicsFromFrame(frame) {
    try {
        if (frame.graphics && frame.graphics.length > 0) {
            frame.graphics.everyItem().remove();
        }
    } catch (removeError) {
        try {
            while (frame.graphics.length > 0) {
                frame.graphics[0].remove();
            }
        } catch (loopError) {}
    }
}

function clearLabeledImageFrames(document) {
    var i;
    var item;
    var label;
    var allItems = document.allPageItems;

    for (i = 0; i < allItems.length; i++) {
        item = allItems[i];
        label = trimString(getItemLabel(item));
        if (!label) {
            continue;
        }

        try {
            if (typeof item.place !== "function") {
                continue;
            }
        } catch (placeCheckError) {
            continue;
        }

        clearGraphicsFromFrame(item);
    }
}

function prepareTemplateForJson(document) {
    var i;
    var frame;
    var label;
    var clearedStories = {};
    var story;
    var storyId;

    for (i = 0; i < document.textFrames.length; i++) {
        frame = document.textFrames[i];
        label = trimString(getItemLabel(frame));
        if (!label) {
            continue;
        }

        try {
            frame.contents = "";
        } catch (clearFrameError) {}

        story = frame.parentStory;
        if (!story) {
            continue;
        }

        try {
            storyId = story.id;
        } catch (idError) {
            storyId = "story-" + i;
        }

        if (!clearedStories[storyId]) {
            try {
                story.contents = "";
            } catch (clearStoryError) {}
            clearedStories[storyId] = true;
        }
    }

    clearLabeledImageFrames(document);
}

function fitTextFrameToContent(textFrame) {
    try {
        textFrame.fit(FitOptions.FRAME_TO_CONTENT);
        return;
    } catch (fitErrorA) {}

    try {
        textFrame.fit(FitOptions.frameToContent);
    } catch (fitErrorB) {}
}

function collapseUnusedLabeledFrames(document) {
    var i;
    var item;
    var label;
    var frame;
    var allItems = document.allPageItems;

    for (i = 0; i < document.textFrames.length; i++) {
        frame = document.textFrames[i];
        label = trimString(getItemLabel(frame));
        if (!label || usedLabels[label]) {
            continue;
        }

        try {
            frame.contents = "";
        } catch (clearFrameError) {}
        fitTextFrameToContent(frame);
    }

    for (i = 0; i < allItems.length; i++) {
        item = allItems[i];
        label = trimString(getItemLabel(item));
        if (!label || usedLabels[label]) {
            continue;
        }

        try {
            if (typeof item.place !== "function") {
                continue;
            }
        } catch (placeCheckError) {
            continue;
        }

        clearGraphicsFromFrame(item);
    }
}

function pageHasContentLayerContent(page) {
    var items;
    var i;
    var item;
    var label;

    try {
        items = page.pageItems;
    } catch (pageItemsError) {
        return false;
    }

    for (i = 0; i < items.length; i++) {
        item = items[i];
        label = trimString(getItemLabel(item));
        if (isPrototypeLabel(label)) {
            continue;
        }
        if (itemHasVisibleContent(item)) {
            return true;
        }
    }

    return false;
}

function itemHasVisibleContent(item) {
    try {
        if (item.overflows === true) {
            return true;
        }
    } catch (overflowFlagError) {}

    try {
        if (item.nextTextFrame || item.previousTextFrame) {
            return true;
        }
    } catch (threadFlagError) {}

    try {
        if (item.contents !== undefined && trimString(String(item.contents)) !== "") {
            return true;
        }
    } catch (contentsError) {}

    try {
        if (item.graphics && item.graphics.length > 0) {
            return true;
        }
    } catch (graphicsError) {}

    return false;
}

function pageHasVisibleContent(page) {
    return pageHasContentLayerContent(page);
}

function removeAllRuntimeContent(document) {
    var i;
    var item;
    var label;
    var toRemove = [];

    for (i = 0; i < document.allPageItems.length; i++) {
        item = document.allPageItems[i];
        label = trimString(getItemLabel(item));
        if (isPrototypeLabel(label)) {
            continue;
        }
        toRemove.push(item);
    }

    for (i = toRemove.length - 1; i >= 0; i--) {
        try {
            toRemove[i].remove();
        } catch (removeError) {}
    }
}

function removeAllEmptyPages(document) {
    var i;
    var page;
    var removed;

    do {
        removed = false;
        for (i = document.pages.length - 1; i >= 0; i--) {
            if (document.pages.length <= 1) {
                break;
            }
            page = document.pages[i];
            if (!pageHasContentLayerContent(page)) {
                page.remove();
                removed = true;
            }
        }
    } while (removed);
}

function removeTrailingEmptyPages(document) {
    var lastPage;

    while (document.pages.length > 1) {
        lastPage = document.pages[document.pages.length - 1];
        if (pageHasVisibleContent(lastPage)) {
            break;
        }
        lastPage.remove();
    }
}

function removeInteriorEmptyPages(document) {
    removeAllEmptyPages(document);
}

function setPrototypesLayerNonPrinting(document) {
    var i;
    var layer;

    for (i = 0; i < document.layers.length; i++) {
        layer = document.layers[i];
        try {
            if (layer.name === "Prototypes") {
                layer.printable = false;
            }
        } catch (layerError) {}
    }
}

function findPlaceableFrameByLabel(document, labelName) {
    var i;
    var item;
    var itemLabel;
    var targetLabel = trimString(labelName);
    var allItems = document.allPageItems;

    for (i = 0; i < allItems.length; i++) {
        item = allItems[i];
        itemLabel = trimString(getItemLabel(item));

        if (itemLabel !== targetLabel) {
            continue;
        }

        try {
            if (typeof item.place === "function") {
                return item;
            }
        } catch (placeCheckError) {}
    }

    return null;
}

// -----------------------------------------------------------------------------
// Image helpers
// -----------------------------------------------------------------------------
function padImageIndex(number) {
    var numStr = String(number);
    while (numStr.length < 4) {
        numStr = "0" + numStr;
    }
    return numStr;
}

function resolveImageFile(urlOrPath, scriptFolder, imageIndex) {
    var normalized = String(urlOrPath || "").replace(/\\/g, "/");
    var parts;
    var fileName;
    var candidate;
    var candidates = [];
    var indexedBase;
    var i;

    if (!normalized) {
        return null;
    }

    candidates.push(normalized);
    candidates.push(scriptFolder + "/" + normalized);
    candidates.push(scriptFolder + "/assets/" + normalized);

    parts = normalized.split("/");
    fileName = parts[parts.length - 1];
    if (fileName) {
        candidates.push(scriptFolder + "/assets/" + fileName);
    }

    if (imageIndex && imageIndex > 0) {
        indexedBase = "img_" + padImageIndex(imageIndex);
        candidates.push(scriptFolder + "/assets/" + indexedBase + ".png");
        candidates.push(scriptFolder + "/assets/" + indexedBase + ".jpg");
        candidates.push(scriptFolder + "/assets/" + indexedBase + ".jpeg");
    }

    for (i = 0; i < candidates.length; i++) {
        candidate = File(candidates[i]);
        if (candidate.exists) {
            return candidate;
        }
    }

    return null;
}

function fitFrameToContent(frame) {
    try {
        frame.fit(FitOptions.PROPORTIONALLY);
        return;
    } catch (fitErrorA) {}

    try {
        frame.fit(FitOptions.proportionally);
    } catch (fitErrorB) {}
}

function logImagePlacementDiagnostics(frame, contextLabel) {
    var bounds;
    var graphic;
    var graphicBounds;
    var i;
    var layerName = "(unknown)";

    appendRenderLog("Image diagnostics: " + contextLabel);

    try {
        bounds = frame.geometricBounds;
        appendRenderLog(
            "  frame geometricBounds: [" +
            bounds[0] + ", " + bounds[1] + ", " +
            bounds[2] + ", " + bounds[3] + "]"
        );
    } catch (frameBoundsError) {
        appendRenderLog("  frame geometricBounds: (unavailable)");
    }

    try {
        appendRenderLog("  graphics.length: " + frame.graphics.length);
        for (i = 0; i < frame.graphics.length; i++) {
            graphic = frame.graphics[i];
            graphicBounds = graphic.geometricBounds;
            appendRenderLog(
                "  graphic[" + i + "] geometricBounds: [" +
                graphicBounds[0] + ", " + graphicBounds[1] + ", " +
                graphicBounds[2] + ", " + graphicBounds[3] + "]"
            );
            appendRenderLog("  graphic[" + i + "] horizontalScale: " + graphic.horizontalScale);
            appendRenderLog("  graphic[" + i + "] verticalScale: " + graphic.verticalScale);
            appendRenderLog("  graphic[" + i + "] rotationAngle: " + graphic.rotationAngle);
            appendRenderLog("  graphic[" + i + "] absoluteHorizontalScale: " + graphic.absoluteHorizontalScale);
            appendRenderLog("  graphic[" + i + "] absoluteVerticalScale: " + graphic.absoluteVerticalScale);
        }
    } catch (graphicsError) {
        appendRenderLog("  graphics.length: 0");
    }

    try {
        layerName = frame.itemLayer.name;
    } catch (layerError) {}
    appendRenderLog("  frame layer: " + layerName);

    try {
        appendRenderLog("  frame visible: " + frame.visible);
    } catch (visibleError) {}
}

function ensureGraphicFrameVisible(frame) {
    assignFrameToContentLayer(frame);

    try {
        if (contentLayer) {
            contentLayer.visible = true;
            contentLayer.printable = true;
            frame.itemLayer = contentLayer;
        }
    } catch (layerError) {}

    try {
        frame.visible = true;
    } catch (visibleError) {}

    try {
        frame.locked = false;
    } catch (lockError) {}

    try {
        frame.bringToFront();
    } catch (zOrderError) {}
}

/**
 * Normalize JSON scale_percent (50, "50", "50%", 0.5) to a 1-100 percentage.
 * Returns 100 when absent/invalid so existing content keeps full column width.
 */
function normalizeScalePercent(value) {
    var raw;
    var num;

    if (value === undefined || value === null || value === "") {
        return 100;
    }

    raw = trimString(String(value)).replace(/%/g, "");
    num = parseFloat(raw);

    if (isNaN(num) || num <= 0) {
        return 100;
    }

    // Fractional form (0.5 => 50%).
    if (num > 0 && num <= 1) {
        num = num * 100;
    }

    if (num < 5) num = 5;
    if (num > 100) num = 100;

    return num;
}

function readJsonScalePercent(data) {
    if (!data) {
        return undefined;
    }
    if (data.scale_percent !== undefined && data.scale_percent !== null && data.scale_percent !== "") {
        return data.scale_percent;
    }
    if (data.scalePercent !== undefined && data.scalePercent !== null && data.scalePercent !== "") {
        return data.scalePercent;
    }
    if (data.scale !== undefined && data.scale !== null && data.scale !== "") {
        return data.scale;
    }
    return undefined;
}

/**
 * Format sheet columns=2 → always 100% (ignore JSON).
 * Otherwise use data.scale_percent as a percentage of column width (e.g. 73.9 → 73.9%).
 * If the format sheet is missing, do not assume 2-col — still use JSON.
 */
function normalizeColumnFormatToken(value) {
    var raw = trimString(String(value == null ? "" : value)).toLowerCase();
    raw = raw.replace(/[\s_-]+/g, "");
    if (!raw) return 0;
    if (raw === "column2" || raw === "columns2" || raw === "2column" || raw === "twocolumn" || raw === "2cols" || raw === "columns2") {
        return 2;
    }
    if (raw === "column1" || raw === "columns1" || raw === "1column" || raw === "onecolumn" || raw === "1col" || raw === "columns1") {
        return 1;
    }
    if (Number(raw) === 2) return 2;
    if (Number(raw) === 1) return 1;
    return 0;
}

/**
 * Resolve an EXPLICIT image/component format only.
 *
 * IMPORTANT:
 * A page being two-column does NOT mean the image is a column2 image.
 * Page columns and image format are separate concepts.
 *
 * Returns 2/1 when an explicit image/component format is known, otherwise 0.
 */
/**
 * Image scale:
 *   - 2-column format pages: always 100% of the current column (ignore JSON).
 *   - 1-column pages: JSON scale_percent (unchanged; this path is working).
 */
function resolveImageScalePercent(data, layoutState) {
    var raw = readJsonScalePercent(data);
    var pageType = (layoutState && layoutState.pageType) || CURRENT_PAGE_TYPE || "opener";
    var pageColumns = 1;

    if (layoutState && Number(layoutState.columnCount) === 2) {
        pageColumns = 2;
    } else {
        pageColumns = resolvePageColumnCount(pageType, LAYOUT_FORMAT);
    }

    if (pageColumns === 2) {
        return {
            scalePercent: 100,
            fromJson: false,
            formatColumns: 2,
            jsonValue: raw,
            scaleReason: "format columns=2; JSON ignored, 100% of current column"
        };
    }

    return {
        scalePercent: normalizeScalePercent(raw),
        fromJson: raw !== undefined,
        formatColumns: 1,
        jsonValue: raw,
        scaleReason: raw !== undefined
            ? "tree_output.json scale_percent (authoritative)"
            : "JSON scale_percent missing/invalid; default 100% of current column"
    };
}


function readBinaryUInt16BE(binary, offset) {
    return (binary.charCodeAt(offset) << 8) | binary.charCodeAt(offset + 1);
}

function readBinaryUInt32BE(binary, offset) {
    return (
        binary.charCodeAt(offset) * 16777216 +
        binary.charCodeAt(offset + 1) * 65536 +
        binary.charCodeAt(offset + 2) * 256 +
        binary.charCodeAt(offset + 3)
    );
}

/*
 * Read the source image dimensions directly from the linked file.
 * This avoids using a cropped/fit graphic's geometricBounds to infer the
 * source aspect ratio.
 */
function getSourceImageAspectRatio(imageFile) {
    var name;
    var ext;
    var file;
    var binary;
    var length;
    var i;
    var marker;
    var markerCode;
    var segmentLength;
    var width;
    var height;

    if (!imageFile || !imageFile.exists) {
        return 0;
    }

    name = String(imageFile.name || "").toLowerCase();
    ext = "";
    if (name.lastIndexOf(".") >= 0) {
        ext = name.substring(name.lastIndexOf(".") + 1);
    }

    try {
        file = new File(imageFile.fsName);
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return 0;
        }

        binary = file.read();
        file.close();

        length = binary.length;

        // PNG signature + IHDR dimensions.
        if (ext === "png" &&
            length >= 24 &&
            binary.charCodeAt(0) === 0x89 &&
            binary.charCodeAt(1) === 0x50 &&
            binary.charCodeAt(2) === 0x4E &&
            binary.charCodeAt(3) === 0x47) {
            width = readBinaryUInt32BE(binary, 16);
            height = readBinaryUInt32BE(binary, 20);
            if (width > 0 && height > 0) {
                return height / width;
            }
        }

        // JPEG SOF marker scan.
        if (ext === "jpg" || ext === "jpeg" || ext === "jpe") {
            i = 2;
            while (i + 9 < length) {
                if (binary.charCodeAt(i) !== 0xFF) {
                    i++;
                    continue;
                }

                markerCode = binary.charCodeAt(i + 1);

                // Skip fill bytes.
                if (markerCode === 0xFF) {
                    i++;
                    continue;
                }

                // Standalone JPEG markers.
                if (markerCode === 0xD8 || markerCode === 0xD9 ||
                    (markerCode >= 0xD0 && markerCode <= 0xD7) ||
                    markerCode === 0x01) {
                    i += 2;
                    continue;
                }

                if (i + 3 >= length) {
                    break;
                }

                segmentLength = readBinaryUInt16BE(binary, i + 2);
                if (segmentLength < 2 || i + 2 + segmentLength > length) {
                    break;
                }

                // SOF0..SOF3, SOF5..SOF7, SOF9..SOFB, SOFD..SOFF.
                if ((markerCode >= 0xC0 && markerCode <= 0xC3) ||
                    (markerCode >= 0xC5 && markerCode <= 0xC7) ||
                    (markerCode >= 0xC9 && markerCode <= 0xCB) ||
                    (markerCode >= 0xCD && markerCode <= 0xCF)) {
                    height = readBinaryUInt16BE(binary, i + 5);
                    width = readBinaryUInt16BE(binary, i + 7);
                    if (width > 0 && height > 0) {
                        return height / width;
                    }
                }

                i += 2 + segmentLength;
            }
        }
    } catch (dimensionError) {
        try {
            if (file && file.isOpen) {
                file.close();
            }
        } catch (closeError) {}
    }

    return 0;
}

function fitPlacedImageInFrame(frame, savedBounds, scalePercent, imageFile) {
    var graphic;
    var imageBounds;
    var imageWidth;
    var imageHeight;
    var ratio;
    var pageBounds;
    var contentWidth;
    var availableHeight;
    var baseWidth;
    var baseHeight;
    var scale;
    var targetWidth;
    var targetHeight;
    var targetLeft;
    var targetTop;
    var maxBottom;
    var fitRatio;
    var fittedBounds;
    var fittedWidth;
    var resizeFactor;

    try {
        graphic = frame.graphics[0];
        if (!graphic) {
            throw new Error("graphic unavailable");
        }

        /*
         * IMPORTANT:
         * scale_percent is a UNIFORM image scale. We first establish the
         * image's 100% size inside the available page content area, preserving
         * its real aspect ratio. Then the JSON percentage is applied to BOTH
         * width and height.
         *
         * This prevents tall portrait images (such as Figure 1.7) from being
         * made 73.8% of the entire page width and becoming unnecessarily tall.
         */
        try {
            frame.fit(FitOptions.PROPORTIONALLY);
        } catch (fitError) {}

        imageBounds = graphic.geometricBounds;
        imageWidth = imageBounds[3] - imageBounds[1];
        imageHeight = imageBounds[2] - imageBounds[0];

        if (!(imageWidth > 0) || !(imageHeight > 0)) {
            throw new Error("graphic bounds unavailable");
        }

        ratio = getSourceImageAspectRatio(imageFile);
        if (!(ratio > 0)) {
            ratio = imageHeight / imageWidth;
        }

        scale = normalizeScalePercent(scalePercent);

        // 2-column: fill the column frame (savedBounds). Do not use JSON % or page width.
        if (scale >= 99.5 && savedBounds && savedBounds.length === 4) {
            targetLeft = savedBounds[1];
            targetTop = savedBounds[0];
            targetWidth = savedBounds[3] - savedBounds[1];
            targetHeight = targetWidth * ratio;
            frame.geometricBounds = [
                targetTop,
                targetLeft,
                targetTop + targetHeight,
                targetLeft + targetWidth
            ];
            try {
                frame.fit(FitOptions.PROPORTIONALLY);
            } catch (columnFitError) {}
            try {
                frame.fit(FitOptions.CENTER_CONTENT);
            } catch (columnCenterError) {}
            appendRenderLog(
                "Dynamic image resize => scale=100% of column width=" +
                targetWidth +
                " height=" +
                targetHeight
            );
            return "dynamic-image-sizing";
        }

        pageBounds = getFullPageMarginBounds(frame.parentPage);
        contentWidth = pageBounds.right - pageBounds.left;
        availableHeight = pageBounds.bottom - frame.geometricBounds[0];

        if (!(contentWidth > 0)) {
            throw new Error("page content width unavailable");
        }

        if (!(availableHeight > 0)) {
            availableHeight = pageBounds.bottom - pageBounds.top;
        }

        /*
         * Establish a 100% reference size that fits the complete image inside
         * the available content rectangle. This gives us a reliable width AND
         * height base for the percentage.
         */
        baseWidth = contentWidth;
        baseHeight = baseWidth * ratio;

        if (baseHeight > availableHeight) {
            fitRatio = availableHeight / baseHeight;
            baseWidth = baseWidth * fitRatio;
            baseHeight = availableHeight;
        }

        scale = normalizeScalePercent(scalePercent);

        targetWidth = baseWidth * (scale / 100);
        targetHeight = baseHeight * (scale / 100);

        targetLeft = pageBounds.left + (contentWidth - targetWidth) / 2;
        targetTop = frame.geometricBounds[0];

        maxBottom = pageBounds.bottom;
        if (targetTop + targetHeight > maxBottom) {
            targetTop = Math.max(pageBounds.top, maxBottom - targetHeight);
        }

        frame.geometricBounds = [
            targetTop,
            targetLeft,
            targetTop + targetHeight,
            targetLeft + targetWidth
        ];

        /*
         * Fit the placed graphic to the final proportional frame. The frame
         * dimensions are already the final width AND height, so InDesign
         * cannot stretch the image in one direction.
         */
        try {
            frame.fit(FitOptions.FILL_PROPORTIONALLY);
        } catch (fillError) {
            try {
                frame.fit(FitOptions.PROPORTIONALLY);
            } catch (proportionalError) {}
        }

        /*
         * Center content without changing the frame dimensions.
         */
        try {
            frame.fit(FitOptions.CENTER_CONTENT);
        } catch (centerError) {}

        fittedBounds = graphic.geometricBounds;
        fittedWidth = fittedBounds[3] - fittedBounds[1];

        appendRenderLog(
            "Dynamic image resize => scale=" +
            scale +
            "% uniform-image-scale" +
            " baseWidth=" + baseWidth +
            " baseHeight=" + baseHeight +
            " targetWidth=" + targetWidth +
            " targetHeight=" + targetHeight
        );
        appendRenderLog(
            "Dynamic image scale source => " +
            (scale === 100
                ? "100%/fit-to-available-content"
                : "JSON scale_percent applied uniformly to width+height")
        );
        appendRenderLog(
            "Dynamic image final frame => [" +
            targetTop + "," + targetLeft + "," +
            (targetTop + targetHeight) + "," +
            (targetLeft + targetWidth) + "]"
        );
    } catch (error) {
        appendRenderLog("Dynamic image sizing failed : " + error);
        try {
            frame.fit(FitOptions.PROPORTIONALLY);
        } catch (e) {}
    }

    return "dynamic-image-sizing";
}

function placeImageContentInFrame(frame, imageFile, scalePercent) {
    var savedBounds;
    var graphicsCount = 0;
    var fittingResult;

    savedBounds = frame.geometricBounds;
    try {
        frame.frameFittingOptions.autoFit = false;
    } catch (autoFitError) {}
    clearGraphicsFromFrame(frame);
    frame.place(imageFile);

    try {
        graphicsCount = frame.graphics.length;
    } catch (graphicsCountError) {}

    appendRenderLog("Image graphics after place: " + graphicsCount);

    if (graphicsCount < 1) {
        warnings.push('Image place completed but frame has no graphics for "' + imageFile.fsName + '".');
        appendRenderLog("Image fitting result: skipped (no graphic)");
        logImagePlacementDiagnostics(frame, "after place (no graphic)");
        return false;
    }

    logImagePlacementDiagnostics(frame, "after place (before fit)");

    fittingResult = fitPlacedImageInFrame(frame, savedBounds, scalePercent, imageFile);
    appendRenderLog("Image fitting result: " + fittingResult);

    ensureGraphicFrameVisible(frame);
    clearImageFrameStroke(frame);
    logImagePlacementDiagnostics(frame, "after fit");

    try {
        if (frame.graphics.length < 1) {
            warnings.push("Image graphic missing after fitting for \"" + imageFile.fsName + "\".");
            return false;
        }
    } catch (postFitGraphicsError) {
        return false;
    }

    return true;
}

function placeImageInFrame(document, labelName, urlOrPath, scriptFolder, imageIndex, blockType) {
    var frame;
    var imageFile;
    var itemType = blockType || "Image";

    appendRenderLog("---");
    appendRenderLog("JSON block type: " + itemType);
    appendRenderLog("Resolved Script Label: " + labelName);
    appendRenderLog("Image path: " + (urlOrPath ? urlOrPath : "(empty)"));

    if (!urlOrPath) {
        appendRenderLog("Frame found: n/a");
        appendRenderLog("Status: not populated — empty image url in JSON");
        return;
    }

    frame = findPlaceableFrameByLabel(document, labelName);
    if (frame === null) {
        appendRenderLog("Frame found: no");
        appendRenderLog("Status: not populated — graphic frame not found in template");
        warnings.push('Skipped "' + labelName + '": graphic frame not found.');
        return;
    }

    appendRenderLog("Frame found: yes");

    imageFile = resolveImageFile(urlOrPath, scriptFolder, imageIndex);
    if (imageFile === null) {
        appendRenderLog("Status: not populated — image file not found on disk");
        warnings.push('Image file not found for "' + urlOrPath + '".');
        return;
    }

    try {
        if (!placeImageContentInFrame(frame, imageFile)) {
            appendRenderLog("Status: not populated — graphic not visible after place/fit");
            return;
        }
        markLabelUsed(labelName);
        populatedCount += 1;
        appendRenderLog("Resolved image file: " + imageFile.fsName);
        appendRenderLog("Status: populated");
    } catch (placeError) {
        appendRenderLog("Status: not populated — " + placeError.message);
        warnings.push('Could not place image "' + imageFile.fsName + '": ' + placeError.message);
    }
}

// -----------------------------------------------------------------------------
// Text style helpers
// -----------------------------------------------------------------------------
function ensureDocumentColor(document, colorName, rgb) {
    var color;
    try {
        color = document.colors.itemByName(colorName);
        color.name;
        return color;
    } catch (missingColor) {}

    try {
        color = document.colors.add({
            name: colorName,
            model: ColorModel.process,
            space: ColorSpace.RGB,
            colorValue: rgb
        });
        return color;
    } catch (addError) {
        return null;
    }
}

function applyTextColor(textRange, style) {
    var color;
    var colorName;
    var doc;

    if (!textRange || !style || !style.color) return;

    try {
        doc = app.activeDocument;
        colorName = "JSON_" + style.color[0] + "_" + style.color[1] + "_" + style.color[2];
        color = ensureDocumentColor(doc, colorName, style.color);
        if (color !== null) {
            textRange.fillColor = color;
        }
    } catch (colorError) {
        warnings.push("Could not apply text color.");
    }
}

function getFontBaseName(family) {
    var trimmed = trimString(family || "");

    if (!trimmed) {
        return "";
    }

    return trimmed.replace(
        /\s+(Medium|Regular|Bold|Light|Book|Roman|Black|Heavy|Thin|SemiBold|Semi\s*Bold|Demi\s*Bold|Oblique|Condensed)$/i,
        ""
    );
}

function getEmbeddedFontWeight(family) {
    var trimmed = trimString(family || "");
    var match = trimmed.match(
        /\s+(Medium|Regular|Bold|Light|Book|Roman|Black|Heavy|Thin|SemiBold|Semi\s*Bold|Demi\s*Bold|Condensed)$/i
    );

    return match ? match[1] : "";
}

function normalizeFontToken(value) {
    return trimString(value || "").toLowerCase().replace(/[\s\-_]+/g, "");
}

function buildFontCandidateNames(style) {
    var family = trimString(style.fontFamily || style.font || "");
    var baseName = getFontBaseName(family);
    var embedded = getEmbeddedFontWeight(family);
    var styleNames = getFontStyleCandidates(
        isTruthyFlag(style.bold),
        isTruthyFlag(style.italic)
    );
    var results = [];
    var seen = {};
    var i;

    function pushCandidate(name) {
        if (!name || seen[name]) {
            return;
        }
        seen[name] = true;
        results.push(name);
    }

    pushCandidate(family);

    if (embedded && baseName) {
        pushCandidate(baseName + "\t" + embedded);
        pushCandidate(baseName + " " + embedded);
    }

    for (i = 0; i < styleNames.length; i++) {
        if (baseName) {
            pushCandidate(baseName + "\t" + styleNames[i]);
            pushCandidate(baseName + " " + styleNames[i]);
        }
        if (family && family !== baseName) {
            pushCandidate(family + "\t" + styleNames[i]);
        }
    }

    pushCandidate(baseName);

    return results;
}

function describeAppliedFont(textRange) {
    var font;

    try {
        font = textRange.appliedFont;
        if (!font) {
            return "(none)";
        }
        return (font.fontFamily || font.name || "(unknown)") +
            " / " + (font.fontStyle || font.name || "");
    } catch (describeError) {
        try {
            return String(textRange.fontFamily || "(unknown)") + " / " +
                String(textRange.fontStyle || "");
        } catch (fallbackDescribeError) {
            return "(unknown)";
        }
    }
}

function findInstalledFont(style) {
    var candidates = buildFontCandidateNames(style);
    var i;
    var font;
    var target;
    var j;
    var fonts;
    var normName;
    var wantBold = isTruthyFlag(style.bold);
    var wantItalic = isTruthyFlag(style.italic);
    var family = trimString(style.fontFamily || style.font || "");
    var baseName = getFontBaseName(family);
    var bestMatch = null;
    var bestScore = -1;
    var score;
    var normFamily;
    var normStyle;

    for (i = 0; i < candidates.length; i++) {
        try {
            font = app.fonts.item(candidates[i]);
            if (font) {
                return { font: font, name: candidates[i] };
            }
        } catch (candidateError) {}
    }

    target = normalizeFontToken(baseName || family);
    if (!target) {
        return null;
    }

    try {
        fonts = app.fonts;
    } catch (fontsError) {
        return null;
    }

    for (j = 0; j < fonts.length; j++) {
        font = fonts[j];
        try {
            normFamily = normalizeFontToken(font.fontFamily);
            normName = normalizeFontToken(font.name);
            normStyle = normalizeFontToken(font.fontStyle);
            score = 0;

            if (normFamily === target || normName === target) {
                score += 10;
            } else if (normName.indexOf(target) === 0 || normFamily.indexOf(target) === 0) {
                score += 6;
            } else {
                continue;
            }

            if (wantBold && (normStyle.indexOf("bold") >= 0 || normName.indexOf("bold") >= 0)) {
                score += 4;
            } else if (!wantBold && normStyle.indexOf("bold") < 0 && normName.indexOf("bold") < 0) {
                score += 2;
            }

            if (wantItalic && (normStyle.indexOf("italic") >= 0 || normStyle.indexOf("oblique") >= 0)) {
                score += 2;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = { font: font, name: font.name };
            }
        } catch (scanError) {}
    }

    return bestMatch;
}

function prepareStoryForDirectFormatting(story) {
    var doc;
    var basicStyle;
    var noneCharacterStyle;

    if (!story) {
        return;
    }

    try {
        doc = story.parent;
        basicStyle = doc.paragraphStyles.itemByPath("[Basic Paragraph]");
        story.paragraphs.everyItem().appliedParagraphStyle = basicStyle;
    } catch (basicStyleError) {
        try {
            story.paragraphs.everyItem().appliedParagraphStyle = story.parent.paragraphStyles[0];
        } catch (fallbackParagraphStyleError) {}
    }

    try {
        noneCharacterStyle = story.parent.characterStyles.itemByPath("[None]");
        story.characters.everyItem().appliedCharacterStyle = noneCharacterStyle;
    } catch (noneCharacterStyleError) {}

    try {
        story.paragraphs.everyItem().clearOverrides(OverrideType.ALL);
    } catch (clearOverridesError) {}
}

function logAppliedFontVerification(textRange, style, contextLabel) {
    var requested = trimString(style.fontFamily || style.font || "(default)");
    var actual = describeAppliedFont(textRange);
    var label = contextLabel || "font";

    appendRenderLog(
        "Resolved " + label + ": requested=\"" + requested + "\" actual=\"" + actual + "\""
    );

    if (requested && requested !== "(default)" &&
        actual.toLowerCase().indexOf("minion") >= 0 &&
        requested.toLowerCase().indexOf("minion") < 0) {
        warnings.push(
            'Font mismatch for "' + requested + '": PDF text may render as "' + actual + '".'
        );
    }
}

function getFontStyleCandidates(bold, italic) {
    if (bold && italic) {
        return [
            "Bold Italic",
            "BoldItalic",
            "Bold Oblique",
            "BoldIt",
            "Demi Bold Italic",
            "Heavy Italic",
            "Black Italic"
        ];
    }
    if (bold) {
        return [
            "Bold",
            "Heavy",
            "Black",
            "Extra Bold",
            "ExtraBold",
            "Semibold",
            "SemiBold",
            "Demi Bold",
            "DemiBold",
            "Medium",
            "Bold Condensed"
        ];
    }
    if (italic) {
        return ["Italic", "Oblique", "It", "Slanted"];
    }
    return ["Regular", "Roman", "Book", "Normal", "Light", "Plain"];
}

function applyFontStyleSafe(textRange, bold, italic) {
    var candidates = getFontStyleCandidates(bold, italic);
    var i;
    var family;
    var styleName;

    for (i = 0; i < candidates.length; i++) {
        try {
            textRange.fontStyle = candidates[i];
            return true;
        } catch (styleError) {}
    }

    try {
        family = textRange.fontFamily || textRange.appliedFont.fontFamily;
    } catch (familyError) {
        return false;
    }

    for (i = 0; i < candidates.length; i++) {
        try {
            styleName = family + "\t" + candidates[i];
            textRange.appliedFont = app.fonts.item(styleName);
            return true;
        } catch (fontError) {}
    }

    return false;
}

/**
 * Generic theme font + bold/italic for ANY block (frames or character ranges).
 * Matches web: if theme says bold/italic, PDF must show it — not component-specific.
 */
function applyThemeFontAndEmphasis(textRange, style) {
    var family;
    var wantBold;
    var wantItalic;
    var candidates;
    var i;
    var applied;
    var styleApplied;
    var altFamilies;
    var doc;
    var color;
    var names;
    var resolved;

    if (!textRange || !style) {
        return false;
    }

    wantBold = isTruthyFlag(style.bold);
    wantItalic = isTruthyFlag(style.italic);
    family = trimString(style.fontFamily || style.font || "");
    applied = false;
    styleApplied = false;

    resolved = findInstalledFont(style);
    if (resolved) {
        try {
            textRange.appliedFont = resolved.font;
            applied = true;
            styleApplied = true;
        } catch (resolvedApplyError) {}
    }

    if (family && !applied) {
        candidates = buildFontCandidateNames(style);

        for (i = 0; i < candidates.length; i++) {
            try {
                textRange.appliedFont = app.fonts.item(candidates[i]);
                applied = true;
                styleApplied = true;
                break;
            } catch (fontByStyleError) {}
        }
    }

    if (!applied && family && wantBold) {
        altFamilies = [
            family + " Bold",
            family + "-Bold",
            family.replace(/\s+Regular$/i, "") + " Bold",
            family.replace(/\s+Medium$/i, "") + " Bold"
        ];
        for (i = 0; i < altFamilies.length; i++) {
            try {
                textRange.appliedFont = app.fonts.item(altFamilies[i]);
                applied = true;
                styleApplied = wantBold && !wantItalic;
                break;
            } catch (altFamilyError) {}
            try {
                textRange.appliedFont = app.fonts.item(altFamilies[i] + "\tRegular");
                applied = true;
                break;
            } catch (altRegularError) {}
        }
    }

    if (!applied && family && wantItalic && !wantBold) {
        altFamilies = [family + " Italic", family + "-Italic"];
        for (i = 0; i < altFamilies.length; i++) {
            try {
                textRange.appliedFont = app.fonts.item(altFamilies[i]);
                applied = true;
                styleApplied = true;
                break;
            } catch (italicFamilyError) {}
        }
    }

    // Always apply weight/style from theme flags (works even without a family).
    if (!styleApplied) {
        styleApplied = applyFontStyleSafe(textRange, wantBold, wantItalic);
    } else if (wantBold || wantItalic) {
        applyFontStyleSafe(textRange, wantBold, wantItalic);
        styleApplied = true;
    }

    if (wantBold && !styleApplied) {
        names = [
            (family || "Arial") + "\tBold",
            "Arial\tBold",
            (family || "Arial") + " Bold",
            "Arial Bold"
        ];
        for (i = 0; i < names.length; i++) {
            try {
                textRange.appliedFont = app.fonts.item(names[i]);
                styleApplied = true;
                break;
            } catch (boldNameError) {}
        }
    }

    // Faux bold when Bold face is missing (web can fake weight; InDesign cannot).
    if (wantBold && !styleApplied) {
        try {
            doc = app.activeDocument;
            textRange.strokeWeight = 0.4;
            if (style.color && style.color.length) {
                color = ensureDocumentColor(
                    doc,
                    "JSON_" + style.color[0] + "_" + style.color[1] + "_" + style.color[2],
                    style.color
                );
                if (color !== null) {
                    textRange.strokeColor = color;
                }
            }
            styleApplied = true;
            appendRenderLog(
                "Theme bold fallback (faux stroke) for font=\"" + (family || "(default)") + "\""
            );
        } catch (fauxBoldError) {
            warnings.push(
                'Could not apply bold for font "' + (family || "(default)") + '".'
            );
        }
    } else if (!wantBold) {
        try {
            textRange.strokeWeight = 0;
        } catch (clearStrokeError) {}
    }

    if (family && !applied && !styleApplied) {
        warnings.push('Theme font not found in InDesign: "' + family + '".');
    }

    return applied || styleApplied;
}

/** @deprecated Use applyThemeFontAndEmphasis — kept as alias for older call sites. */
function applyConfiguredFontFamily(textRange, style) {
    return applyThemeFontAndEmphasis(textRange, style);
}

/** @deprecated Use applyThemeFontAndEmphasis */
function forceBoldOnRange(textRange, style) {
    if (!textRange || !style) {
        return false;
    }
    return applyThemeFontAndEmphasis(textRange, style);
}

function isCompositeStyle(style) {
    return style &&
        typeof style === "object" &&
        style.text && typeof style.text === "object" &&
        style.number && typeof style.number === "object";
}

function splitNumberAndText(text) {
    var trimmed = trimString(text || "");
    var match;

    if (!trimmed) {
        return { number: "", text: "" };
    }

    match = trimmed.match(/^(\d+(?:[.\-]\w*)*)\s+(.+)$/);
    if (match) {
        return { number: match[1], text: match[2] };
    }

    return { number: "", text: trimmed };
}

function applyFrameFillColor(textFrame, style) {
    var doc;
    var rgb;
    var colorName;
    var color;

    if (!textFrame || !style || !style.backgroundColor) {
        return;
    }

    rgb = hexToRgb(style.backgroundColor);
    try {
        doc = app.activeDocument;
        colorName = "JSON_BG_" + rgb.join("_");
        color = ensureDocumentColor(doc, colorName, rgb);
        if (color !== null) {
            textFrame.fillColor = color;
        }
    } catch (fillError) {
        warnings.push("Could not apply frame background color.");
    }
}

function applyCompositeStyle(textFrame, compositeStyle) {
    var story;
    var fullText;
    var parts;
    var numberEnd;
    var numberRange;
    var textRange;

    if (!textFrame || !compositeStyle) {
        return;
    }

    try {
        story = textFrame.parentStory;
    } catch (storyError) {
        return;
    }

    if (!story) {
        return;
    }

    fullText = trimString(textFrame.contents || "");
    parts = splitNumberAndText(fullText);

    if (!parts.number) {
        applyFrameStyle(textFrame, compositeStyle.text || compositeStyle);
        return;
    }

    textFrame.contents = parts.number + " " + parts.text;
    numberEnd = parts.number.length;

    // Base text style first, then overlay number color/weight (theme2 lessonOverview).
    try {
        applyFrameStyle(textFrame, compositeStyle.text || compositeStyle);
    } catch (baseStyleError) {}

    try {
        story = textFrame.parentStory;
        if (story) {
            story.recompose();
        }
    } catch (recomposeError) {}

    try {
        numberRange = story.characters.itemByRange(0, Math.max(0, numberEnd - 1));
        applyTextRangeStyle(numberRange, compositeStyle.number);
        appendRenderLog(
            "Composite number styled: \"" + parts.number +
            "\" bold=" + (compositeStyle.number && compositeStyle.number.bold) +
            " italic=" + (compositeStyle.number && compositeStyle.number.italic)
        );
    } catch (numberStyleError) {
        warnings.push("Could not style composite number: " + numberStyleError.message);
    }

    try {
        if (story.characters.length > numberEnd + 1) {
            textRange = story.characters.itemByRange(numberEnd + 1, story.characters.length - 1);
            applyTextRangeStyle(textRange, compositeStyle.text);
        }
    } catch (textStyleError) {}

    try {
        story.recompose();
    } catch (recomposeAfterError) {}

    // Slightly roomier leading for wrapped LO lines (match web line-height).
    try {
        if (story.paragraphs.length) {
            story.paragraphs[0].justification = Justification.LEFT_ALIGN;
            story.paragraphs[0].autoLeading = 160;
            story.paragraphs[0].spaceAfter = 0;
            story.paragraphs[0].spaceBefore = 0;
        }
    } catch (leadingError) {}
}

function ensureFrameThemeStyle(textFrame, style) {
    var story;
    var textRange;

    if (!textFrame || !style) {
        return;
    }

    try {
        story = textFrame.parentStory;
    } catch (storyError) {
        return;
    }

    if (!story || !story.texts.length) {
        return;
    }

    prepareStoryForDirectFormatting(story);
    textRange = story.texts[0];

    if (style.pointSize) {
        try {
            textRange.pointSize = style.pointSize;
        } catch (sizeError) {}
    }

    applyThemeFontAndEmphasis(textRange, style);
    applyTextColor(textRange, style);
    logAppliedFontVerification(textRange, style, "frame font");
}

function applyFrameStyle(textFrame, style) {
    var story;
    var textRange;
    var p;
    var i;

    if (!textFrame || !style) return;

    story = textFrame.parentStory;
    if (!story || story.texts.length === 0) return;

    prepareStoryForDirectFormatting(story);
    textRange = story.texts[0];

    if (style.pointSize) {
        try {
            textRange.pointSize = style.pointSize;
        } catch (sizeError) {
            warnings.push("Could not set point size.");
        }
    }

    applyThemeFontAndEmphasis(textRange, style);
    applyTextColor(textRange, style);
    appendRenderLog(
        "Applied Style => " +
        "font=" + (style.fontFamily || style.font) +
        ", size=" + style.pointSize +
        ", color=" + style.color +
        ", bold=" + style.bold +
        ", italic=" + style.italic
    );
    logAppliedFontVerification(textRange, style, "frame font");

    // Match web: left-align (avoid full-justify stretching short lines / titles).
    try {
        for (i = 0; i < story.paragraphs.length; i++) {
            p = story.paragraphs[i];
            p.justification = Justification.LEFT_ALIGN;
            if (style.leftIndent) {
                p.leftIndent = style.leftIndent;
            }
        }
    } catch (justifyError) {
        if (style.leftIndent) {
            try {
                story.paragraphs[0].leftIndent = style.leftIndent;
            } catch (indentError) {
                warnings.push("Could not set left indent.");
            }
        }
    }

    // Chapter number bar: full-width fill, text on the left (match web).
    // Avoid large insets here — FRAME_TO_CONTENT + insets was clipping the text.
    if (style === FRAME_STYLES.chapterNumber || style === FRAME_STYLES.chapterHeading) {
        try {
            story.paragraphs[0].justification = Justification.LEFT_ALIGN;
            story.paragraphs[0].spaceBefore = 0;
            story.paragraphs[0].spaceAfter = 0;
            story.paragraphs[0].leftIndent = 10;
        } catch (chJustifyError) {}
        try {
            textFrame.textFramePreferences.verticalJustification =
                VerticalJustification.CENTER_ALIGN;
            textFrame.textFramePreferences.insetSpacing = [6, 0, 6, 0];
        } catch (vJustifyError) {}
    }

    applyFrameFillColor(textFrame, style);
    applyFrameBorders(textFrame, style);
}

/** Parse CSS-like border: "2px solid #CA5021" → { weight, colorRgb }. */
function parseCssBorder(borderValue) {
    var raw;
    var match;
    var weight;
    var hex;

    raw = trimString(borderValue || "");
    if (!raw || raw === "none") {
        return null;
    }

    match = raw.match(/^([\d.]+)\s*px\s+solid\s+(#[0-9A-Fa-f]{3,8})$/i);
    if (!match) {
        match = raw.match(/^([\d.]+)\s*pt\s+solid\s+(#[0-9A-Fa-f]{3,8})$/i);
    }
    if (!match) {
        return null;
    }

    weight = parseFloat(match[1]);
    if (!weight || weight <= 0) {
        return null;
    }
    hex = match[2];
    return {
        weight: weight,
        colorRgb: hexToRgb(hex)
    };
}

function styleHasBorders(style) {
    if (!style) {
        return false;
    }
    return Boolean(parseCssBorder(style.borderTop) || parseCssBorder(style.borderBottom));
}

function isBorderedTextFrame(textFrame) {
    try {
        return trimString(textFrame.extractLabel("runtimeBordered")) === "1";
    } catch (labelError) {
        return false;
    }
}

function removeRuntimeBorderLines(textFrame) {
    var page;
    var items;
    var i;
    var item;
    var label;

    try {
        page = textFrame.parentPage;
        if (!page) {
            return;
        }
        items = page.allPageItems;
        for (i = items.length - 1; i >= 0; i--) {
            item = items[i];
            try {
                label = trimString(item.extractLabel("runtimeBorderLine"));
                if (label === "1") {
                    // Only remove lines tagged for this frame id.
                    if (trimString(item.extractLabel("runtimeBorderOwner")) ===
                        trimString(textFrame.extractLabel("runtimeBorderId"))) {
                        item.remove();
                    }
                }
            } catch (itemError) {}
        }
    } catch (removeError) {}
}

/**
 * Draw full-column-width border lines (match web). Uses frame bounds so lines
 * stay full width even when paragraph RuleWidth falls back to text width.
 */
function drawFrameBorderLines(textFrame, style) {
    var bounds;
    var page;
    var doc;
    var topBorder;
    var bottomBorder;
    var color;
    var colorName;
    var line;
    var weight;
    var pad;
    var borderId;

    if (!textFrame || !style) {
        return;
    }

    topBorder = parseCssBorder(style.borderTop);
    bottomBorder = parseCssBorder(style.borderBottom);
    if (!topBorder && !bottomBorder) {
        return;
    }

    try {
        bounds = textFrame.geometricBounds;
        page = textFrame.parentPage;
        doc = app.activeDocument;
    } catch (boundsError) {
        return;
    }

    if (!page) {
        return;
    }

    pad = 0;
    borderId = trimString(textFrame.extractLabel("runtimeBorderId"));
    if (!borderId) {
        borderId = "b" + String(Math.floor(Math.random() * 100000000));
        try {
            textFrame.insertLabel("runtimeBorderId", borderId);
        } catch (idError) {}
    }

    removeRuntimeBorderLines(textFrame);

    if (topBorder) {
        weight = Math.max(topBorder.weight, 1);
        colorName = "JSON_BORDER_" + topBorder.colorRgb.join("_");
        color = ensureDocumentColor(doc, colorName, topBorder.colorRgb);
        try {
            line = page.rectangles.add({
                geometricBounds: [
                    bounds[0] + pad,
                    bounds[1],
                    bounds[0] + pad + weight,
                    bounds[3]
                ]
            });
            assignFrameToContentLayer(line);
            if (color !== null) {
                line.fillColor = color;
            }
            try {
                line.strokeWeight = 0;
            } catch (strokeError) {}
            try {
                line.insertLabel("runtimeBorderLine", "1");
                line.insertLabel("runtimeBorderOwner", borderId);
            } catch (labelError) {}
        } catch (topLineError) {
            warnings.push("Could not draw top border line: " + topLineError.message);
        }
    }

    if (bottomBorder) {
        weight = Math.max(bottomBorder.weight, 1);
        colorName = "JSON_BORDER_" + bottomBorder.colorRgb.join("_");
        color = ensureDocumentColor(doc, colorName, bottomBorder.colorRgb);
        try {
            line = page.rectangles.add({
                geometricBounds: [
                    bounds[2] - pad - weight,
                    bounds[1],
                    bounds[2] - pad,
                    bounds[3]
                ]
            });
            assignFrameToContentLayer(line);
            if (color !== null) {
                line.fillColor = color;
            }
            try {
                line.strokeWeight = 0;
            } catch (strokeError) {}
            try {
                line.insertLabel("runtimeBorderLine", "1");
                line.insertLabel("runtimeBorderOwner", borderId);
            } catch (labelError) {}
        } catch (bottomLineError) {
            warnings.push("Could not draw bottom border line: " + bottomLineError.message);
        }
    }
}

/**
 * Apply theme borderTop / borderBottom: keep full column width + padding,
 * then draw full-width rules (match web section title).
 */
function applyFrameBorders(textFrame, style) {
    var story;
    var para;
    var topBorder;
    var bottomBorder;
    var padPts;

    if (!textFrame || !style) {
        return;
    }

    topBorder = parseCssBorder(style.borderTop);
    bottomBorder = parseCssBorder(style.borderBottom);
    if (!topBorder && !bottomBorder) {
        return;
    }

    padPts = 8;

    try {
        textFrame.insertLabel("runtimeBordered", "1");
        if (style.borderTop) {
            textFrame.insertLabel("runtimeBorderTop", String(style.borderTop));
        }
        if (style.borderBottom) {
            textFrame.insertLabel("runtimeBorderBottom", String(style.borderBottom));
        }
    } catch (tagError) {}

    // Space between rules and text (match web pad-block).
    try {
        textFrame.textFramePreferences.insetSpacing = [padPts, 0, padPts, 0];
    } catch (insetError) {}

    try {
        story = textFrame.parentStory;
        if (story && story.paragraphs.length) {
            para = story.paragraphs[0];
            para.spaceBefore = 0;
            para.spaceAfter = 0;
        }
    } catch (paraError) {}

    drawFrameBorderLines(textFrame, style);
}

function refreshFrameBordersFromLabels(textFrame) {
    var style;

    if (!isBorderedTextFrame(textFrame)) {
        return;
    }

    style = {
        borderTop: null,
        borderBottom: null
    };
    try {
        style.borderTop = textFrame.extractLabel("runtimeBorderTop") || null;
    } catch (topError) {}
    try {
        style.borderBottom = textFrame.extractLabel("runtimeBorderBottom") || null;
    } catch (bottomError) {}

    drawFrameBorderLines(textFrame, style);
}

// Applies size/font/weight/color from a centralized style to a specific text
// range (not the whole frame). Used for LO numbers / FIGURE caption prefixes / any ranged style.
function applyTextRangeStyle(textRange, style) {
    if (!textRange || !style) {
        return;
    }

    if (style.pointSize) {
        try {
            textRange.pointSize = style.pointSize;
        } catch (sizeError) {}
    }

    // Normalize so font / fontFamily / bold / italic all flow through one path.
    if (!style.fontFamily && style.font) {
        style.fontFamily = style.font;
    }
    applyThemeFontAndEmphasis(textRange, style);
    applyTextColor(textRange, style);
    logAppliedFontVerification(textRange, style, "range font");
}

// Mirrors the web ImageBlock split: a leading "FIGURE 1.1" style prefix is
// rendered with the imageFigureNumber style; the rest keeps the caption style.
function parseFigureCaptionParts(caption) {
    var text = trimString(caption || "");
    var match;

    if (!text) {
        return null;
    }

    match = text.match(/^((?:FIGURE|EXHIBIT)\s+\d+(?:\.\d+)?)([\s\S]*)$/i);
    if (!match) {
        return null;
    }

    return { prefix: match[1], rest: match[2] || "" };
}

function applyFigureCaptionPrefixStyle(textFrame, captionText) {
    // The caption in the frame is the tag-stripped text, so match against that.
    var parts = parseFigureCaptionParts(parseInlineMarkup(captionText).plain);
    var story;
    var numberStyle;
    var prefixRange;

    if (!textFrame || !parts) {
        return;
    }

    numberStyle = FRAME_STYLES.imageFigureNumber || FRAME_STYLES_DEFAULTS.imageFigureNumber;

    try {
        story = textFrame.parentStory;
    } catch (storyError) {
        return;
    }

    if (!story) {
        return;
    }

    try {
        if (story.characters.length < parts.prefix.length) {
            return;
        }
        prefixRange = story.characters.itemByRange(0, parts.prefix.length - 1);
        applyTextRangeStyle(prefixRange, numberStyle);
    } catch (prefixError) {}
}

function populateFrame(document, labelName, textContent, style, blockType) {
    var frame;
    var cleanText = trimString(textContent || "");
    var itemType = blockType || "Text";

    appendRenderLog("---");
    appendRenderLog("JSON block type: " + itemType);
    appendRenderLog("Resolved Script Label: " + labelName);
    appendRenderLog("Text length: " + cleanText.length);

    if (!cleanText) {
        appendRenderLog("Frame found: n/a");
        appendRenderLog("Status: not populated — empty text in JSON");
        return;
    }

    frame = findTextFrameByLabel(document, labelName);
    if (frame === null) {
        appendRenderLog("Frame found: no");
        appendRenderLog("Status: not populated — text frame not found in template");
        warnings.push('Skipped "' + labelName + '": text frame not found.');
        return;
    }

    appendRenderLog("Frame found: yes");

    var frameRuns = setFrameContentsWithMarkup(frame, cleanText);
    applyFrameStyle(frame, style);
    applyInlineMarkupRuns(frame, frameRuns, style);
    if (itemType === "ImageCaption") {
        applyFigureCaptionPrefixStyle(frame, cleanText);
    }
    markLabelUsed(labelName);
    populatedCount += 1;
    appendRenderLog("Status: populated");
}

// -----------------------------------------------------------------------------
// Dynamic layout (Option B) — create frames from proto:* prototypes
// -----------------------------------------------------------------------------
function ensureContentLayer(document) {
    var layer;

    try {
        layer = document.layers.itemByName("Content");
        layer.name;
        return layer;
    } catch (missingLayer) {}

    layer = document.layers.add();
    layer.name = "Content";
    return layer;
}

function assignFrameToContentLayer(frame) {
    if (!contentLayer || !frame) {
        return;
    }

    try {
        frame.itemLayer = contentLayer;
    } catch (layerError) {}
}

function getBlockText(data, listStyle) {
    var fields;
    var i;
    var value;
    var bulletLines;
    var bulletText;
    var prefix;
    var useNumbered;

    if (!data) {
        return "";
    }

    // List blocks carry an "items" array instead of a text field.
    if (data.items && data.items.length !== undefined) {
        useNumbered = listStyle === "numbered" || listStyle === "NumberedList";
        bulletLines = [];
        for (i = 0; i < data.items.length; i++) {
            bulletText = fixUtf8Mojibake(trimString(data.items[i]));
            if (bulletText) {
                // Strip existing markers so we do not double-prefix.
                bulletText = bulletText.replace(/^([\u2022•\-\*]|\d+[.)])\s*/, "");
                prefix = useNumbered ? String(i + 1) + ". " : "\u2022 ";
                bulletLines.push(prefix + bulletText);
            }
        }
        if (bulletLines.length > 0) {
            return bulletLines.join("\r");
        }
    }

    fields = ["text", "title", "label", "content", "value"];
    for (i = 0; i < fields.length; i++) {
        if (data[fields[i]] !== undefined && data[fields[i]] !== null) {
            value = fixUtf8Mojibake(trimString(data[fields[i]]));
            if (value) {
                return value;
            }
        }
    }

    return "";
}

/**
 * List blocks may arrive one item per block with a plain "text" field instead of
 * an "items" array. Those still need a bullet or number, and numbered runs keep
 * counting across consecutive blocks until another block type interrupts them.
 */
function applySingleItemListMarker(layoutState, itemType, data, text) {
    var stripped;

    if (!text || (data && data.items && data.items.length)) {
        return text;
    }

    if (itemType !== "BulletList" && itemType !== "NumberedList") {
        return text;
    }

    stripped = trimString(text).replace(/^([\u2022•\-\*]|\d+[.)])\s*/, "");
    if (!stripped) {
        return text;
    }

    if (itemType === "NumberedList") {
        layoutState.numberedListRun = (layoutState.numberedListRun || 0) + 1;
        return layoutState.numberedListRun + ". " + stripped;
    }

    return "\u2022 " + stripped;
}

/**
 * Parse cendoc-style inline HTML from output JSON into plain text + style runs.
 * Supports: i/em, b/strong, span (glossary → plain), sup (endnote → superscript), br, a (text only).
 */
/** Extract a hex color from an inline style attribute, e.g. style="color: #c31427;". */
function parseInlineStyleColor(attrs) {
    var match = /(?:^|;|\s)color\s*:\s*(#[0-9a-fA-F]{3,6})/.exec(String(attrs || ""));
    var hex;

    if (!match) {
        return "";
    }

    hex = match[1].replace(/^#/, "");
    if (hex.length === 3) {
        hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (hex.length !== 6) {
        return "";
    }

    return "#" + hex;
}

function parseInlineMarkup(raw) {
    var text;
    var plain = "";
    var runs = [];
    var stack = [];
    var last = 0;
    var m;
    var re;
    var tag;
    var attrs;
    var isClose;
    var isSelfClose;
    var i;
    var open;
    var runItalic;
    var runBold;
    var runSuper;
    var runColor;

    text = fixUtf8Mojibake(String(raw || ""));
    text = text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'");

    if (text.indexOf("<") < 0) {
        return { plain: text, runs: runs };
    }

    re = /<\/?([a-zA-Z0-9]+)(\s[^>]*)?\s*\/?>/g;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) {
            plain += text.substring(last, m.index);
        }

        tag = String(m[1] || "").toLowerCase();
        attrs = m[2] || "";
        isClose = m[0].charAt(1) === "/";
        isSelfClose = /\/\s*>$/.test(m[0]) || tag === "br";

        if (!isClose && isSelfClose && tag === "br") {
            plain += "\r";
        } else if (!isClose && !isSelfClose) {
            if (
                tag === "i" ||
                tag === "em" ||
                tag === "b" ||
                tag === "strong" ||
                tag === "span" ||
                tag === "sup" ||
                tag === "a"
            ) {
                stack.push({
                    tag: tag,
                    start: plain.length,
                    italic: tag === "i" || tag === "em",
                    bold: tag === "b" || tag === "strong",
                    superscript: tag === "sup",
                    color: parseInlineStyleColor(attrs)
                });
            }
            // Unknown open tags are dropped; inner text is kept.
        } else if (isClose) {
            for (i = stack.length - 1; i >= 0; i--) {
                if (stack[i].tag === tag) {
                    open = stack[i];
                    stack.splice(i, 1);
                    runItalic = open.italic;
                    runBold = open.bold;
                    runSuper = open.superscript;
                    runColor = open.color;
                    // Inherit open emphasis/color from parents still on the stack.
                    var p;
                    for (p = 0; p < stack.length; p++) {
                        if (stack[p].italic) runItalic = true;
                        if (stack[p].bold) runBold = true;
                        if (stack[p].superscript) runSuper = true;
                        if (!runColor && stack[p].color) runColor = stack[p].color;
                    }
                    if (plain.length > open.start && (runItalic || runBold || runSuper || runColor)) {
                        runs.push({
                            start: open.start,
                            end: plain.length,
                            italic: runItalic,
                            bold: runBold,
                            superscript: runSuper,
                            color: runColor
                        });
                    }
                    break;
                }
            }
        }

        last = m.index + m[0].length;
    }

    if (last < text.length) {
        plain += text.substring(last);
    }

    return { plain: plain, runs: runs };
}

function applyInlineMarkupRuns(frame, runs, baseStyle) {
    var story;
    var i;
    var run;
    var fromIdx;
    var toIdx;
    var range;
    var runStyle;
    var base;

    if (!frame || !runs || !runs.length) {
        return;
    }

    try {
        story = frame.parentStory;
    } catch (storyError) {
        return;
    }
    if (!story) {
        return;
    }

    base = baseStyle && !isCompositeStyle(baseStyle) ? baseStyle : {};

    for (i = 0; i < runs.length; i++) {
        run = runs[i];
        if (!run || run.end <= run.start) {
            continue;
        }
        fromIdx = run.start;
        toIdx = run.end - 1;
        try {
            range = story.characters.itemByRange(fromIdx, toIdx);
            runStyle = {
                font: base.fontFamily || base.font || "",
                fontFamily: base.fontFamily || base.font || "",
                pointSize: base.pointSize,
                bold: run.bold ? true : isTruthyFlag(base.bold),
                italic: run.italic ? true : isTruthyFlag(base.italic),
                color: run.color ? hexToRgb(run.color) : base.color
            };
            applyThemeFontAndEmphasis(range, runStyle);
            if (run.color) {
                applyTextColor(range, runStyle);
            }
            if (run.superscript) {
                try {
                    range.position = Position.SUPERSCRIPT;
                } catch (supError) {}
            }
        } catch (rangeError) {}
    }
}

/**
 * Set frame text from JSON that may carry inline HTML (<b>, <i>, <span style="color">).
 * Returns the parsed runs so the caller can re-apply them after its own styling pass.
 */
function setFrameContentsWithMarkup(frame, rawText) {
    var parsed = parseInlineMarkup(rawText);

    try {
        frame.contents = parsed.plain;
    } catch (contentsError) {
        frame.contents = String(rawText || "");
        return [];
    }

    return parsed.runs;
}

/**
 * Drop per-run colors so the theme color wins. Used for badge/bar blocks where a
 * color from the source HTML could render the text invisible on its fill.
 */
function dropRunColors(runs) {
    var out = [];
    var i;

    for (i = 0; runs && i < runs.length; i++) {
        out.push({
            start: runs[i].start,
            end: runs[i].end,
            italic: runs[i].italic,
            bold: runs[i].bold,
            superscript: runs[i].superscript,
            color: ""
        });
    }

    return out;
}

function normalizeBlockType(itemType) {
    var compact;
    var aliases;

    compact = trimString(itemType || "").replace(/\s+/g, "").toLowerCase();
    aliases = {
        lessonnumber: "LessonNumber",
        lessontitle: "LessonTitle",
        chapteroverview: "ChapterOverview",
        topic: "Topic",
        sectiontitle: "SectionTitle",
        text: "Text",
        image: "Image",
        chapternumber: "ChapterNumber",
        chaptertitle: "ChapterTitle",
        lessonoverview: "LessonOverview",
        paragraphtext: "ParagraphText",
        learningobjectives: "LearningObjectives",
        bulletlist: "BulletList",
        numberedlist: "NumberedList",
        orderedlist: "NumberedList",
        logowithtext: "LogoWithText",
        partnumber: "PartNumber",
        subtitleslist: "SubTitlesList",
        greensubsectiontitle: "GreenSubSectionTitle",
        subtitle: "SubTitle",
        subsectiontitle: "SubSectionTitle",
        subsectionheading: "SubSectionHeading",
        caption: "FigureCaption",
        figurecaption: "FigureCaption",
        quotation: "Quotation",
        quote: "Quotation",
        table: "Table",
        tableblock: "Table",
        footer: "Footer"
    };

    if (aliases[compact]) {
        return aliases[compact];
    }

    return trimString(itemType || "");
}

function normalizeDocumentForDynamicLayout(document) {
    // Force the ruler to points so all spacing constants (blockGap, seed/min
    // heights) and geometricBounds math behave in points instead of the
    // template's saved units (e.g. picas), which caused oversized gaps.
    try {
        document.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        document.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    } catch (measurementUnitError) {}

    try {
        document.documentPreferences.facingPages = false;
    } catch (facingError) {}

    try {
        document.documentPreferences.pagesPerDocument = PagesPerDocumentOptions.SINGLE_PAGE;
    } catch (pagesError) {}
}

function saveLastInputJson(scriptFolderPath, contentItems) {
    try {
        writeTextFile(scriptFolderPath + "/last-input.json", JSON.stringify(contentItems, null, 2));
    } catch (saveError) {}
}

function resolveRegistryEntry(itemType) {
    var key;
    var normalized = normalizeBlockType(itemType);

    if (BLOCK_REGISTRY[normalized]) {
        return BLOCK_REGISTRY[normalized];
    }

    for (key in BLOCK_REGISTRY) {
        if (BLOCK_REGISTRY.hasOwnProperty(key) && key.toLowerCase() === normalized.toLowerCase()) {
            return BLOCK_REGISTRY[key];
        }
    }

    return null;
}

function isPlaceholderText(text) {
    var normalized = trimString(text).toLowerCase();
    return normalized === "click or tap here to enter text." ||
        normalized === "click or tap here to enter text" ||
        normalized.indexOf("click or tap here") === 0;
}

function logJsonBlockSummary(contentItems) {
    var i;
    var item;
    var preview;

    appendRenderLog("JSON block summary:");
    for (i = 0; i < contentItems.length; i++) {
        item = contentItems[i];
        preview = getBlockText(item.data || {});
        if (preview.length > 60) {
            preview = preview.substring(0, 60) + "...";
        }
        appendRenderLog(
            "  " + (i + 1) + ". " + item.type +
            (preview ? ' text="' + preview + '"' : " (EMPTY - will skip)")
        );
    }
}

function cachePrototypeMetrics(document) {
    var i;
    var item;
    var label;
    var bounds;
    var allItems = document.allPageItems;

    prototypeMetrics = {};

    for (i = 0; i < allItems.length; i++) {
        item = allItems[i];
        label = trimString(getItemLabel(item));
        if (!isPrototypeLabel(label)) {
            continue;
        }

        try {
            bounds = item.geometricBounds;
            prototypeMetrics[label] = {
                height: Math.max(bounds[2] - bounds[0], DYNAMIC_LAYOUT.minTextFrameHeight),
                width: bounds[3] - bounds[1]
            };
        } catch (metricError) {
            prototypeMetrics[label] = {
                height: DYNAMIC_LAYOUT.minTextFrameHeight,
                width: 0
            };
        }
    }
}

function getPrototypeHeight(protoLabel, fallbackHeight) {
    var metrics = prototypeMetrics[protoLabel];
    if (metrics && metrics.height) {
        return metrics.height;
    }
    return fallbackHeight;
}

function getDynamicTextSeedHeight(protoLabel, usedFallbackLabel) {
    var height = getPrototypeHeight(protoLabel, DYNAMIC_LAYOUT.minTextFrameHeight);

    if (usedFallbackLabel) {
        height = Math.min(height, getPrototypeHeight(usedFallbackLabel, height));
    }

    height = Math.max(height, DYNAMIC_LAYOUT.minTextFrameHeight);
    if (height > 120) {
        height = 120;
    }

    return height;
}

function clearPrototypeFrameContents(document) {
    var i;
    var item;
    var label;

    for (i = 0; i < document.allPageItems.length; i++) {
        item = document.allPageItems[i];
        label = trimString(getItemLabel(item));
        if (!isPrototypeLabel(label)) {
            continue;
        }

        try {
            if (item.contents !== undefined) {
                item.contents = "";
            }
        } catch (clearError) {}

        try {
            clearGraphicsFromFrame(item);
        } catch (graphicError) {}
    }
}

function resolveTextPrototype(document, protoLabel) {
    var frame = findPageItemByLabel(document, protoLabel);

    if (frame !== null) {
        return { frame: frame, label: protoLabel, usedFallback: false };
    }

    if (protoLabel !== PROTOTYPE_TEXT_FALLBACK) {
        frame = findPageItemByLabel(document, PROTOTYPE_TEXT_FALLBACK);
        if (frame !== null) {
            warnings.push('Using "' + PROTOTYPE_TEXT_FALLBACK + '" fallback for missing "' + protoLabel + '".');
            return { frame: frame, label: PROTOTYPE_TEXT_FALLBACK, usedFallback: true };
        }
    }

    return null;
}

function textFrameOverflows(frame) {
    try {
        return frame.overflows === true;
    } catch (overflowError) {
        return false;
    }
}

function createTextFrameOnPage(page, layoutBounds, top, height) {
    var frame;

    frame = page.textFrames.add({
        geometricBounds: [top, layoutBounds.left, top + height, layoutBounds.right]
    });
    assignFrameToContentLayer(frame);
    clearRuntimeLabel(frame);
    return frame;
}

function isOpenerLayoutPage(layoutState) {
    var raw = trimString((layoutState && layoutState.pageType) || CURRENT_PAGE_TYPE || "opener").toLowerCase();
    return !(raw === "non_opener" || raw === "non-opener" || raw === "nonopener");
}

/** Opener only: PartNumber badge overlaid on top-left of the last hero image (match web). */
function placeOpenerPartNumberOverlay(layoutState, imageFrame, text, style) {
    var imageBounds;
    var page;
    var pointSize;
    var padX;
    var padY;
    var width;
    var height;
    var top;
    var left;
    var frame;
    var story;
    var appliedStyle;
    var overlayRuns;

    if (!imageFrame || !text) {
        return;
    }

    try {
        imageBounds = imageFrame.geometricBounds;
        page = imageFrame.parentPage || (layoutState && layoutState.page);
    } catch (boundsError) {
        warnings.push("Could not read image bounds for PartNumber overlay.");
        return;
    }

    if (!page) {
        return;
    }

    appliedStyle = style || FRAME_STYLES.partNumber || FRAME_STYLES_DEFAULTS.partNumber;
    pointSize = (appliedStyle && appliedStyle.pointSize) || 24;
    padX = 10;
    padY = 3;
    // Compact badge — match web tight padding (not a tall bar).
    width = Math.max(72, text.length * pointSize * 0.55 + padX * 2);
    height = Math.max(pointSize + padY * 2, 28);
    // Inset slightly from the image top-left (match web gap).
    top = imageBounds[0] + 8;
    left = imageBounds[1];

    if (left + width > imageBounds[3]) {
        width = Math.max(64, imageBounds[3] - left);
    }
    if (top + height > imageBounds[2]) {
        height = Math.max(pointSize + 8, imageBounds[2] - top);
    }

    try {
        frame = page.textFrames.add({
            geometricBounds: [top, left, top + height, left + width]
        });
        assignFrameToContentLayer(frame);
        clearRuntimeLabel(frame);
        try {
            frame.textFramePreferences.insetSpacing = [padY, padX, padY, padX];
            frame.textFramePreferences.verticalJustification =
                VerticalJustification.CENTER_ALIGN;
        } catch (insetError) {}
        overlayRuns = setFrameContentsWithMarkup(frame, text);
        applyFrameStyle(frame, appliedStyle);
        applyInlineMarkupRuns(frame, dropRunColors(overlayRuns), appliedStyle);
        try {
            story = frame.parentStory;
            if (story && story.paragraphs.length) {
                story.paragraphs[0].justification = Justification.LEFT_ALIGN;
                story.paragraphs[0].spaceBefore = 0;
                story.paragraphs[0].spaceAfter = 0;
                story.paragraphs[0].leftIndent = 0;
                story.paragraphs[0].firstLineIndent = 0;
            }
        } catch (paraError) {}
        try {
            frame.bringToFront();
        } catch (zError) {}
        populatedCount += 1;
        appendRenderLog("PartNumber overlay placed on opener image (top-left)");
    } catch (overlayError) {
        warnings.push("Could not place PartNumber overlay: " + overlayError.message);
    }
}

function createGraphicFrameOnPage(page, layoutBounds, top, height) {
    var frame;
    var frameHeight = height && height > 0 ? height : DYNAMIC_LAYOUT.defaultImageFrameHeight;

    frame = page.rectangles.add({
        geometricBounds: [
            top,
            layoutBounds.left,
            top + frameHeight,
            layoutBounds.right
        ]
    });

    assignFrameToContentLayer(frame);
    clearRuntimeLabel(frame);
    clearImageFrameStroke(frame);

    appendRenderLog(
        "Dynamic image frame created width=" +
        (layoutBounds.right - layoutBounds.left)
    );

    return frame;
}

/** Match web: no border/stroke around images. */
function clearImageFrameStroke(frame) {
    var i;
    var graphic;

    if (!frame) {
        return;
    }

    try {
        frame.strokeWeight = 0;
    } catch (strokeWeightError) {}

    try {
        frame.strokeColor = app.activeDocument.swatches.itemByName("None");
    } catch (strokeColorError) {
        try {
            frame.strokeTint = 0;
        } catch (tintError) {}
    }

    try {
        for (i = 0; i < frame.graphics.length; i++) {
            graphic = frame.graphics[i];
            try {
                graphic.strokeWeight = 0;
            } catch (graphicStrokeError) {}
        }
    } catch (graphicsError) {}
}

function getAvailableColumnHeight(layoutState) {
    var layoutBounds = getPageLayoutBounds(layoutState.page);
    return layoutBounds.bottom - layoutState.cursorY;
}

function getLastFrameInChain(frame) {
    var current = frame;
    var next;

    while (current) {
        try {
            next = current.nextTextFrame;
            if (!next) {
                break;
            }
            current = next;
        } catch (chainError) {
            break;
        }
    }

    return current;
}

function getFrameBottomY(frame) {
    var bounds;
    var chainEnd;

    if (!frame) {
        return 0;
    }

    chainEnd = getLastFrameInChain(frame);

    try {
        bounds = chainEnd.geometricBounds;
        if (bounds && bounds.length === 4) {
            return bounds[2];
        }
    } catch (boundsError) {}

    return 0;
}

function getImageContentBottomY(imageFrame) {
    var frameBottom = getFrameBottomY(imageFrame);
    var graphicBottom = -1;
    var graphics;
    var i;
    var gb;

    try {
        graphics = imageFrame.graphics;
        for (i = 0; i < graphics.length; i++) {
            gb = graphics[i].geometricBounds;
            if (gb && gb.length === 4 && gb[2] > graphicBottom) {
                graphicBottom = gb[2];
            }
        }
    } catch (graphicBoundsError) {}

    // Prefer the visible graphic bottom: a taller crop/overflow must push
    // following text down, while a shorter graphic lets the caption hug the image.
    if (graphicBottom > 0) {
        return graphicBottom;
    }

    return frameBottom;
}

function syncLayoutPageFromFrame(layoutState, frame) {
    try {
        if (frame && frame.parentPage) {
            layoutState.page = frame.parentPage;
        }
    } catch (parentError) {}
}

function listPrototypeLabels(document) {
    var i;
    var item;
    var label;
    var labels = [];
    var allItems = document.allPageItems;

    for (i = 0; i < allItems.length; i++) {
        item = allItems[i];
        label = trimString(getItemLabel(item));
        if (isPrototypeLabel(label)) {
            labels.push(label);
        }
    }

    return labels;
}

function getPrototypeParagraphSpaceBefore(protoFrame) {
    try {
        return protoFrame.parentStory.paragraphs[0].appliedParagraphStyle.spaceBefore;
    } catch (spaceBeforeError) {
        return 0;
    }
}

function getTextFrameBottomY(textFrame) {
    var bounds;
    var endBaseline;
    var spaceAfter = 0;
    var paragraphs;
    var tailPadding = 1;

    try {
        bounds = textFrame.geometricBounds;
        endBaseline = textFrame.texts[0].endBaseline;
        paragraphs = textFrame.parentStory.paragraphs;
        if (paragraphs.length > 0) {
            spaceAfter = paragraphs[paragraphs.length - 1].spaceAfter;
        }
        if (endBaseline > bounds[0]) {
            return endBaseline + spaceAfter + tailPadding;
        }
    } catch (bottomError) {}

    try {
        return textFrame.geometricBounds[2];
    } catch (boundsError) {
        return 0;
    }
}

function shrinkTextFrameToContentBottom(textFrame) {
    var bounds;
    var contentBottom;

    try {
        bounds = textFrame.geometricBounds;
        contentBottom = getTextFrameBottomY(textFrame);
        if (contentBottom > bounds[0] && contentBottom < bounds[2]) {
            textFrame.geometricBounds = [bounds[0], bounds[1], contentBottom, bounds[3]];
        }
    } catch (shrinkError) {}
}

function tightenTextFrameToRenderedContent(textFrame, options) {
    var story;
    var fitPass;
    var bounds;
    var savedLeft;
    var savedRight;
    var savedTop;
    var preserveFullWidth = options && options.preserveFullWidth;
    var preserveColumnWidth = options && options.preserveColumnWidth;
    var minBarHeight = options && options.minBarHeight ? Number(options.minBarHeight) : 0;
    var borderPad = options && options.borderPad ? Number(options.borderPad) : 10;
    var contentBottom;

    try {
        bounds = textFrame.geometricBounds;
        savedTop = bounds[0];
        savedLeft = bounds[1];
        savedRight = bounds[3];
    } catch (boundsError) {
        savedTop = null;
        savedLeft = null;
        savedRight = null;
    }

    // ChapterNumber bar: never use FRAME_TO_CONTENT — it collapses height and
    // clips white 36pt text, leaving an empty orange strip.
    if (preserveFullWidth && savedLeft !== null && savedRight !== null) {
        try {
            story = textFrame.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeBarError) {}

        try {
            bounds = textFrame.geometricBounds;
            if (!minBarHeight || minBarHeight < 24) {
                minBarHeight = 48;
            }
            textFrame.geometricBounds = [
                savedTop !== null ? savedTop : bounds[0],
                savedLeft,
                (savedTop !== null ? savedTop : bounds[0]) + minBarHeight,
                savedRight
            ];
        } catch (barSizeError) {}

        try {
            if (textFrame.overflows === true) {
                bounds = textFrame.geometricBounds;
                textFrame.geometricBounds = [
                    bounds[0],
                    bounds[1],
                    bounds[0] + Math.max(minBarHeight, 64),
                    bounds[3]
                ];
            }
        } catch (growBarError) {}
        return;
    }

    // Bordered blocks (e.g. sectionTitle): keep full column width, only shrink height.
    if (preserveColumnWidth && savedLeft !== null && savedRight !== null) {
        try {
            story = textFrame.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeBorderError) {}

        try {
            contentBottom = getTextFrameBottomY(textFrame) + borderPad;
            bounds = textFrame.geometricBounds;
            if (contentBottom <= bounds[0] + 12) {
                contentBottom = bounds[0] + Math.max(24, borderPad * 2 + 14);
            }
            textFrame.geometricBounds = [
                savedTop !== null ? savedTop : bounds[0],
                savedLeft,
                contentBottom,
                savedRight
            ];
        } catch (borderSizeError) {}

        try {
            if (textFrame.overflows === true) {
                bounds = textFrame.geometricBounds;
                textFrame.geometricBounds = [
                    bounds[0],
                    savedLeft,
                    bounds[2] + 12,
                    savedRight
                ];
            }
        } catch (growBorderError) {}

        refreshFrameBordersFromLabels(textFrame);
        return;
    }

    for (fitPass = 0; fitPass < 2; fitPass++) {
        try {
            fitTextFrameToContent(textFrame);
        } catch (fitPassError) {}
        try {
            story = textFrame.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeFitStoryError) {}
    }

    shrinkTextFrameToContentBottom(textFrame);
}

/**
 * Re-grow a frame that was tightened to its rendered content and then restyled.
 * Character styling applied afterwards (inline runs, figure caption prefix) can
 * change line metrics, and with zero slack the tail text goes overset.
 */
function growTextFrameToFitContent(frame) {
    var pass;
    var bounds;
    var pageBottom;
    var story;

    if (!frame) {
        return;
    }

    try {
        story = frame.parentStory;
        if (story) {
            story.recompose();
        }
    } catch (recomposeError) {}

    try {
        if (frame.nextTextFrame) {
            return;
        }
    } catch (chainError) {}

    try {
        pageBottom = getPageLayoutBounds(frame.parentPage).bottom;
    } catch (pageBoundsError) {
        return;
    }

    for (pass = 0; pass < 24; pass++) {
        if (!textFrameOverflows(frame)) {
            return;
        }

        try {
            bounds = frame.geometricBounds;
            if (bounds[2] >= pageBottom) {
                return;
            }
            frame.geometricBounds = [
                bounds[0],
                bounds[1],
                Math.min(pageBottom, bounds[2] + 12),
                bounds[3]
            ];
        } catch (growError) {
            return;
        }

        try {
            story = frame.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeGrowError) {}
    }
}

function flowDynamicText(layoutState, cleanText, style, minHeight, seedHeight) {
    var layoutBounds;
    var available;
    var frameHeight;
    var frameTop;
    var frame;
    var firstFrame;
    var lastFrame;
    var chainEnd;
    var safety = 0;
    var maxOverflowPages = 40;
    var initialHeight = seedHeight || Math.max(minHeight * 2, 96);
    var story;
    var bounds;
    var fitPass;
    var contentBottom;
    var tailPadding = 1;
    var preserveFullWidth =
        style === FRAME_STYLES.chapterNumber || style === FRAME_STYLES.chapterHeading;
    var preserveColumnWidth = !preserveFullWidth && styleHasBorders(style);
    var chapterBarHeight = preserveFullWidth
        ? Math.max(((style && style.pointSize) || 36) + 20, 52)
        : 0;

    layoutBounds = ensureLayoutSpace(layoutState, minHeight);
    available = getAvailableColumnHeight(layoutState);

    if (available < DYNAMIC_LAYOUT.minTextFrameHeight) {
        addLayoutPage(layoutState);
        layoutBounds = getPageLayoutBounds(layoutState.page);
        available = getAvailableColumnHeight(layoutState);
    }

    frameHeight = Math.min(available, Math.max(initialHeight, minHeight));
    if (preserveFullWidth) {
        frameHeight = Math.min(available, Math.max(chapterBarHeight, 52));
    }
    if (frameHeight < DYNAMIC_LAYOUT.minTextFrameHeight) {
        frameHeight = Math.min(available, DYNAMIC_LAYOUT.minTextFrameHeight);
    }

    frameTop = layoutState.cursorY;
    frame = createTextFrameOnPage(layoutState.page, layoutBounds, frameTop, frameHeight);
    var inlineParsed = parseInlineMarkup(cleanText);
    frame.contents = inlineParsed.plain;
    if (isCompositeStyle(style)) {
        applyCompositeStyle(frame, style);
    } else {
        applyFrameStyle(frame, style);
    }

    // Force story reflow before any overflow or bounds reads.
    try {
        story = frame.parentStory;
        if (story) {
            story.recompose();
        }
    } catch (recomposeStoryError) {}
    try {
        layoutState.document.recompose();
    } catch (recomposeDocError) {}

    if (!isCompositeStyle(style)) {
        ensureFrameThemeStyle(frame, style);
    } else {
        applyCompositeStyle(frame, style);
    }
    // Apply after theme style so i/b/sup runs are not wiped by whole-story formatting.
    applyInlineMarkupRuns(frame, inlineParsed.runs, style);

    firstFrame = frame;
    lastFrame = frame;

    if (textFrameOverflows(lastFrame) && available > frameHeight + 12) {
        try {
            frameHeight = available;
            lastFrame.geometricBounds = [
                frameTop,
                layoutBounds.left,
                frameTop + frameHeight,
                layoutBounds.right
            ];
        } catch (growError) {}
        try {
            story = lastFrame.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeGrowStoryError) {}
        try {
            layoutState.document.recompose();
        } catch (recomposeGrowDocError) {}
    }

    while (textFrameOverflows(lastFrame) && safety < maxOverflowPages) {
        safety += 1;
        if (
            layoutState.columnCount === 2 &&
            layoutState.currentColumn === 0
        ) {
            layoutState.currentColumn = 1;
            layoutState.cursorY =
                getPageLayoutBounds(layoutState.page).top;

            appendRenderLog(
                "Switching to column 2 on page " +
                layoutState.page.name
            );
        } else {
            addLayoutPage(layoutState);

            layoutState.currentColumn = 0;

            layoutState.cursorY =
                getPageLayoutBounds(layoutState.page).top;

            appendRenderLog(
                "Moving to next page " +
                layoutState.page.name
            );
        }

        layoutBounds =
            getPageLayoutBounds(
                layoutState.page
            );
        frameHeight = layoutBounds.bottom - layoutBounds.top;
        if (frameHeight < DYNAMIC_LAYOUT.minTextFrameHeight) {
            warnings.push("Layout page has no usable height; stopping text overflow.");
            break;
        }

        frame = createTextFrameOnPage(layoutState.page, layoutBounds, layoutBounds.top, frameHeight);

        try {
            lastFrame.nextTextFrame = frame;
        } catch (linkError) {
            warnings.push("Could not link overflow text to the next page.");
            try {
                frame.remove();
            } catch (removeError) {}
            break;
        }

        lastFrame = frame;

        try {
            story = lastFrame.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeThreadStoryError) {}
        try {
            layoutState.document.recompose();
        } catch (recomposeThreadDocError) {}
    }

    chainEnd = getLastFrameInChain(firstFrame);

    while (textFrameOverflows(chainEnd) && safety < maxOverflowPages) {
        safety += 1;
        addLayoutPage(layoutState);
        layoutBounds = getPageLayoutBounds(layoutState.page);
        frameHeight = layoutBounds.bottom - layoutBounds.top;
        if (frameHeight < DYNAMIC_LAYOUT.minTextFrameHeight) {
            warnings.push("Layout page has no usable height; stopping text overflow.");
            break;
        }

        frame = createTextFrameOnPage(layoutState.page, layoutBounds, layoutBounds.top, frameHeight);

        try {
            chainEnd.nextTextFrame = frame;
        } catch (linkAfterFitError) {
            warnings.push("Could not link overflow text to the next page.");
            try {
                frame.remove();
            } catch (removeAfterFitError) {}
            break;
        }

        chainEnd = frame;

        try {
            story = chainEnd.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeTailStoryError) {}
        try {
            layoutState.document.recompose();
        } catch (recomposeTailDocError) {}
    }

    if (safety >= maxOverflowPages && textFrameOverflows(chainEnd)) {
        warnings.push("Stopped text overflow pagination after " + maxOverflowPages + " pages.");
    }

    // Shrink the tail frame to the rendered text bottom before cursor placement.
    if (!textFrameOverflows(chainEnd) && !chainEnd.nextTextFrame) {
        tightenTextFrameToRenderedContent(chainEnd, {
            preserveFullWidth: preserveFullWidth,
            preserveColumnWidth: preserveColumnWidth,
            minBarHeight: chapterBarHeight,
            borderPad: 10
        });
        if (preserveColumnWidth) {
            refreshFrameBordersFromLabels(chainEnd);
        }
        try {
            story = chainEnd.parentStory;
            if (story) {
                story.recompose();
            }
        } catch (recomposeFinalStoryError) {}
        try {
            layoutState.document.recompose();
        } catch (recomposeFinalDocError) {}
    }

    syncLayoutPageFromFrame(layoutState, chainEnd);

    if (!isCompositeStyle(style)) {
        ensureFrameThemeStyle(firstFrame, style);
    }
    applyInlineMarkupRuns(firstFrame, inlineParsed.runs, style);
    growTextFrameToFitContent(chainEnd);

    return chainEnd;
}

function findPageItemByLabel(document, labelName) {
    var i;
    var item;
    var itemLabel;
    var targetLabel = trimString(labelName).toLowerCase();
    var allItems = document.allPageItems;

    for (i = 0; i < allItems.length; i++) {
        item = allItems[i];
        itemLabel = trimString(getItemLabel(item)).toLowerCase();
        if (itemLabel === targetLabel) {
            return item;
        }
    }

    return null;
}

function isPrototypeLabel(labelName) {
    return trimString(labelName).indexOf(DYNAMIC_LAYOUT.protoPrefix) === 0;
}

function getPageLayoutBounds(page) {
    var bounds;
    var margins;
    var topMargin;
    var leftMargin;
    var bottomMargin;
    var rightMargin;

    var columnCount = 1;
    var currentColumn = 0;
    var gutter = 18;

    try {
        bounds = page.bounds;
    } catch (boundsError) {
        bounds = [0, 0, 792, 612];
    }

    try {
        margins = page.marginPreferences;
        topMargin = margins.top;
        leftMargin = margins.left;
        bottomMargin = margins.bottom;
        rightMargin = margins.right;
    } catch (marginError) {
        topMargin = 72;
        leftMargin = 72;
        bottomMargin = 72;
        rightMargin = 72;
    }

    if (layoutState) {
        columnCount = layoutState.columnCount || 1;
        currentColumn = layoutState.currentColumn || 0;
        gutter = layoutState.gutter || 18;
    }

    var usableLeft = bounds[1] + leftMargin + getContentLeftInset();
    var usableRight = bounds[3] - rightMargin;
    var usableWidth = usableRight - usableLeft;
    var usableBottom = bounds[2] - bottomMargin;
    var footerReserve = 0;

    if (layoutState && layoutState.footerReserve) {
        footerReserve = layoutState.footerReserve;
        usableBottom -= footerReserve;
    }

    var columnWidth =
        (usableWidth - ((columnCount - 1) * gutter)) /
        columnCount;

    var left =
        usableLeft +
        (currentColumn * (columnWidth + gutter));

    var right =
        left + columnWidth;

    appendRenderLog(
        "Layout Bounds => columns=" + columnCount +
        ", currentColumn=" + currentColumn +
        ", left=" + left +
        ", right=" + right +
        (footerReserve ? (", footerReserve=" + footerReserve) : "")
    );

    return {
        top: bounds[0] + topMargin,
        left: left,
        bottom: usableBottom,
        right: right
    };
}

function getFullPageMarginBounds(page) {
    var bounds;
    var margins;
    var topMargin;
    var leftMargin;
    var bottomMargin;
    var rightMargin;

    try {
        bounds = page.bounds;
    } catch (boundsError) {
        bounds = [0, 0, 792, 612];
    }

    try {
        margins = page.marginPreferences;
        topMargin = margins.top;
        leftMargin = margins.left;
        bottomMargin = margins.bottom;
        rightMargin = margins.right;
    } catch (marginError) {
        topMargin = 72;
        leftMargin = 72;
        bottomMargin = 72;
        rightMargin = 72;
    }

    return {
        top: bounds[0] + topMargin,
        left: bounds[1] + leftMargin + getContentLeftInset(),
        bottom: bounds[2] - bottomMargin,
        right: bounds[3] - rightMargin
    };
}

/**
 * Opener hero images run edge to edge, so they ignore the page margins used by
 * body copy. Vertical bounds stay column-based for page-break math.
 */
function getFullBleedBounds(page, layoutBounds) {
    var bounds;

    try {
        bounds = page.bounds;
    } catch (boundsError) {
        return layoutBounds;
    }

    return {
        // The image starts where body copy starts (margin + theme inset); that
        // strip is filled with a color block instead (placeOpenerImageInsetBand).
        top: layoutBounds.top,
        left: getContentLeftInset() > 0 ? layoutBounds.left : bounds[1],
        bottom: layoutBounds.bottom,
        right: bounds[3]
    };
}

/** Paints the theme color block in the strip left of a full-bleed opener image. */
function placeOpenerImageInsetBand(page, imageFrame, fillHex) {
    var imageBounds;
    var pageLeft;
    var band;

    if (!page || !imageFrame || !fillHex) {
        return;
    }

    try {
        imageBounds = imageFrame.geometricBounds;
        pageLeft = page.bounds[1];
    } catch (boundsError) {
        return;
    }

    if (imageBounds[1] - pageLeft < 1) {
        return;
    }

    try {
        band = page.rectangles.add({
            geometricBounds: [imageBounds[0], pageLeft, imageBounds[2], imageBounds[1]]
        });
        band.strokeWeight = 0;
        assignFrameToContentLayer(band);
        clearRuntimeLabel(band);
        applyFrameFillColor(band, { backgroundColor: fillHex });
        appendRenderLog("Opener image inset band placed (" + fillHex + ")");
    } catch (bandError) {
        warnings.push("Could not place opener image inset band: " + bandError.message);
    }
}

/**
 * Keep a placed image inside the remaining column height, shrinking it
 * proportionally (and re-centering) rather than letting it run off the page.
 */
function constrainImageFrameHeight(frame, maxBottom, boundsLeft, boundsRight) {
    var bounds;
    var height;
    var width;
    var available;
    var scale;
    var newWidth;
    var newLeft;

    try {
        bounds = frame.geometricBounds;
    } catch (boundsError) {
        return;
    }

    height = bounds[2] - bounds[0];
    width = bounds[3] - bounds[1];
    available = maxBottom - bounds[0];

    if (available < 48 || height <= available) {
        return;
    }

    scale = available / height;
    newWidth = width * scale;
    newLeft = boundsLeft + ((boundsRight - boundsLeft) - newWidth) / 2;

    try {
        frame.geometricBounds = [
            bounds[0],
            newLeft,
            bounds[0] + available,
            newLeft + newWidth
        ];
        frame.fit(FitOptions.FILL_PROPORTIONALLY);
        appendRenderLog(
            "Image constrained to column height => width=" + newWidth +
            " height=" + available
        );
    } catch (constrainError) {}
}

/**
 * Widens the opener figure caption to the page edges and paints the theme's
 * caption band behind it. The text keeps its body-copy left alignment through
 * the frame inset, and the band height is fitted to the wrapped lines.
 */
function applyOpenerCaptionBand(frame, page, fillHex, textInset) {
    var bounds;
    var pageBounds;
    var padY = 6;
    var padRight = 24;
    var pass;
    var story;
    var nextFrame;
    var contentBottom;
    var roomyBottom;

    if (!frame || !fillHex) {
        return;
    }

    try {
        bounds = frame.geometricBounds;
        pageBounds = page.bounds;
    } catch (boundsError) {
        return;
    }

    try {
        frame.geometricBounds = [bounds[0], pageBounds[1], bounds[2], pageBounds[3]];
        frame.textFramePreferences.insetSpacing = [
            padY,
            Math.max(textInset, padRight),
            padY,
            padRight
        ];
    } catch (widenError) {
        return;
    }

    // Any text that spilled into a threaded frame belongs in the band.
    try {
        nextFrame = frame.nextTextFrame;
        if (nextFrame) {
            frame.nextTextFrame = null;
            try {
                nextFrame.remove();
            } catch (removeNextError) {}
        }
    } catch (unthreadError) {}

    // Re-fit the height for the new width by growing generously first and then
    // shrinking to the last rendered baseline: the overflow flag is unreliable
    // immediately after a frame resize, so it cannot drive the fit alone.
    try {
        bounds = frame.geometricBounds;
        roomyBottom = Math.min(bounds[0] + 240, pageBounds[2] - 12);
        if (roomyBottom > bounds[2]) {
            frame.geometricBounds = [bounds[0], bounds[1], roomyBottom, bounds[3]];
        }
    } catch (expandError) {}

    try {
        story = frame.parentStory;
        if (story) {
            story.recompose();
        }
        app.activeDocument.recompose();
    } catch (recomposeBandError) {}

    try {
        bounds = frame.geometricBounds;
        contentBottom = getTextFrameBottomY(frame) + padY;
        if (contentBottom > bounds[0] + padY * 2 && contentBottom < bounds[2]) {
            frame.geometricBounds = [bounds[0], bounds[1], contentBottom, bounds[3]];
        }
    } catch (shrinkBandError) {}

    // Safety net in case the baseline-driven fit came up short.
    for (pass = 0; pass < 120; pass++) {
        try {
            story = frame.parentStory;
            if (story) {
                story.recompose();
            }
            app.activeDocument.recompose();
        } catch (recomposeError) {}

        if (!textFrameOverflows(frame)) {
            break;
        }

        try {
            bounds = frame.geometricBounds;
            frame.geometricBounds = [bounds[0], bounds[1], bounds[2] + 2, bounds[3]];
        } catch (growError) {
            break;
        }
    }

    applyFrameFillColor(frame, { backgroundColor: fillHex });

    try {
        bounds = frame.geometricBounds;
        appendRenderLog(
            "Opener caption band applied (" + fillHex + ", full width, height=" +
            (bounds[2] - bounds[0]) + ", overset=" + textFrameOverflows(frame) + ")"
        );
    } catch (logError) {}
}

function getFrameHeight(frame, fallbackHeight) {
    var bounds;

    try {
        bounds = frame.geometricBounds;
        if (bounds && bounds.length === 4) {
            return bounds[2] - bounds[0];
        }
    } catch (heightError) {}

    return fallbackHeight;
}

function clearRuntimeLabel(frame) {
    try {
        frame.label = "";
    } catch (labelError) {}
}

function relocatePrototypesOffPage(document) {
    var i;
    var item;
    var label;
    var bounds;
    var height;
    var offPageTop = DYNAMIC_LAYOUT.prototypeOffPageTop;

    for (i = 0; i < document.allPageItems.length; i++) {
        item = document.allPageItems[i];
        label = trimString(getItemLabel(item));
        if (!isPrototypeLabel(label)) {
            continue;
        }

        try {
            bounds = item.geometricBounds;
            height = bounds[2] - bounds[0];
            item.geometricBounds = [offPageTop - height, bounds[1], offPageTop, bounds[3]];
        } catch (moveError) {
            warnings.push('Could not relocate prototype "' + label + '".');
        }
    }
}

function removeNonPrototypeItemsFromPage(page) {
    var i;
    var item;
    var label;
    var itemsToRemove = [];

    for (i = 0; i < page.pageItems.length; i++) {
        item = page.pageItems[i];
        label = trimString(getItemLabel(item));
        if (isPrototypeLabel(label)) {
            continue;
        }
        itemsToRemove.push(item);
    }

    for (i = itemsToRemove.length - 1; i >= 0; i--) {
        try {
            itemsToRemove[i].remove();
        } catch (removeError) {}
    }
}

function validateDynamicPrototypes(document) {
    var blockType;
    var entry;
    var missing = [];

    for (blockType in BLOCK_REGISTRY) {
        if (!BLOCK_REGISTRY.hasOwnProperty(blockType)) {
            continue;
        }

        entry = BLOCK_REGISTRY[blockType];

        if (entry.kind === "text" && entry.prototype) {
            if (findPageItemByLabel(document, entry.prototype) === null) {
                missing.push(entry.prototype);
            }
        }

        if (entry.kind === "image") {
            if (entry.framePrototype && findPageItemByLabel(document, entry.framePrototype) === null) {
                missing.push(entry.framePrototype);
            }
            if (entry.captionPrototype && findPageItemByLabel(document, entry.captionPrototype) === null) {
                missing.push(entry.captionPrototype);
            }
        }
    }

    return missing;
}

function createLayoutState(document, page) {
    var bounds = getPageLayoutBounds(page);

    return {
        document: document,
        page: page,
        cursorY: bounds.top,
        blockGap: DYNAMIC_LAYOUT.blockGap,
        columnCount: 1,
        currentColumn: 0,
        gutter: 18,
        pageType: "opener",
        footerReserve: 0,
        lastImageFrame: null,
        lastImageHadCaption: false
    };
}

function addLayoutPage(layoutState) {
    layoutState.page = layoutState.document.pages.add();
    layoutState.currentColumn = 0;
    layoutState.cursorY = getPageLayoutBounds(layoutState.page).top;
}

function resolveBlockSpacing(registryEntry) {
    // Per-block-type spacing (in points) so spacing mirrors the source document's
    // varying paragraph spacing. Falls back to the uniform blockGap when a block
    // type does not define spacingAfter.
    if (registryEntry && registryEntry.spacingAfter !== undefined && registryEntry.spacingAfter !== null) {
        return registryEntry.spacingAfter;
    }
    return DYNAMIC_LAYOUT.blockGap;
}

function ensureLayoutSpace(layoutState, requiredHeight) {
    var bounds = getPageLayoutBounds(layoutState.page);
    var needed = requiredHeight || DYNAMIC_LAYOUT.minTextFrameHeight;

    if (layoutState.cursorY + needed > bounds.bottom) {

        // move to second column first
        if (
            layoutState.columnCount === 2 &&
            layoutState.currentColumn === 0
        ) {
            layoutState.currentColumn = 1;
            layoutState.cursorY =
                getPageLayoutBounds(layoutState.page).top;

            appendRenderLog(
                "Switching to column 2 on page " +
                layoutState.page.name
            );

            return getPageLayoutBounds(layoutState.page);
        }

        // second column also full -> next page
        addLayoutPage(layoutState);
        layoutState.currentColumn = 0;
        bounds = getPageLayoutBounds(layoutState.page);
    }

    return bounds;
}

function advanceLayoutCursor(layoutState, frame, gapAfter) {
    var chainEnd;
    var gap = gapAfter !== undefined && gapAfter !== null ? gapAfter : 0;
    var story;
    var bounds;

    chainEnd = getLastFrameInChain(frame);
    syncLayoutPageFromFrame(layoutState, chainEnd);

    try {
        story = chainEnd.parentStory;
        if (story) {
            story.recompose();
        }
    } catch (recomposeStoryError) {}
    try {
        layoutState.document.recompose();
    } catch (recomposeDocError) {}

    try {
        if (chainEnd.contents !== undefined && !chainEnd.nextTextFrame && !textFrameOverflows(chainEnd)) {
            if (isBorderedTextFrame(chainEnd)) {
                tightenTextFrameToRenderedContent(chainEnd, {
                    preserveColumnWidth: true,
                    borderPad: 10
                });
            } else {
                tightenTextFrameToRenderedContent(chainEnd);
            }
        }
    } catch (textTightenError) {}

    try {
        story = chainEnd.parentStory;
        if (story) {
            story.recompose();
        }
    } catch (recomposeCursorStoryError) {}
    try {
        layoutState.document.recompose();
    } catch (recomposeCursorDocError) {}

    bounds = chainEnd.geometricBounds;

    if (chainEnd.contents !== undefined && !chainEnd.nextTextFrame && !textFrameOverflows(chainEnd)) {
        if (isBorderedTextFrame(chainEnd)) {
            // Keep full column width; only nudge cursor from final bordered frame bottom.
            refreshFrameBordersFromLabels(chainEnd);
            layoutState.cursorY = chainEnd.geometricBounds[2] + gap;
        } else {
            shrinkTextFrameToContentBottom(chainEnd);
            layoutState.cursorY = getTextFrameBottomY(chainEnd) + gap;
        }
    } else {
        layoutState.cursorY = bounds[2] + gap;
    }
}

function advanceLayoutCursorAfterImageBlock(layoutState, imageFrame, captionFrame, gapAfter) {
    var imageBottom;
    var captionBottom;
    var captionEnd;
    var blockBottom;
    var gap = gapAfter;

    if (!imageFrame) {
        return;
    }

    if (gap === undefined || gap === null || gap < DYNAMIC_LAYOUT.afterImageGap) {
        gap = DYNAMIC_LAYOUT.afterImageGap;
    }

    syncLayoutPageFromFrame(layoutState, captionFrame || imageFrame);

    imageBottom = getImageContentBottomY(imageFrame);
    blockBottom = imageBottom;

    if (captionFrame) {
        captionEnd = getLastFrameInChain(captionFrame);
        try {
            if (captionEnd.parentStory) {
                captionEnd.parentStory.recompose();
            }
        } catch (recomposeCaptionError) {}
        shrinkTextFrameToContentBottom(captionEnd);
        captionBottom = getTextFrameBottomY(captionEnd);
        if (!(captionBottom > 0)) {
            captionBottom = getFrameBottomY(captionEnd);
        }
        if (captionBottom > blockBottom) {
            blockBottom = captionBottom;
        }
    }

    layoutState.cursorY = blockBottom + gap;
    appendRenderLog(
        "Image block cursorY: " + layoutState.cursorY +
        " (bottom=" + blockBottom + ", gap=" + gap + ")"
    );
}

function pageHasPrototypeItems(page) {
    var i;
    var items;
    var label;

    try {
        items = page.pageItems;
    } catch (pageItemsError) {
        return false;
    }

    for (i = 0; i < items.length; i++) {
        label = trimString(getItemLabel(items[i]));
        if (isPrototypeLabel(label)) {
            return true;
        }
    }

    return false;
}

function findPageIndexWithPrototypes(document) {
    var p;

    for (p = 0; p < document.pages.length; p++) {
        if (pageHasPrototypeItems(document.pages[p])) {
            return p;
        }
    }

    return -1;
}

function collapseToSinglePrototypePage(document) {
    var protoPageIndex;

    protoPageIndex = findPageIndexWithPrototypes(document);

    if (protoPageIndex < 0) {
        while (document.pages.length > 1) {
            document.pages[document.pages.length - 1].remove();
        }
        return;
    }

    while (document.pages.length - 1 > protoPageIndex) {
        document.pages[document.pages.length - 1].remove();
    }

    while (protoPageIndex > 0) {
        document.pages[0].remove();
        protoPageIndex -= 1;
    }
}

function setFrameColumnBounds(frame, layoutBounds, top, height) {
    frame.geometricBounds = [top, layoutBounds.left, top + height, layoutBounds.right];
}

function restoreCleanTemplateState(document) {
    removeAllRuntimeContent(document);

    while (document.pages.length > 1) {
        document.pages[document.pages.length - 1].remove();
    }

    relocatePrototypesOffPage(document);
    appendRenderLog("Template restored: 1 page with prototypes only (safe to save .indd)");
}

function prepareTemplateForDynamicLayout(document) {
    var page;
    var missingProtos;
    var foundProtos;
    var p;

    contentLayer = ensureContentLayer(document);
    try {
        contentLayer.visible = true;
        contentLayer.printable = true;
    } catch (layerVisError) {}

    normalizeDocumentForDynamicLayout(document);
    appendRenderLog("Facing pages disabled for layout (required for dynamic flow)");

    foundProtos = listPrototypeLabels(document);
    appendRenderLog("Script version: " + POPULATE_SCRIPT_VERSION);
    appendRenderLog("Prototypes in template: " + (foundProtos.length ? foundProtos.join(", ") : "(none found)"));

    missingProtos = validateDynamicPrototypes(document);
    for (p = 0; p < missingProtos.length; p++) {
        warnings.push('Missing prototype frame "' + missingProtos[p] + '" in InDesign template.');
    }

    cachePrototypeMetrics(document);
    clearPrototypeFrameContents(document);
    removeAllRuntimeContent(document);
    collapseToSinglePrototypePage(document);

    page = document.pages[0];
    removeNonPrototypeItemsFromPage(page);
    relocatePrototypesOffPage(document);
    setPrototypesLayerNonPrinting(document);
    layoutState = createLayoutState(document, page);

    appendRenderLog("Dynamic layout: cleared stale content, ready for JSON-only render");
    appendRenderLog("Content layer: " + contentLayer.name);
}

/** Theme 2 chapter number is a filled full-width bar; theme 1 is plain text. */
function chapterNumberHasBarFill(style) {
    return !!(style && style.backgroundColor);
}

function resolveChapterNumberGapAfter(style) {
    // Theme 2 keeps the existing gap under the orange bar.
    // Theme 1 has no bar padding, so a large shared gap looks like empty space.
    return chapterNumberHasBarFill(style) ? 28 : 6;
}

/** Theme 2 outline/LO items keep roomy gaps; theme 1 is compact 9pt stacked text. */
function usesRoomyOverviewSpacing() {
    return isCompositeStyle(FRAME_STYLES.lessonOverview) ||
        chapterNumberHasBarFill(FRAME_STYLES.chapterNumber);
}

function resolveChapterOverviewSpacingAfter() {
    return usesRoomyOverviewSpacing() ? 8 : 4;
}

function resolveLessonOverviewSpacingAfter() {
    return usesRoomyOverviewSpacing() ? 24 : 4;
}

function resolveLessonOverviewSpacingBefore() {
    return usesRoomyOverviewSpacing() ? 14 : 2;
}

/**
 * Theme 2's oversized chapter title needs a generous gap before the hero image.
 * Theme 1 sets the title straight above the image, so keep it tight.
 */
function resolveChapterTitleSpacingAfter() {
    return chapterNumberHasBarFill(FRAME_STYLES.chapterNumber) ? 36 : 10;
}

/** Extra air after the last LessonOverview item before body copy resumes. */
function resolveLessonOverviewTailGap() {
    return usesRoomyOverviewSpacing() ? 20 : 14;
}

/** Full-width ChapterNumber bar with visible left-aligned text (no FRAME_TO_CONTENT). */
function placeChapterNumberBar(layoutState, text, style) {
    var layoutBounds;
    var pointSize;
    var barHeight;
    var padY;
    var padX;
    var frameTop;
    var frame;
    var story;
    var textRange;
    var appliedStyle;
    var gapAfter;
    var isBar;
    var barRuns;
    var bleedBounds;

    appliedStyle = style || FRAME_STYLES.chapterNumber || FRAME_STYLES_DEFAULTS.chapterNumber;
    pointSize = (appliedStyle && appliedStyle.pointSize) || 36;
    isBar = chapterNumberHasBarFill(appliedStyle);
    padY = isBar ? 14 : 0;
    padX = isBar ? 12 : 0;
    barHeight = isBar ? (pointSize + padY * 2) : (pointSize + 4);
    gapAfter = resolveChapterNumberGapAfter(appliedStyle);

    layoutBounds = ensureLayoutSpace(layoutState, barHeight);
    frameTop = layoutState.cursorY;

    // On opener pages the bar sits directly under the full-bleed hero image, so
    // it runs edge to edge too; the label keeps its margin alignment via inset.
    if (isBar && isOpenerLayoutPage(layoutState) && (layoutState.columnCount || 1) === 1) {
        bleedBounds = getFullBleedBounds(layoutState.page, layoutBounds);
        padX = Math.max(padX, layoutBounds.left - bleedBounds.left);
        layoutBounds = bleedBounds;
    }

    frame = createTextFrameOnPage(
        layoutState.page,
        layoutBounds,
        frameTop,
        barHeight
    );
    barRuns = setFrameContentsWithMarkup(frame, text);

    try {
        frame.textFramePreferences.verticalJustification =
            VerticalJustification.CENTER_ALIGN;
        frame.textFramePreferences.insetSpacing = [padY, padX, padY, padX];
    } catch (prefError) {}

    // Apply typography directly — do not call flow/tighten paths.
    try {
        story = frame.parentStory;
        textRange = story && story.texts.length ? story.texts[0] : null;
        if (textRange) {
            if (appliedStyle.pointSize) {
                textRange.pointSize = appliedStyle.pointSize;
            }
            applyThemeFontAndEmphasis(textRange, appliedStyle);
            applyTextColor(textRange, appliedStyle);
            if (story.paragraphs.length) {
                story.paragraphs[0].justification = Justification.LEFT_ALIGN;
                story.paragraphs[0].spaceBefore = 0;
                story.paragraphs[0].spaceAfter = 0;
                story.paragraphs[0].leftIndent = 0;
                story.paragraphs[0].firstLineIndent = 0;
            }
        }
    } catch (styleError) {
        warnings.push("ChapterNumber text style failed: " + styleError.message);
    }

    applyInlineMarkupRuns(frame, dropRunColors(barRuns), appliedStyle);

    applyFrameFillColor(frame, appliedStyle);

    try {
        if (frame.overflows === true) {
            frame.geometricBounds = [
                frameTop,
                layoutBounds.left,
                frameTop + barHeight + 12,
                layoutBounds.right
            ];
        }
    } catch (growError) {}

    // Advance cursor without tightenTextFrameToRenderedContent.
    syncLayoutPageFromFrame(layoutState, frame);
    try {
        layoutState.cursorY = frame.geometricBounds[2] + gapAfter;
    } catch (cursorError) {
        layoutState.cursorY = frameTop + barHeight + gapAfter;
    }

    appendRenderLog(
        "ChapterNumber bar placed full-width left-aligned: \"" + text + "\""
    );
    return frame;
}

function populateDynamicTextBlock(layoutState, document, registryEntry, itemType, data, blockIndex) {
    var protoLabel = registryEntry.prototype;
    var protoResult;
    var protoFrame;
    var protoHeight;
    var frame;
    var cleanText = applySingleItemListMarker(
        layoutState,
        itemType,
        data,
        getBlockText(data, itemType === "NumberedList" ? "numbered" : null)
    );

    appendRenderLog("---");
    appendRenderLog("JSON block type: " + itemType);
    appendRenderLog("Dynamic prototype: " + protoLabel);
    appendRenderLog("Occurrence: " + blockIndex);
    appendRenderLog("Text length: " + cleanText.length);

    if (!cleanText || isPlaceholderText(cleanText)) {
        appendRenderLog("Status: not populated - empty or placeholder text in JSON");
        return;
    }

    // Opener only: PartNumber sits on the hero image (top-left), not in flow.
    if (
        itemType === "PartNumber" &&
        isOpenerLayoutPage(layoutState) &&
        layoutState.lastImageFrame
    ) {
        placeOpenerPartNumberOverlay(
            layoutState,
            layoutState.lastImageFrame,
            cleanText,
            registryEntry.style
        );
        return;
    }

    // ChapterNumber: dedicated full-width bar — never go through flowDynamicText /
    // advanceLayoutCursor tighten (FRAME_TO_CONTENT was wiping the text).
    if (itemType === "ChapterNumber" || itemType === "ChapterHeading") {
        // Opener hero: sit almost flush under the image only when there is no
        // caption below it. Pulling back over a caption overlaps FIGURE text.
        if (layoutState.lastImageFrame && !layoutState.lastImageHadCaption) {
            try {
                var imgBottom = getImageContentBottomY(layoutState.lastImageFrame);
                if (layoutState.cursorY - imgBottom <= 24) {
                    layoutState.cursorY = imgBottom + 3;
                }
            } catch (flushError) {}
        }
        try {
            frame = placeChapterNumberBar(
                layoutState,
                cleanText,
                registryEntry.style || FRAME_STYLES.chapterNumber
            );
            populatedCount += 1;
            appendRenderLog(
                "Status: populated chapter bar (text=\"" + cleanText + "\")"
            );
        } catch (chapterBarError) {
            appendRenderLog("Status: not populated - " + chapterBarError.message);
            warnings.push(
                'Could not place ChapterNumber bar #' + blockIndex + ": " + chapterBarError.message
            );
        }
        return;
    }

    protoResult = resolveTextPrototype(document, protoLabel);
    if (protoResult === null) {
        appendRenderLog("Prototype found: no");
        appendRenderLog("Status: not populated - prototype frame not found in template");
        warnings.push('Skipped dynamic "' + itemType + '" #' + blockIndex + ': prototype "' + protoLabel + '" not found.');
        return;
    }

    protoFrame = protoResult.frame;
    appendRenderLog("Prototype found: yes" + (protoResult.usedFallback ? " (via " + protoResult.label + " fallback)" : ""));

    protoHeight = getDynamicTextSeedHeight(
        protoResult.usedFallback ? protoResult.label : protoLabel,
        protoResult.usedFallback ? protoLabel : null
    );

    try {
        frame = flowDynamicText(
            layoutState,
            cleanText,
            registryEntry.style,
            DYNAMIC_LAYOUT.minTextFrameHeight,
            protoHeight
        );
        advanceLayoutCursor(layoutState, frame, resolveBlockSpacing(registryEntry));
        populatedCount += 1;
        appendRenderLog("Status: populated (dynamic frame created on Content layer)");
    } catch (textError) {
        appendRenderLog("Status: not populated - " + textError.message);
        warnings.push('Could not create dynamic text frame for "' + itemType + '" #' + blockIndex + ": " + textError.message);
    }
}

function findPrecedingTextFrameNearCursor(layoutState) {
    var items;
    var i;
    var item;
    var label;
    var bounds;
    var frameTop;
    var frameBottom;
    var bestFrame = null;
    var bestFrameBottom = -1;
    var cursorY = layoutState.cursorY;

    try {
        items = layoutState.page.pageItems;
    } catch (pageItemsError) {
        return null;
    }

    for (i = 0; i < items.length; i++) {
        item = items[i];
        label = trimString(getItemLabel(item));
        if (isPrototypeLabel(label)) {
            continue;
        }

        try {
            if (item.contents === undefined || item.nextTextFrame) {
                continue;
            }
        } catch (contentsCheckError) {
            continue;
        }

        try {
            bounds = item.geometricBounds;
            frameTop = bounds[0];
            frameBottom = bounds[2];
            // Match when cursor sits at the frame bottom OR inside slack below rendered text.
            if (frameBottom + 2 < cursorY) {
                continue;
            }
            if (frameTop > cursorY + 2) {
                continue;
            }
            if (frameBottom > bestFrameBottom) {
                bestFrameBottom = frameBottom;
                bestFrame = item;
            }
        } catch (matchError) {}
    }

    return bestFrame;
}

function compactCursorYBeforeImage(layoutState) {
    var precedingFrame;
    var contentBottom;
    var previousCursorY = layoutState.cursorY;

    precedingFrame = findPrecedingTextFrameNearCursor(layoutState);
    if (precedingFrame === null) {
        return;
    }

    shrinkTextFrameToContentBottom(precedingFrame);
    contentBottom = getTextFrameBottomY(precedingFrame);
    if (contentBottom > 0 && contentBottom < layoutState.cursorY) {
        layoutState.cursorY = contentBottom;
    }

    if (layoutState.cursorY !== previousCursorY) {
        appendRenderLog(
            "Image layout cursorY compacted: " + previousCursorY + " -> " + layoutState.cursorY
        );
    }
}

function populateDynamicImageBlock(layoutState, document, registryEntry, data, blockIndex, scriptFolder) {
    var frameProtoLabel = registryEntry.framePrototype;
    var captionProtoLabel = registryEntry.captionPrototype;
    var imageProto;
    var captionProto;
    var captionProtoResult;
    var layoutBounds;
    var imageFrame;
    var captionFrame;
    var imageFile;
    var protoHeight;
    var cleanCaption;
    var fullBleed = false;
    var captionGap = DYNAMIC_LAYOUT.imageCaptionGap;
    var urlOrPath = data.url;
    var scaleResult = resolveImageScalePercent(data, layoutState);
    var scalePercent = scaleResult.scalePercent;

    appendRenderLog("---");
    appendRenderLog("JSON block type: Image");
    appendRenderLog("Dynamic prototype: " + frameProtoLabel);
    appendRenderLog("Occurrence: " + blockIndex);
    appendRenderLog("Image path: " + (urlOrPath ? urlOrPath : "(empty)"));
    if (scaleResult.formatColumns === 2) {
        appendRenderLog("Image scale_percent: 100% (2-column format; JSON scale ignored)");
    } else if (scaleResult.fromJson) {
        appendRenderLog(
            "Image scale_percent: " + scalePercent +
            "% (JSON scale_percent=" + scaleResult.jsonValue +
            "; JSON is authoritative)"
        );
    } else {
        appendRenderLog(
            "Image scale_percent: " + scalePercent +
            "% (JSON scale_percent missing/invalid; default 100% of current column)"
        );
    }

    if (!urlOrPath) {
        appendRenderLog("Status: not populated — empty image url in JSON");
        return;
    }

    imageProto = findPageItemByLabel(document, frameProtoLabel);
    if (imageProto === null) {
        appendRenderLog("Prototype found: no (using default graphic frame size)");
        warnings.push('Image prototype "' + frameProtoLabel + '" not found; using default graphic frame size.');
        protoHeight = DYNAMIC_LAYOUT.defaultImageFrameHeight;
    } else {
        appendRenderLog("Prototype found: yes");
        protoHeight = getFrameHeight(imageProto, DYNAMIC_LAYOUT.defaultImageFrameHeight);
        // if (protoHeight < 48) {
        //     protoHeight = DYNAMIC_LAYOUT.defaultImageFrameHeight;
        // }
    }

    imageFile = resolveImageFile(urlOrPath, scriptFolder, blockIndex);
    if (imageFile === null) {
        appendRenderLog("Status: not populated — image file not found on disk");
        warnings.push('Image file not found for "' + urlOrPath + '".');
        return;
    }

    appendRenderLog("Image block cursor trace [entry]: cursorY=" + layoutState.cursorY);
    appendRenderLog("Image block cursor trace [before compactCursorYBeforeImage]: cursorY=" + layoutState.cursorY);
    compactCursorYBeforeImage(layoutState);
    appendRenderLog("Image block cursor trace [after compactCursorYBeforeImage]: cursorY=" + layoutState.cursorY);

    appendRenderLog("Image block cursor trace [before ensureLayoutSpace]: cursorY=" + layoutState.cursorY);

    if (layoutState.columnCount === 2) {
        layoutBounds = ensureLayoutSpace(layoutState, protoHeight);
        appendRenderLog(
            "Image 2-column bounds => left=" + layoutBounds.left +
            ", right=" + layoutBounds.right
        );
    } else {
        layoutBounds = getFullPageMarginBounds(layoutState.page);
        if (layoutState.cursorY < layoutBounds.top) {
            layoutState.cursorY = layoutBounds.top;
        }
        // Opener hero images bleed past the side margins to the page edges.
        if (isOpenerLayoutPage(layoutState)) {
            layoutBounds = getFullBleedBounds(layoutState.page, layoutBounds);
            fullBleed = true;
            if (getOpenerCaptionBackground()) {
                captionGap = 0;
            }
        }
        appendRenderLog(
            "Image " + (fullBleed ? "full-bleed" : "full-page") + " bounds => left=" +
            layoutBounds.left + ", right=" + layoutBounds.right
        );
    }
    appendRenderLog("Image block cursor trace [after ensureLayoutSpace]: cursorY=" + layoutState.cursorY);

    appendRenderLog("Image block cursor trace [before createGraphicFrameOnPage]: cursorY=" + layoutState.cursorY);
    try {
        imageFrame = createGraphicFrameOnPage(layoutState.page, layoutBounds, layoutState.cursorY, protoHeight);
        appendRenderLog("Image block cursor trace [after createGraphicFrameOnPage]: cursorY=" + layoutState.cursorY);
        if (!placeImageContentInFrame(imageFrame, imageFile, scalePercent)) {
            appendRenderLog("Status: not populated — graphic not visible after place/fit");
            warnings.push('Image #' + blockIndex + ' place/fit did not produce a visible graphic.');
            try {
                imageFrame.remove();
            } catch (removeFailedFrameError) {}
            return;
        }
        cleanCaption = trimString(data.caption || data.text || "");
        if (fullBleed) {
            constrainImageFrameHeight(
                imageFrame,
                getFullPageMarginBounds(layoutState.page).bottom -
                    (cleanCaption ? DYNAMIC_LAYOUT.imageCaptionReserve : 0),
                layoutBounds.left,
                layoutBounds.right
            );
            placeOpenerImageInsetBand(
                layoutState.page,
                imageFrame,
                getOpenerImageInsetBackground()
            );
        }
        populatedCount += 1;
        layoutState.lastImageFrame = imageFrame;
        layoutState.lastImageHadCaption = false;
        appendRenderLog("Resolved image file: " + imageFile.fsName);
        appendRenderLog("Image status: populated (dynamic frame created on Content layer)");

        if (!cleanCaption) {
            advanceLayoutCursorAfterImageBlock(layoutState, imageFrame, null, resolveBlockSpacing(registryEntry));
            return;
        }

        captionProtoResult = resolveTextPrototype(document, captionProtoLabel);
        if (captionProtoResult === null) {
            appendRenderLog("Caption prototype found: no");
            warnings.push('Image #' + blockIndex + ' placed but no caption prototype or "' + PROTOTYPE_TEXT_FALLBACK + '" fallback found.');
            advanceLayoutCursorAfterImageBlock(layoutState, imageFrame, null, resolveBlockSpacing(registryEntry));
            return;
        }

        syncLayoutPageFromFrame(layoutState, imageFrame);
        // Leave a small gap between the image and its caption so the caption
        // does not sit flush against the image (spacing is config-driven).
        // A banded opener caption is the exception: its band butts the image.
        layoutState.cursorY = getImageContentBottomY(imageFrame) + captionGap;
    } catch (imageError) {
        appendRenderLog("Status: not populated — " + imageError.message);
        warnings.push('Could not create dynamic image frame #' + blockIndex + ": " + imageError.message);
        return;
    }

    captionProto = captionProtoResult.frame;
    appendRenderLog("Caption prototype found: yes" + (captionProtoResult.usedFallback ? " (via fallback)" : ""));

    protoHeight = getFrameHeight(captionProto, DYNAMIC_LAYOUT.minTextFrameHeight);
    if (protoHeight < DYNAMIC_LAYOUT.minTextFrameHeight) {
        protoHeight = DYNAMIC_LAYOUT.minTextFrameHeight;
    }

    // Reserve only a single-line minimum (not the full caption prototype height)
    // so the caption stays directly below the image instead of breaking early
    // and leaving blank space at the bottom of the page. flowDynamicText() still
    // handles the real page break and overflow threading internally.
    layoutBounds = ensureLayoutSpace(layoutState, DYNAMIC_LAYOUT.minTextFrameHeight);

    try {
        layoutState.cursorY = imageFrame.geometricBounds[2] + captionGap;
        captionFrame = flowDynamicText(
            layoutState,
            cleanCaption,
            registryEntry.style,
            DYNAMIC_LAYOUT.minTextFrameHeight,
            getDynamicTextSeedHeight(
                captionProtoResult.usedFallback ? captionProtoResult.label : captionProtoLabel,
                captionProtoResult.usedFallback ? captionProtoLabel : null
            )
        );
        applyFigureCaptionPrefixStyle(captionFrame, cleanCaption);
        if (fullBleed && getOpenerCaptionBackground()) {
            applyOpenerCaptionBand(
                captionFrame,
                layoutState.page,
                getOpenerCaptionBackground(),
                getFullPageMarginBounds(layoutState.page).left - layoutState.page.bounds[1]
            );
        }
        growTextFrameToFitContent(captionFrame);
        populatedCount += 1;
        layoutState.lastImageHadCaption = true;
        appendRenderLog("Caption status: populated (dynamic frame created on Content layer)");
        advanceLayoutCursorAfterImageBlock(layoutState, imageFrame, captionFrame, resolveBlockSpacing(registryEntry));
    } catch (captionError) {
        warnings.push('Could not create dynamic caption for Image #' + blockIndex + ": " + captionError.message);
        advanceLayoutCursorAfterImageBlock(layoutState, imageFrame, null, resolveBlockSpacing(registryEntry));
    }
}

function createLogoGraphicFrame(page, proto, top, left, width, height) {
    var frame = page.rectangles.add({
        geometricBounds: [top, left, top + height, left + width]
    });

    if (proto) {
        try {
            if (proto.appliedObjectStyle) {
                frame.applyObjectStyle(proto.appliedObjectStyle);
            }
        } catch (styleError) {}

        try {
            frame.strokeWeight = proto.strokeWeight;
            frame.strokeColor = proto.strokeColor;
            frame.strokeTint = proto.strokeTint;
            frame.fillColor = proto.fillColor;
            frame.fillTint = proto.fillTint;
        } catch (strokeFillError) {}

        try {
            frame.frameFittingOptions.fittingOnEmptyFrame = proto.frameFittingOptions.fittingOnEmptyFrame;
            frame.frameFittingOptions.fittingAlignment = proto.frameFittingOptions.fittingAlignment;
            frame.frameFittingOptions.autoFit = proto.frameFittingOptions.autoFit;
        } catch (fittingError) {}
    }

    assignFrameToContentLayer(frame);
    clearRuntimeLabel(frame);
    return frame;
}

// LogoWithText renders the logo and its label SIDE BY SIDE. The logo size and
// styling come from proto:logoFrame when present (otherwise a small default so
// it never balloons to full column width); the label is always placed to the
// RIGHT of the logo, filling the rest of the column and vertically centered.
// This is computed in code so the side-by-side result does not depend on the
// exact positions of the two prototypes in the template.
function populateDynamicLogoBlock(layoutState, document, registryEntry, data, blockIndex, scriptFolder) {
    var frameProtoLabel = registryEntry.framePrototype;
    var textProtoLabel = registryEntry.captionPrototype;
    var logoProto;
    var textProto;
    var protoBounds;
    var layoutBounds;
    var logoLeft;
    var logoWidth;
    var logoHeight;
    var textLeft;
    var textWidth;
    var textHeight;
    var top;
    var blockBottom;
    var logoFrame;
    var logoPlaced = false;
    var textFrame;
    var logoTextRuns;
    var imageFile;
    var cleanText = trimString(data.text || data.caption || "");
    var urlOrPath = data.url;
    var DEFAULT_LOGO_SIZE = 24; // points, used only when proto:logoFrame is missing
    var LOGO_TEXT_GAP = 8;      // points between the logo and its label

    appendRenderLog("---");
    appendRenderLog("JSON block type: LogoWithText");
    appendRenderLog("Occurrence: " + blockIndex);
    appendRenderLog("Logo path: " + (urlOrPath ? urlOrPath : "(empty)"));
    appendRenderLog("Logo text: " + (cleanText ? cleanText : "(empty)"));

    logoProto = findPageItemByLabel(document, frameProtoLabel);
    textProto = findPageItemByLabel(document, textProtoLabel);
    layoutBounds = getPageLayoutBounds(layoutState.page);

    if (logoProto !== null) {
        protoBounds = logoProto.geometricBounds;
        logoWidth = protoBounds[3] - protoBounds[1];
        logoHeight = protoBounds[2] - protoBounds[0];
        appendRenderLog("Logo size from proto:logoFrame: " + logoWidth + " x " + logoHeight);
    } else {
        logoWidth = DEFAULT_LOGO_SIZE;
        logoHeight = DEFAULT_LOGO_SIZE;
        appendRenderLog("proto:logoFrame not found; using default logo size " + DEFAULT_LOGO_SIZE);
    }

    logoLeft = layoutBounds.left;
    textHeight = logoHeight;

    imageFile = resolveImageFile(urlOrPath, scriptFolder, blockIndex);

    compactCursorYBeforeImage(layoutState);
    ensureLayoutSpace(layoutState, logoHeight);

    top = layoutState.cursorY;
    blockBottom = top;

    if (imageFile !== null) {
        try {
            logoFrame = createLogoGraphicFrame(layoutState.page, logoProto, top, logoLeft, logoWidth, logoHeight);
            if (placeImageContentInFrame(logoFrame, imageFile)) {
                populatedCount += 1;
                logoPlaced = true;
                appendRenderLog("Logo image status: populated");
                if (getFrameBottomY(logoFrame) > blockBottom) {
                    blockBottom = getFrameBottomY(logoFrame);
                }
            } else {
                appendRenderLog("Logo image not visible after place/fit");
                try {
                    logoFrame.remove();
                } catch (removeLogoError) {}
            }
        } catch (logoError) {
            warnings.push('Could not create logo frame #' + blockIndex + ": " + logoError.message);
        }
    } else {
        appendRenderLog("Logo image file not found on disk; rendering text only.");
        warnings.push('Logo image not found for "' + urlOrPath + '".');
    }

    // Without a logo the label starts at the margin — no reserved empty gap.
    textLeft = logoPlaced ? logoLeft + logoWidth + LOGO_TEXT_GAP : logoLeft;
    textWidth = layoutBounds.right - textLeft;
    if (textWidth < 1) {
        textWidth = layoutBounds.right - layoutBounds.left;
    }

    if (cleanText) {
        try {
            textFrame = layoutState.page.textFrames.add({
                geometricBounds: [top, textLeft, top + textHeight, textLeft + textWidth]
            });
            assignFrameToContentLayer(textFrame);
            clearRuntimeLabel(textFrame);

            // Vertically center the label against the logo. Prefer the text
            // prototype's setting when present, otherwise force center alignment.
            try {
                if (textProto !== null) {
                    textFrame.textFramePreferences.verticalJustification =
                        textProto.textFramePreferences.verticalJustification;
                } else {
                    textFrame.textFramePreferences.verticalJustification =
                        VerticalJustification.CENTER_ALIGN;
                }
            } catch (verticalJustifyError) {}

            logoTextRuns = setFrameContentsWithMarkup(textFrame, cleanText);
            applyFrameStyle(textFrame, registryEntry.style);
            applyInlineMarkupRuns(textFrame, logoTextRuns, registryEntry.style);
            populatedCount += 1;
            appendRenderLog("Logo text status: populated");
            if (getFrameBottomY(textFrame) > blockBottom) {
                blockBottom = getFrameBottomY(textFrame);
            }
        } catch (textError) {
            warnings.push('Could not create logo text #' + blockIndex + ": " + textError.message);
        }
    }

    layoutState.cursorY = blockBottom + resolveBlockSpacing(registryEntry);
    appendRenderLog("LogoWithText cursorY: " + layoutState.cursorY);
}

function splitBodyAndFooters(contentItems) {
    var body = [];
    var footers = [];
    var i;
    var item;
    var itemType;

    for (i = 0; i < contentItems.length; i++) {
        item = contentItems[i];
        itemType = normalizeBlockType(item.type);
        if (itemType === "Footer") {
            footers.push(item);
        } else {
            body.push(item);
        }
    }

    return { body: body, footers: footers };
}

function getFooterDisplayText(data) {
    var left;
    var right;
    var main;
    var parts;

    if (!data) {
        return "";
    }

    left = trimString(data.left || "");
    right = trimString(data.right || "");
    main = trimString(data.text || data.center || "");

    if (left || right) {
        parts = [];
        if (left) {
            parts.push(left);
        }
        if (main) {
            parts.push(main);
        }
        if (right) {
            parts.push(right);
        }
        return parts.join("   ");
    }

    return main;
}

function getPageDocumentOffset(page) {
    try {
        return page.documentOffset;
    } catch (offsetError) {
        return 0;
    }
}

function collectTextFramesInChain(frame) {
    var current = frame;
    var frames = [];

    if (!frame) {
        return frames;
    }

    try {
        while (current.previousTextFrame) {
            current = current.previousTextFrame;
        }
    } catch (walkBackError) {}

    while (current) {
        frames.push(current);
        try {
            current = current.nextTextFrame;
            if (!current) {
                break;
            }
        } catch (walkForwardError) {
            break;
        }
    }

    return frames;
}

function applyQuotationPresentation(frame, quotationStyle, hasAuthor) {
    var frames;
    var i;
    var fillStyle;
    var story;
    var paragraphs;

    if (!frame || !quotationStyle) {
        return;
    }

    frames = collectTextFramesInChain(frame);
    fillStyle = { backgroundColor: quotationStyle.backgroundColor || null };

    for (i = 0; i < frames.length; i++) {
        applyFrameFillColor(frames[i], fillStyle);
        try {
            frames[i].textFramePreferences.insetSpacing = [18, 12, 18, 12];
            frames[i].textFramePreferences.verticalJustification =
                VerticalJustification.TOP_ALIGN;
        } catch (insetError) {}
    }

    if (!hasAuthor || !quotationStyle.author) {
        return;
    }

    try {
        story = frames[0].parentStory;
        paragraphs = story.paragraphs;
        if (paragraphs.length > 1) {
            applyTextRangeStyle(paragraphs[paragraphs.length - 1].texts[0], quotationStyle.author);
        }
    } catch (authorStyleError) {}
}

/**
 * Place quotation (+ author) in one sized frame so text is not truncated by
 * overflow threading / FRAME_TO_CONTENT (matches full web quote block).
 */
function populateDynamicQuotationBlock(layoutState, document, registryEntry, data, blockIndex) {
    var quoteText = fixUtf8Mojibake(trimString(
        (data && (data.text || data.quote || data.quotation)) || ""
    ));
    var author = fixUtf8Mojibake(trimString(
        (data && (data.author || data.attribution || data.source)) || ""
    ));
    var cleanText = quoteText;
    var style = registryEntry.style || FRAME_STYLES.quotation || FRAME_STYLES_DEFAULTS.quotation;
    var textStyle;
    var layoutBounds;
    var colWidth;
    var pointSize;
    var estimatedLines;
    var frameHeight;
    var frameTop;
    var frame;
    var story;
    var textRange;
    var growPass;
    var gapAfter;
    var contentBottom;
    var quoteRuns;

    appendRenderLog("---");
    appendRenderLog("JSON block type: Quotation");
    appendRenderLog("Occurrence: " + blockIndex);

    if (author) {
        cleanText = quoteText ? (quoteText + "\r" + author) : author;
    }

    if (!cleanText || isPlaceholderText(cleanText)) {
        appendRenderLog("Status: not populated - empty quotation");
        return;
    }

    textStyle = (style && style.text) ? style.text : style;
    pointSize = Number(
        (textStyle && (textStyle.pointSize || textStyle.size)) || 13
    );
    layoutBounds = getPageLayoutBounds(layoutState.page);
    colWidth = Math.max(40, layoutBounds.right - layoutBounds.left);
    // ~0.5em average char width; leave room for insets.
    estimatedLines = Math.max(
        2,
        Math.ceil((cleanText.length * pointSize * 0.5) / Math.max(colWidth - 24, 40))
    );
    if (author) {
        estimatedLines += 1;
    }
    frameHeight = Math.max(
        estimatedLines * pointSize * 1.45 + 40,
        pointSize * 3 + 40,
        80
    );

    // Tighten gap above quotation (previous block spacingAfter is usually generous).
    try {
        layoutBounds = getPageLayoutBounds(layoutState.page);
        if (layoutState.cursorY > layoutBounds.top + 8) {
            layoutState.cursorY = Math.max(layoutBounds.top, layoutState.cursorY - 8);
        }
    } catch (tightenTopError) {}

    layoutBounds = ensureLayoutSpace(layoutState, frameHeight);
    frameTop = layoutState.cursorY;
    // If remaining column height is short, take what's left and grow via overflow check.
    try {
        frameHeight = Math.min(
            frameHeight,
            Math.max(
                getAvailableColumnHeight(layoutState),
                DYNAMIC_LAYOUT.minTextFrameHeight
            )
        );
    } catch (availError) {}

    try {
        frame = createTextFrameOnPage(
            layoutState.page,
            layoutBounds,
            frameTop,
            frameHeight
        );
        quoteRuns = setFrameContentsWithMarkup(frame, cleanText);

        try {
            story = frame.parentStory;
            textRange = story && story.texts.length ? story.texts[0] : null;
            if (textRange) {
                if (textStyle.pointSize || textStyle.size) {
                    textRange.pointSize = textStyle.pointSize || textStyle.size;
                }
                applyThemeFontAndEmphasis(textRange, {
                    font: textStyle.font || textStyle.fontFamily,
                    fontFamily: textStyle.fontFamily || textStyle.font,
                    bold: textStyle.bold,
                    italic: textStyle.italic,
                    pointSize: textStyle.pointSize || textStyle.size,
                    color: textStyle.color
                });
                applyTextColor(textRange, textStyle);
            }
            if (story && story.paragraphs.length) {
                story.paragraphs[0].justification = Justification.LEFT_ALIGN;
                story.paragraphs[0].spaceBefore = 0;
                story.paragraphs[0].spaceAfter = 4;
                story.paragraphs[0].leftIndent = 0;
                story.paragraphs[0].firstLineIndent = 0;
            }
        } catch (styleError) {}

        applyQuotationPresentation(frame, style, !!author);

        // Grow frame until the full quote + author fit (no threaded overflow).
        for (growPass = 0; growPass < 12; growPass++) {
            try {
                if (frame.parentStory) {
                    frame.parentStory.recompose();
                }
            } catch (recomposeGrowError) {}
            if (!textFrameOverflows(frame)) {
                break;
            }
            try {
                layoutBounds = ensureLayoutSpace(layoutState, frameHeight + 28);
                frameHeight += 28;
                if (frameHeight > getAvailableColumnHeight(layoutState) + 2) {
                    // Move to next column/page and recreate if still overflowing hard.
                    addLayoutPage(layoutState);
                    layoutBounds = getPageLayoutBounds(layoutState.page);
                    frameTop = layoutBounds.top;
                    layoutState.cursorY = frameTop;
                    frame.geometricBounds = [
                        frameTop,
                        layoutBounds.left,
                        frameTop + Math.min(frameHeight, layoutBounds.bottom - frameTop),
                        layoutBounds.right
                    ];
                    continue;
                }
                frame.geometricBounds = [
                    frameTop,
                    layoutBounds.left,
                    frameTop + frameHeight,
                    layoutBounds.right
                ];
            } catch (growError) {
                break;
            }
        }

        // Soft shrink to content bottom — never FRAME_TO_CONTENT (clips quote).
        try {
            if (frame.parentStory) {
                frame.parentStory.recompose();
            }
            contentBottom = getTextFrameBottomY(frame);
            if (contentBottom && contentBottom > frameTop + 20) {
                frame.geometricBounds = [
                    frameTop,
                    layoutBounds.left,
                    Math.min(contentBottom + 20, layoutBounds.bottom),
                    layoutBounds.right
                ];
            }
        } catch (shrinkError) {}

        applyQuotationPresentation(frame, style, !!author);
        applyInlineMarkupRuns(frame, quoteRuns, textStyle);

        gapAfter = resolveBlockSpacing(registryEntry);
        syncLayoutPageFromFrame(layoutState, frame);
        try {
            layoutState.cursorY = frame.geometricBounds[2] + gapAfter;
        } catch (cursorError) {
            layoutState.cursorY = frameTop + frameHeight + gapAfter;
        }

        populatedCount += 1;
        appendRenderLog(
            "Status: populated (quotation len=" + cleanText.length +
            (author ? ", hasAuthor" : "") + ")"
        );
    } catch (quoteError) {
        appendRenderLog("Status: not populated - " + quoteError.message);
        warnings.push('Could not create quotation #' + blockIndex + ": " + quoteError.message);
    }
}

function normalizeTableIndexes(index) {
    var out = [];
    var i;

    if (!index) {
        return out;
    }

    if (index.length !== undefined) {
        for (i = 0; i < index.length; i++) {
            if (index[i] && index[i].values && index[i].values.length !== undefined) {
                out.push(index[i]);
            }
        }
        return out;
    }

    if (typeof index === "object" && index.values && index.values.length !== undefined) {
        out.push(index);
    }

    return out;
}

function buildTableMatrix(data) {
    var tableData;
    var cols;
    var rows;
    var indexes;
    var validIndexes;
    var headers = [];
    var bodyRows = [];
    var i;
    var j;
    var row;
    var cells;
    var outRow;

    tableData = (data && data.table && typeof data.table === "object") ? data.table : (data || {});
    cols = tableData.cols || data.headers || [];
    if (!cols || cols.length === undefined) {
        cols = [];
    }
    rows = tableData.rows || [];
    if (!rows || rows.length === undefined) {
        rows = [];
    }

    indexes = normalizeTableIndexes(tableData.index);
    validIndexes = [];
    for (i = 0; i < indexes.length; i++) {
        if (!rows.length || indexes[i].values.length === rows.length) {
            validIndexes.push(indexes[i]);
        }
    }

    for (i = 0; i < validIndexes.length; i++) {
        headers.push(trimString(validIndexes[i].name || ""));
    }
    for (i = 0; i < cols.length; i++) {
        headers.push(trimString(cols[i] != null ? String(cols[i]) : ""));
    }

    for (i = 0; i < rows.length; i++) {
        row = rows[i];
        cells = (row && row.length !== undefined) ? row : [row];
        outRow = [];
        for (j = 0; j < validIndexes.length; j++) {
            outRow.push(
                validIndexes[j].values[i] != null
                    ? String(validIndexes[j].values[i])
                    : ""
            );
        }
        for (j = 0; j < cols.length; j++) {
            outRow.push(cells[j] != null ? String(cells[j]) : "");
        }
        bodyRows.push(outRow);
    }

    return {
        title: trimString((data && data.title) || tableData.title || ""),
        headers: headers,
        rows: bodyRows,
        indexCount: validIndexes.length
    };
}

function applyCellFillFromHex(cell, hex) {
    var doc;
    var rgb;
    var colorName;
    var color;

    if (!cell || !hex) {
        return;
    }

    rgb = hexToRgb(hex);
    try {
        doc = app.activeDocument;
        colorName = "JSON_CELL_" + rgb.join("_");
        color = ensureDocumentColor(doc, colorName, rgb);
        if (color !== null) {
            cell.fillColor = color;
        }
    } catch (cellFillError) {}
}

function styleTableCellText(cell, style) {
    var texts;

    if (!cell || !style) {
        return;
    }

    try {
        texts = cell.texts[0];
        applyTextRangeStyle(texts, style);
    } catch (cellTextError) {}
}

function populateDynamicTableBlock(layoutState, document, registryEntry, data, blockIndex) {
    var matrix = buildTableMatrix(data || {});
    var style = registryEntry.style || FRAME_STYLES.table || FRAME_STYLES_DEFAULTS.table;
    var headingStyle;
    var subHeadingStyle;
    var rowsStyle;
    var colCount;
    var rowCount;
    var estimatedHeight;
    var layoutBounds;
    var frame;
    var table;
    var r;
    var c;
    var cell;
    var cellStyle;
    var fillHex;
    var titleFrame;

    appendRenderLog("---");
    appendRenderLog("JSON block type: Table");
    appendRenderLog("Occurrence: " + blockIndex);

    if (!matrix.headers.length && !matrix.rows.length) {
        appendRenderLog("Status: not populated - empty table");
        return;
    }

    headingStyle = (style && style.headingText) ? style.headingText : null;
    subHeadingStyle = (style && style.subHeadingText) ? style.subHeadingText : null;
    rowsStyle = (style && style.rowsText) ? style.rowsText : null;

    colCount = matrix.headers.length || 1;
    rowCount = matrix.rows.length + (matrix.headers.length ? 1 : 0);
    estimatedHeight = Math.max(48, rowCount * 18 + 24);

    if (matrix.title) {
        try {
            titleFrame = flowDynamicText(
                layoutState,
                matrix.title,
                FRAME_STYLES.subSectionTitle || FRAME_STYLES_DEFAULTS.subSectionTitle,
                DYNAMIC_LAYOUT.minTextFrameHeight,
                28
            );
            advanceLayoutCursor(layoutState, titleFrame, 6);
        } catch (titleError) {
            warnings.push("Could not place table title #" + blockIndex + ": " + titleError.message);
        }
    }

    layoutBounds = ensureLayoutSpace(layoutState, Math.min(estimatedHeight, 120));
    try {
        frame = createTextFrameOnPage(
            layoutState.page,
            layoutBounds,
            layoutState.cursorY,
            Math.min(estimatedHeight, getAvailableColumnHeight(layoutState))
        );
        frame.contents = "";

        table = frame.insertionPoints.item(-1).tables.add();
        table.columnCount = colCount;
        if (matrix.headers.length) {
            table.headerRowCount = 1;
            table.bodyRowCount = matrix.rows.length > 0 ? matrix.rows.length : 1;
        } else {
            table.headerRowCount = 0;
            table.bodyRowCount = matrix.rows.length > 0 ? matrix.rows.length : 1;
        }

        if (matrix.headers.length) {
            for (c = 0; c < colCount; c++) {
                cell = table.rows[0].cells[c];
                cell.contents = matrix.headers[c] || "";
                if (c < matrix.indexCount) {
                    styleTableCellText(cell, subHeadingStyle || headingStyle);
                    applyCellFillFromHex(
                        cell,
                        (subHeadingStyle && subHeadingStyle.backgroundColor) ||
                            (headingStyle && headingStyle.backgroundColor)
                    );
                } else {
                    styleTableCellText(cell, headingStyle);
                    applyCellFillFromHex(
                        cell,
                        headingStyle && headingStyle.backgroundColor
                    );
                }
            }
        }

        for (r = 0; r < matrix.rows.length; r++) {
            for (c = 0; c < colCount; c++) {
                cell = table.rows[r + (matrix.headers.length ? 1 : 0)].cells[c];
                cell.contents = matrix.rows[r][c] != null ? String(matrix.rows[r][c]) : "";

                if (c < matrix.indexCount) {
                    cellStyle = subHeadingStyle || rowsStyle;
                    fillHex = (subHeadingStyle && subHeadingStyle.backgroundColor) ||
                        (rowsStyle && rowsStyle.backgroundColor);
                } else {
                    cellStyle = rowsStyle;
                    fillHex = rowsStyle && rowsStyle.backgroundColor;
                    if (r % 2 === 1 && rowsStyle && rowsStyle.altBackgroundColor) {
                        fillHex = rowsStyle.altBackgroundColor;
                    }
                }

                styleTableCellText(cell, cellStyle);
                applyCellFillFromHex(cell, fillHex);
            }
        }

        try {
            frame.parentStory.recompose();
            document.recompose();
        } catch (recomposeTableError) {}

        tightenTextFrameToRenderedContent(frame);
        advanceLayoutCursor(layoutState, frame, resolveBlockSpacing(registryEntry));
        populatedCount += 1;
        appendRenderLog("Status: populated (table " + colCount + "x" + rowCount + ")");
    } catch (tableError) {
        appendRenderLog("Status: not populated - " + tableError.message);
        warnings.push('Could not create table #' + blockIndex + ": " + tableError.message);
        try {
            if (frame) {
                frame.remove();
            }
        } catch (removeFrameError) {}
    }
}

function placeFootersOnRenderedPages(layoutState, document, footerItems, startPageIndex) {
    var combined = [];
    var i;
    var data;
    var text;
    var footerText;
    var style;
    var endPageIndex;
    var pageIndex;
    var page;
    var fullBounds;
    var footerRuns;
    var footerHeight = 28;
    var frame;

    for (i = 0; i < footerItems.length; i++) {
        data = footerItems[i].data || {};
        text = getFooterDisplayText(data);
        if (text) {
            combined.push(text);
        }
    }

    if (!combined.length) {
        appendRenderLog("Footer: no text to place");
        return;
    }

    footerText = combined.join("  |  ");
    style = FRAME_STYLES.footer || FRAME_STYLES_DEFAULTS.footer;
    endPageIndex = getPageDocumentOffset(layoutState.page);

    for (pageIndex = startPageIndex; pageIndex <= endPageIndex; pageIndex++) {
        try {
            page = document.pages[pageIndex];
        } catch (pageError) {
            continue;
        }

        fullBounds = getFullPageMarginBounds(page);
        try {
            frame = page.textFrames.add({
                geometricBounds: [
                    fullBounds.bottom - footerHeight,
                    fullBounds.left,
                    fullBounds.bottom,
                    fullBounds.right
                ]
            });
            assignFrameToContentLayer(frame);
            clearRuntimeLabel(frame);
            footerRuns = setFrameContentsWithMarkup(frame, footerText);
            applyFrameStyle(frame, style);
            applyInlineMarkupRuns(frame, footerRuns, style);
            populatedCount += 1;
        } catch (footerError) {
            warnings.push("Could not place footer on page index " + pageIndex + ": " + footerError.message);
        }
    }

    appendRenderLog(
        "Footer placed on pages " + startPageIndex + "-" + endPageIndex
    );
}

function populateInJsonOrderDynamic(document, contentItems, scriptFolder) {
    var i;
    var item;
    var itemType;
    var data;
    var registryEntry;
    var typeCounts = {};
    var blockIndex;
    var split;
    var startPageIndex;

    if (!layoutState) {
        layoutState = createLayoutState(document, document.pages[0]);
    }

    split = splitBodyAndFooters(contentItems || []);
    startPageIndex = getPageDocumentOffset(layoutState.page);
    layoutState.footerReserve = split.footers.length ? 36 : 0;

    for (i = 0; i < split.body.length; i++) {
        item = split.body[i];
        itemType = normalizeBlockType(item.type);
        data = item.data || {};
        registryEntry = resolveRegistryEntry(itemType);

        // Numbering restarts whenever a non-list block breaks the run.
        if (itemType !== "NumberedList") {
            layoutState.numberedListRun = 0;
        }

        if (!registryEntry) {
            logUnsupportedBlockType(itemType);
            continue;
        }

        blockIndex = getBlockTypeCount(typeCounts, itemType);

        if (registryEntry.kind === "image") {
            populateDynamicImageBlock(layoutState, document, registryEntry, data, blockIndex, scriptFolder);
            continue;
        }

        if (registryEntry.kind === "logo") {
            populateDynamicLogoBlock(layoutState, document, registryEntry, data, blockIndex, scriptFolder);
            continue;
        }

        if (registryEntry.kind === "quotation") {
            populateDynamicQuotationBlock(layoutState, document, registryEntry, data, blockIndex);
            continue;
        }

        if (registryEntry.kind === "table") {
            populateDynamicTableBlock(layoutState, document, registryEntry, data, blockIndex);
            continue;
        }

        if (registryEntry.kind === "text") {
            // Opener LessonOverview (format2): pack consecutive items into 2 columns.
            if (
                itemType === "LessonOverview" &&
                resolveComponentColumnCount(
                    itemType,
                    layoutState.pageType,
                    LAYOUT_FORMAT
                ) === 2
            ) {
                var overviewGroup = [item];
                var j = i + 1;
                while (j < split.body.length) {
                    if (normalizeBlockType(split.body[j].type) !== "LessonOverview") {
                        break;
                    }
                    overviewGroup.push(split.body[j]);
                    getBlockTypeCount(typeCounts, "LessonOverview");
                    j += 1;
                }
                i = j - 1;
                // Extra air between intro ParagraphText and the LO grid.
                if (registryEntry.spacingBefore) {
                    layoutState.cursorY += Number(registryEntry.spacingBefore) || 0;
                }
                placeTwoColumnTextGroup(
                    layoutState,
                    document,
                    overviewGroup,
                    registryEntry
                );
                layoutState.cursorY += resolveLessonOverviewTailGap();
                continue;
            }

            // 1-col LessonOverview: add top gap once when coming from ParagraphText.
            if (
                itemType === "LessonOverview" &&
                registryEntry.spacingBefore &&
                i > 0 &&
                normalizeBlockType(split.body[i - 1].type) === "ParagraphText"
            ) {
                layoutState.cursorY += Number(registryEntry.spacingBefore) || 0;
            }

            populateDynamicTextBlock(layoutState, document, registryEntry, itemType, data, blockIndex);

            // Last LessonOverview of a run: separate the list from the body copy.
            if (
                itemType === "LessonOverview" &&
                (i + 1 >= split.body.length ||
                    normalizeBlockType(split.body[i + 1].type) !== "LessonOverview")
            ) {
                layoutState.cursorY += resolveLessonOverviewTailGap();
            }

            if (itemType === "BulletList" || itemType === "NumberedList") {
                if (
                    i + 1 < split.body.length &&
                    normalizeBlockType(split.body[i + 1].type) === itemType
                ) {
                    // Mid-run: tighten so the items read as a single list.
                    layoutState.cursorY -= Math.min(
                        4,
                        Number(registryEntry.spacingAfter) || 0
                    );
                } else {
                    // End of run: separate the list from the body copy.
                    layoutState.cursorY += DYNAMIC_LAYOUT.listTailGap;
                }
            }
            continue;
        }

        logUnsupportedBlockType(itemType);
    }

    if (split.footers.length) {
        placeFootersOnRenderedPages(layoutState, document, split.footers, startPageIndex);
    }

    layoutState.footerReserve = 0;
}

// -----------------------------------------------------------------------------
// Populate blocks in order (fixed-slot mode)
// -----------------------------------------------------------------------------
function populateInJsonOrder(document, contentItems, scriptFolder) {
    var i;
    var item;
    var itemType;
    var data;
    var registryEntry;
    var typeCounts = {};
    var blockIndex;

    for (i = 0; i < contentItems.length; i++) {
        item = contentItems[i];
        itemType = item.type;
        data = item.data || {};
        registryEntry = BLOCK_REGISTRY[itemType];

        if (!registryEntry) {
            logUnsupportedBlockType(itemType);
            continue;
        }

        blockIndex = getBlockTypeCount(typeCounts, itemType);

        if (registryEntry.kind === "image") {
            populateImageBlock(document, registryEntry, data, blockIndex, scriptFolder);
            continue;
        }

        if (registryEntry.kind === "text") {
            populateTextBlock(document, registryEntry, itemType, data, blockIndex);
            continue;
        }

        logUnsupportedBlockType(itemType);
    }
}

function closeAllOpenDocuments() {
    while (app.documents.length > 0) {
        try {
            app.documents[0].close(SaveOptions.NO);
        } catch (closeError) {
            try {
                app.documents[0].close();
            } catch (closeFallback) {
                break;
            }
        }
    }
}

function openTemplateDocument(templateFile) {
    if (!templateFile.exists) {
        throw new Error("InDesign template not found at: " + templateFile.fsName);
    }

    closeAllOpenDocuments();
    app.open(templateFile);
    return app.activeDocument;
}

// -----------------------------------------------------------------------------
// Export PDF strictly to script folder
// -----------------------------------------------------------------------------
function exportActiveDocumentToPdf(document, scriptFolderPath) {
    var pdfFile = File(scriptFolderPath + "/output.pdf");
    var exportPreset;

    try {
        if (pdfFile.exists) {
            pdfFile.remove();
        }
    } catch (removeErr) {}

    try {
        exportPreset = app.pdfExportPresets.itemByName("[High Quality Print]");
        exportPreset.name;
    } catch (presetErrorA) {
        try {
            exportPreset = app.pdfExportPresets[0];
        } catch (presetErrorB) {
            exportPreset = null;
        }
    }

    if (exportPreset) {
        document.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, exportPreset);
    } else {
        document.exportFile(ExportFormat.PDF_TYPE, pdfFile);
    }

    if (!pdfFile.exists) {
        throw new Error("PDF export command completed, but output.pdf was not created.");
    }

    return pdfFile;
}

// -----------------------------------------------------------------------------
// Initialize FRAME_STYLES from typography config and rebuild BLOCK_REGISTRY
// -----------------------------------------------------------------------------
function initializeStylesFromConfig(scriptFolderPath) {
    var typographyConfig = loadTypographyConfig(scriptFolderPath);
    var configStyles;
    var layoutFormat;
    var formatId = "";

    if (typographyConfig) {
        if (typographyConfig.OPTIONS && typeof typographyConfig.OPTIONS === "object") {
            THEME_OPTIONS = typographyConfig.OPTIONS;
            appendRenderLog(
                "Theme options loaded => contentLeftInset=" + getContentLeftInset()
            );
        }
        formatId = normalizeFormatIdToken(
            typographyConfig.formatId || typographyConfig.themeId || typographyConfig.templateId
        );
        if (typographyConfig.layout && (typographyConfig.layout.opener || typographyConfig.layout["non-opener"])) {
            LAYOUT_FORMAT = typographyConfig.layout;
            LAYOUT_FORMAT_ID = formatId;
        }
    }

    layoutFormat = loadLayoutFormat(scriptFolderPath, formatId);
    if (layoutFormat) {
        LAYOUT_FORMAT = layoutFormat;
        appendRenderLog(
            "Layout format loaded (formatId=" +
            (LAYOUT_FORMAT_ID || formatId || "?") +
            ", opener.columns=" +
            ((LAYOUT_FORMAT.opener && LAYOUT_FORMAT.opener.columns) || "?") +
            ", non-opener.columns=" +
            ((LAYOUT_FORMAT["non-opener"] && LAYOUT_FORMAT["non-opener"].columns) || "?") +
            ")"
        );
    }
    
    if (typographyConfig) {
        configStyles = buildFrameStylesFromConfig(typographyConfig);
        if (configStyles) {
            FRAME_STYLES = configStyles;
            appendRenderLog("Typography config loaded from: " + typographyConfig.__loadedFrom);
            logResolvedTypographySample();
            return true;
        }
    }
    
    appendRenderLog("Using default FRAME_STYLES (typography config not found)");
    logResolvedTypographySample();
    return false;
}

// Emits a compact snapshot of resolved styles so render.log can be used to
// confirm the centralized typography values are the ones being applied.
function logResolvedTypographySample() {
    var keys = [
        "chapterTitle", "sectionTitle", "paragraphText", "topic",
        "imageCaption", "imageFigureNumber", "figureCaption", "logoText",
        "partNumber", "subTitlesList", "greenSubSectionTitle", "subTitle",
        "quotation", "table", "footer"
    ];
    var i;
    var key;
    var style;
    var color;

    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        style = FRAME_STYLES[key];
        if (!style) {
            continue;
        }
        if (isCompositeStyle(style)) {
            appendRenderLog("  style " + key + ": composite text/number");
            continue;
        }
        if (isQuotationStyle(style)) {
            appendRenderLog(
                "  style " + key + ": quotation text/author bg=" +
                (style.backgroundColor || "(none)")
            );
            continue;
        }
        if (isTableStyle(style)) {
            appendRenderLog("  style " + key + ": table heading/subHeading/rows");
            continue;
        }
        color = style.color ? ("[" + style.color.join(",") + "]") : "(none)";
        appendRenderLog(
            "  style " + key + ": font=" + (style.fontFamily || "(default)") +
            " size=" + style.pointSize +
            " bold=" + style.bold +
            " italic=" + style.italic +
            " color=" + color
        );
    }
}

function rebuildBlockRegistry() {
    BLOCK_REGISTRY.LessonNumber.style = FRAME_STYLES.lessonNumber || FRAME_STYLES_DEFAULTS.lessonNumber;
    BLOCK_REGISTRY.LessonTitle.style = FRAME_STYLES.lessonTitle || FRAME_STYLES_DEFAULTS.lessonTitle;
    BLOCK_REGISTRY.ChapterOverview.style = FRAME_STYLES.chapterOverview || FRAME_STYLES_DEFAULTS.chapterOverview;
    BLOCK_REGISTRY.ChapterOverview.spacingAfter = resolveChapterOverviewSpacingAfter();
    BLOCK_REGISTRY.Topic.style = FRAME_STYLES.topic || FRAME_STYLES_DEFAULTS.topic;
    BLOCK_REGISTRY.SectionTitle.style = FRAME_STYLES.sectionTitle || FRAME_STYLES_DEFAULTS.sectionTitle;
    BLOCK_REGISTRY.SubSectionTitle.style = FRAME_STYLES.subSectionTitle || FRAME_STYLES_DEFAULTS.subSectionTitle;
    BLOCK_REGISTRY.FigureCaption.style = FRAME_STYLES.figureCaption || FRAME_STYLES_DEFAULTS.figureCaption;
    BLOCK_REGISTRY.Text.style = FRAME_STYLES.text || FRAME_STYLES_DEFAULTS.text;
    BLOCK_REGISTRY.Image.style = FRAME_STYLES.imageCaption || FRAME_STYLES_DEFAULTS.imageCaption;
    BLOCK_REGISTRY.ChapterNumber.style = FRAME_STYLES.chapterNumber || FRAME_STYLES_DEFAULTS.chapterNumber;
    BLOCK_REGISTRY.ChapterNumber.spacingAfter = resolveChapterNumberGapAfter(
        BLOCK_REGISTRY.ChapterNumber.style
    );
    BLOCK_REGISTRY.ChapterTitle.style = FRAME_STYLES.chapterTitle || FRAME_STYLES_DEFAULTS.chapterTitle;
    BLOCK_REGISTRY.ChapterTitle.spacingAfter = resolveChapterTitleSpacingAfter();
    BLOCK_REGISTRY.LessonOverview.style = FRAME_STYLES.lessonOverview || FRAME_STYLES_DEFAULTS.lessonOverview;
    BLOCK_REGISTRY.LessonOverview.spacingAfter = resolveLessonOverviewSpacingAfter();
    BLOCK_REGISTRY.LessonOverview.spacingBefore = resolveLessonOverviewSpacingBefore();
    BLOCK_REGISTRY.ParagraphText.style = FRAME_STYLES.paragraphText || FRAME_STYLES_DEFAULTS.paragraphText;
    BLOCK_REGISTRY.LearningObjectives.style = FRAME_STYLES.learningObjectives || FRAME_STYLES_DEFAULTS.learningObjectives;
    BLOCK_REGISTRY.BulletList.style = FRAME_STYLES.bulletList || FRAME_STYLES_DEFAULTS.bulletList;
    BLOCK_REGISTRY.NumberedList.style = FRAME_STYLES.numberedList || FRAME_STYLES_DEFAULTS.numberedList;
    BLOCK_REGISTRY.LogoWithText.style = FRAME_STYLES.logoText || FRAME_STYLES_DEFAULTS.logoText;
    BLOCK_REGISTRY.PartNumber.style = FRAME_STYLES.partNumber || FRAME_STYLES_DEFAULTS.partNumber;
    BLOCK_REGISTRY.SubTitlesList.style = FRAME_STYLES.subTitlesList || FRAME_STYLES_DEFAULTS.subTitlesList;
    BLOCK_REGISTRY.GreenSubSectionTitle.style = FRAME_STYLES.greenSubSectionTitle || FRAME_STYLES_DEFAULTS.greenSubSectionTitle;
    BLOCK_REGISTRY.SubSectionHeading.style = FRAME_STYLES.subSectionHeading || FRAME_STYLES_DEFAULTS.subSectionHeading;
    BLOCK_REGISTRY.SubTitle.style = FRAME_STYLES.subTitle || FRAME_STYLES_DEFAULTS.subTitle;
    BLOCK_REGISTRY.Quotation.style = FRAME_STYLES.quotation || FRAME_STYLES_DEFAULTS.quotation;
    BLOCK_REGISTRY.Table.style = FRAME_STYLES.table || FRAME_STYLES_DEFAULTS.table;
    BLOCK_REGISTRY.Footer.style = FRAME_STYLES.footer || FRAME_STYLES_DEFAULTS.footer;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
function main() {
    var scriptFile = File($.fileName);
    var scriptFolder = scriptFile.parent;
    var scriptFolderPath = scriptFolder.fsName;
    var dataFile = File(scriptFolder + "/tree_output.json");
    var autoTemplate = File(scriptFolder + "/templates/projectX.indd");

    var rawJson;
    var parsedJson;
    var contentItems = [];
    var doc;
    var pdfFile;
    var w;
    var p;
    var warningText = "";
    var logText;

    warnings = [];
    populatedCount = 0;
    usedLabels = {};
    renderLogEntries = [];
    layoutState = null;
    contentLayer = null;
    scriptLogFolderPath = scriptFolderPath;

    appendRenderLog("Block mapping started");
    appendRenderLog("Script file: " + scriptFile.fsName);
    appendRenderLog("Working folder: " + scriptFolderPath);
    appendRenderLog("Expected tree_output.json: " + dataFile.fsName);
    appendRenderLog("Expected template: " + autoTemplate.fsName);
    appendRenderLog("LOCAL DEV MODE: Edit tree_output.json and re-run this script to see changes");

    // Load typography configuration from shared config file
    initializeStylesFromConfig(scriptFolderPath);
    rebuildBlockRegistry();

    flushRenderLog("started");

    if (!dataFile.exists) {
        throw new Error("tree_output.json not found at: " + dataFile.fsName);
    }

    rawJson = readTextFileUtf8(dataFile);
    if (rawJson === null) {
        throw new Error("Could not open tree_output.json for reading.");
    }

    parsedJson = parseJSON(rawJson);

    if (!parsedJson) {
        throw new Error("tree_output.json is empty or invalid.");
    }

    // Ensure curly quotes / dashes are correct even if encoding was wrong once.
    parsedJson = sanitizeJsonStrings(parsedJson);
    if (parsedJson.length !== undefined) {
        contentItems = parsedJson;
    }
    else if (parsedJson.pages && parsedJson.pages.length) {

        for (p = 0; p < parsedJson.pages.length; p++) {

            appendRenderLog(
                "Processing page " +
                parsedJson.pages[p].page_no +
                " (" +
                parsedJson.pages[p].page_type +
                ")"
            );

            if (
                parsedJson.pages[p].content &&
                parsedJson.pages[p].content.length
            ) {
                contentItems =
                    contentItems.concat(
                        parsedJson.pages[p].content
                    );
            }
        }
    }

    if (!contentItems.length) {
        throw new Error("No content blocks found in tree_output.json");
    }

    doc = openTemplateDocument(autoTemplate);
    appendRenderLog("Layout mode: " + (USE_DYNAMIC_LAYOUT ? "dynamic (proto:*)" : "fixed-slot"));
    appendRenderLog("JSON blocks: " + contentItems.length);
    logJsonBlockSummary(contentItems);
    saveLastInputJson(scriptFolderPath, contentItems);
    flushRenderLog("json-loaded");

    if (USE_DYNAMIC_LAYOUT) {
        prepareTemplateForDynamicLayout(doc);
        flushRenderLog("template-prepared");

        var p;
        var jsonPage;
        var pages = parsedJson.pages;

        if (!pages || !pages.length) {
            pages = [{
                page_type: "opener",
                page_no: 1,
                content: contentItems
            }];
        }

        for (p = 0; p < pages.length; p++) {

            jsonPage = pages[p];

            // first page already exists
            if (p > 0) {
                addLayoutPage(layoutState);
            }

            layoutState.pageType =
                jsonPage.page_type || "opener";

            CURRENT_PAGE_TYPE = layoutState.pageType;
            layoutState.lastImageFrame = null;

            initializeStylesFromConfig(scriptFolderPath);

            rebuildBlockRegistry();

            layoutState.columnCount = resolvePageColumnCount(
                layoutState.pageType,
                LAYOUT_FORMAT
            );

            layoutState.currentColumn = 0;

            layoutState.cursorY =
                getPageLayoutBounds(
                    layoutState.page
                ).top;

            appendRenderLog(
                "Rendering JSON Page " +
                jsonPage.page_no +
                " as " +
                layoutState.pageType +
                " with " +
                layoutState.columnCount +
                " columns"
            );

            populateInJsonOrderDynamic(
                doc,
                jsonPage.content,
                scriptFolderPath
            );
        }

        removeAllEmptyPages(doc);
        appendRenderLog("Pages in document before PDF export: " + doc.pages.length);
        flushRenderLog("populated");
        pdfFile = exportActiveDocumentToPdf(doc, scriptFolderPath);
        restoreCleanTemplateState(doc);
    } else {
        prepareTemplateForJson(doc);
        populateInJsonOrder(doc, contentItems, scriptFolderPath);
        collapseUnusedLabeledFrames(doc);
        removeTrailingEmptyPages(doc);
        pdfFile = exportActiveDocumentToPdf(doc, scriptFolderPath);
    }

    try {
        doc.close(SaveOptions.NO);
    } catch (closeDocError) {}

    if (warnings.length > 0) {
        warningText = "Warnings:\n";
        for (w = 0; w < warnings.length; w++) {
            warningText += "- " + warnings[w] + "\n";
        }
    }

    logText = "PDF export success\n";
    logText += "Script version: " + POPULATE_SCRIPT_VERSION + "\n";
    logText += "JSON blocks: " + contentItems.length + "\n";
    logText += "Frames populated: " + populatedCount + "\n";
    logText += "last-input.json: " + scriptFolderPath + "/last-input.json\n";
    logText += "PDF: " + pdfFile.fsName + "\n";
    if (warningText) {
        logText += "\n" + warningText;
    }

    flushRenderLog("success", logText);
}

try {
    main();
} catch (e) {
    var scriptPathForError = File($.fileName).parent.fsName;
    if (!scriptLogFolderPath) {
        scriptLogFolderPath = scriptPathForError;
    }
    appendRenderLog("FATAL ERROR: " + e.message);
    logError(scriptPathForError, "PDF render failed: " + e.message);
    throw e;
}