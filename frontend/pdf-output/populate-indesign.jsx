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
    prototypeOffPageTop: -2000,
    minTextFrameHeight: 24,
    defaultImageFrameHeight: 180
};

var layoutState = null;
var contentLayer = null;

var PROTOTYPE_TEXT_FALLBACK = "proto:text";
var POPULATE_SCRIPT_VERSION = "dynamic-v22";
var prototypeMetrics = {};
var scriptLogFolderPath = "";

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

    if (f.open("w")) {
        f.write(content);
        f.close();
        return true;
    }

    return false;
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
    return {
        fontFamily: style.font || "",
        pointSize: style.size || 12,
        bold: style.bold === true,
        italic: style.italic === true,
        leftIndent: style.leftIndent || 0,
        color: hexToRgb(style.color)
    };
}

function normalizeTypographyEntry(value) {
    if (!value || typeof value !== "object") {
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

function getTypographyMode(config) {
    var rawMode = "";
    if (config && config.ACTIVE_STYLE_MODE) {
        rawMode = String(config.ACTIVE_STYLE_MODE);
    } else if (config && config.styleMode) {
        rawMode = String(config.styleMode);
    } else {
        rawMode = "opener";
    }

    rawMode = trimString(rawMode).toLowerCase();
    if (rawMode === "non_opener" || rawMode === "non-opener" || rawMode === "nonopener") {
        return "nonOpener";
    }
    return "opener";
}

function buildCanonicalStyleMap(styleSet) {
    var chapterHeading = pickTypographyEntry(styleSet, ["chapterHeading"]);
    var chapterTitle = pickTypographyEntry(styleSet, ["chapterTitle"]);
    var chapterOverview = pickTypographyEntry(styleSet, ["chapterOverview"]);
    var lessonOverview = pickTypographyEntry(styleSet, ["lessonOverview", "topic"]);
    var lessonTitle = pickTypographyEntry(styleSet, ["lessonTitle"]);
    var learningObjectives = pickTypographyEntry(styleSet, ["learningObjectives"]);
    var sectionTitle = pickTypographyEntry(styleSet, ["sectionTitle", "subTitlesList"]);
    var subSectionTitle = pickTypographyEntry(styleSet, [
        "subSectionTitle",
        "greenSubSectionTitle",
        "subTitle"
    ]);
    var paragraphText = pickTypographyEntry(styleSet, ["paragraphText", "paragrapghText", "text"]);
    var bulletList = pickTypographyEntry(styleSet, ["bulletList", "bullestList"]);
    var imageFigureNumber = pickTypographyEntry(styleSet, ["imageFigureNumber"]);
    var imageFigureText = pickTypographyEntry(styleSet, ["imageFigureText", "imageCaption", "figureCaption"]);

    return {
        chapterHeading: chapterHeading,
        chapterTitle: chapterTitle,
        chapterOverview: chapterOverview,
        lessonOverview: lessonOverview,
        lessonTitle: lessonTitle,
        learningObjectives: learningObjectives,
        sectionTitle: sectionTitle,
        subSectionTitle: subSectionTitle,
        paragraphText: paragraphText,
        bulletList: bulletList,
        imageFigureNumber: imageFigureNumber,
        imageFigureText: imageFigureText,
        // Backward compatible aliases used by current script registry
        chapterNumber: chapterHeading,
        lessonNumber: chapterHeading,
        topic: lessonOverview,
        text: paragraphText,
        imageCaption: imageFigureText,
        figureCaption: imageFigureText,
        logoText: subSectionTitle
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
    
    if (!configFile.open("r")) {
        return null;
    }
    
    rawJson = configFile.read();
    configFile.close();
    
    try {
        config = parseJSON(rawJson);
        config.__loadedFrom = loadedPath;
        return config;
    } catch (parseError) {
        return null;
    }
}

function buildFrameStylesFromConfig(typographyConfig) {
    var styles = {};
    var mode = "opener";
    var sourceMap = typographyConfig;
    var canonicalMap;
    var key;
    
    if (!typographyConfig) {
        return null;
    }

    if (typographyConfig.OPENER_STYLES || typographyConfig.NON_OPENER_STYLES) {
        mode = getTypographyMode(typographyConfig);
        if (mode === "nonOpener" && typographyConfig.NON_OPENER_STYLES) {
            sourceMap = typographyConfig.NON_OPENER_STYLES;
        } else {
            sourceMap = typographyConfig.OPENER_STYLES || typographyConfig.NON_OPENER_STYLES;
        }
    }

    canonicalMap = buildCanonicalStyleMap(sourceMap);
    
    for (key in canonicalMap) {
        if (canonicalMap.hasOwnProperty(key) && canonicalMap[key]) {
            styles[key] = convertTypographyStyle(canonicalMap[key]);
        }
    }
    
    // Ensure bulletList has proper indent
    if (styles.bulletList) {
        styles.bulletList.leftIndent = 12;
    }

    styles.__mode = mode;
    
    return styles;
}

// -----------------------------------------------------------------------------
// Styling maps - defaults (will be overridden by typography config if available)
// -----------------------------------------------------------------------------
var FRAME_STYLES_DEFAULTS = {
    lessonNumber: { pointSize: 14, bold: false, italic: false, leftIndent: 0, color: [0, 116, 188] },
    lessonTitle: { pointSize: 12, bold: false, italic: false, leftIndent: 0, color: [0, 116, 188] },
    chapterOverview: { pointSize: 9, bold: true, italic: false, leftIndent: 0, color: [0, 116, 188] },
    chapterHeading: { pointSize: 15, bold: false, italic: false, leftIndent: 0, color: [0, 116, 188] },
    topic: { pointSize: 11, bold: true, italic: false, leftIndent: 0, color: [0, 0, 0] },
    text: { pointSize: 9, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    sectionTitle: { pointSize: 11, bold: false, italic: false, leftIndent: 0, color: [0, 116, 188] },
    imageCaption: { pointSize: 7.5, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    chapterNumber: { pointSize: 14, bold: false, italic: false, leftIndent: 0, color: [0, 116, 188] },
    chapterTitle: { pointSize: 22, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    lessonOverview: { pointSize: 9, bold: true, italic: false, leftIndent: 0, color: [0, 0, 0] },
    paragraphText: { pointSize: 9, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] },
    learningObjectives: { pointSize: 9, bold: true, italic: false, leftIndent: 0, color: [0, 116, 188] },
    bulletList: { pointSize: 9, bold: false, italic: false, leftIndent: 12, color: [0, 0, 0] },
    logoText: { pointSize: 11, bold: true, italic: false, leftIndent: 0, color: [0, 116, 188] },
    subSectionTitle: { pointSize: 9, bold: true, italic: false, leftIndent: 0, color: [0, 116, 188] },
    figureCaption: { pointSize: 7.5, bold: false, italic: true, leftIndent: 0, color: [64, 64, 64] },
    imageFigureNumber: { pointSize: 7.5, bold: true, italic: false, leftIndent: 0, color: [195, 20, 39] },
    imageFigureText: { pointSize: 7.5, bold: false, italic: false, leftIndent: 0, color: [0, 0, 0] }
};

var FRAME_STYLES = FRAME_STYLES_DEFAULTS;

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
        spacingAfter: 14
    },
    ChapterNumber: {
        label: "chapterNumber",
        style: FRAME_STYLES.chapterNumber,
        kind: "text",
        prototype: "proto:chapterNumber",
        spacingAfter: 8
    },
    ChapterTitle: {
        label: "chapterTitle",
        style: FRAME_STYLES.chapterTitle,
        kind: "text",
        prototype: "proto:chapterTitle",
        spacingAfter: 16
    },
    LessonOverview: {
        label: "lessonOverview",
        style: FRAME_STYLES.lessonOverview,
        kind: "text",
        prototype: "proto:lessonOverview",
        spacingAfter: 6
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
    LogoWithText: {
        frameLabel: "logoFrame",
        captionLabel: "logoText",
        framePrototype: "proto:logoFrame",
        captionPrototype: "proto:logoText",
        style: FRAME_STYLES.logoText,
        kind: "logo",
        spacingAfter: 14
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

function fitPlacedImageInFrame(frame, savedBounds) {
    var fitResults = [];
    var bounds;
    var frameHeight;
    var minHeight = 48;

    try {
        frame.fit(FitOptions.PROPORTIONALLY);
        fitResults.push("PROPORTIONALLY:ok");
    } catch (fitErrorA) {
        try {
            frame.fit(FitOptions.proportionally);
            fitResults.push("PROPORTIONALLY:ok");
        } catch (fitErrorA2) {
            fitResults.push("PROPORTIONALLY:fail");
        }
    }
    logImagePlacementDiagnostics(frame, "after PROPORTIONALLY");

    try {
        frame.fit(FitOptions.CENTER_CONTENT);
        fitResults.push("CENTER_CONTENT:ok");
    } catch (fitErrorB) {
        try {
            frame.fit(FitOptions.centerContent);
            fitResults.push("CENTER_CONTENT:ok");
        } catch (fitErrorB2) {
            fitResults.push("CENTER_CONTENT:fail");
        }
    }
    logImagePlacementDiagnostics(frame, "after CENTER_CONTENT");

    try {
        bounds = frame.geometricBounds;
        frameHeight = bounds[2] - bounds[0];
        if (savedBounds && savedBounds.length === 4 && frameHeight < minHeight) {
            frame.geometricBounds = savedBounds;
            try {
                frame.fit(FitOptions.PROPORTIONALLY);
                fitResults.push("RESTORE_BOUNDS+PROPORTIONALLY:ok");
            } catch (restoreFitError) {
                try {
                    frame.fit(FitOptions.proportionally);
                    fitResults.push("RESTORE_BOUNDS+PROPORTIONALLY:ok");
                } catch (restoreFitError2) {
                    fitResults.push("RESTORE_BOUNDS+PROPORTIONALLY:fail");
                }
            }
            logImagePlacementDiagnostics(frame, "after RESTORE_BOUNDS+PROPORTIONALLY");
        }
    } catch (collapseCheckError) {}

    return fitResults.join(", ");
}

function placeImageContentInFrame(frame, imageFile) {
    var savedBounds;
    var graphicsCount = 0;
    var fittingResult;

    savedBounds = frame.geometricBounds;
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

    fittingResult = fitPlacedImageInFrame(frame, savedBounds);
    appendRenderLog("Image fitting result: " + fittingResult);

    ensureGraphicFrameVisible(frame);
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

function applyFontStyleSafe(textRange, bold, italic) {
    var candidates = [];
    var i;
    var family;
    var styleName;

    if (bold && italic) {
        candidates = ["Bold Italic", "BoldItalic", "Bold Oblique", "BoldIt", "Demi Bold Italic"];
    } else if (bold) {
        candidates = ["Bold", "Semibold", "SemiBold", "Medium", "Demi Bold", "Black"];
    } else if (italic) {
        candidates = ["Italic", "Oblique", "It", "Slanted"];
    } else {
        candidates = ["Regular", "Roman", "Book", "Normal", "Light", "Plain"];
    }

    for (i = 0; i < candidates.length; i++) {
        try {
            textRange.fontStyle = candidates[i];
            return;
        } catch (styleError) {}
    }

    try {
        family = textRange.fontFamily;
    } catch (familyError) {
        return;
    }

    for (i = 0; i < candidates.length; i++) {
        try {
            styleName = family + "\t" + candidates[i];
            textRange.appliedFont = app.fonts.item(styleName);
            return;
        } catch (fontError) {}
    }
}

function applyConfiguredFontFamily(textRange, style) {
    var family;
    var candidates = [];
    var i;

    if (!textRange || !style || !style.fontFamily) {
        return false;
    }

    family = trimString(style.fontFamily);
    if (!family) {
        return false;
    }

    if (style.bold && style.italic) {
        candidates = ["Bold Italic", "BoldItalic", "Bold Oblique", "BoldIt", "Demi Bold Italic"];
    } else if (style.bold) {
        candidates = ["Bold", "Semibold", "SemiBold", "Medium", "Demi Bold", "Black"];
    } else if (style.italic) {
        candidates = ["Italic", "Oblique", "It", "Slanted"];
    } else {
        candidates = ["Regular", "Roman", "Book", "Normal", "Light", "Plain"];
    }

    for (i = 0; i < candidates.length; i++) {
        try {
            textRange.appliedFont = app.fonts.item(family + "\t" + candidates[i]);
            return true;
        } catch (fontByStyleError) {}
    }

    try {
        textRange.appliedFont = app.fonts.item(family);
        return true;
    } catch (fontFamilyError) {}

    return false;
}

function applyFrameStyle(textFrame, style) {
    var story;
    var textRange;

    if (!textFrame || !style) return;

    story = textFrame.parentStory;
    if (!story || story.texts.length === 0) return;

    textRange = story.texts[0];

    if (style.pointSize) {
        try {
            textRange.pointSize = style.pointSize;
        } catch (sizeError) {
            warnings.push("Could not set point size.");
        }
    }

    applyConfiguredFontFamily(textRange, style);
    applyFontStyleSafe(textRange, style.bold, style.italic);
    applyTextColor(textRange, style);

    if (style.leftIndent) {
        try {
            story.paragraphs[0].leftIndent = style.leftIndent;
        } catch (indentError) {
            warnings.push("Could not set left indent.");
        }
    }
}

// Applies size/font/weight/color from a centralized style to a specific text
// range (not the whole frame). Used to recolor the "FIGURE x.x" caption prefix.
function applyTextRangeStyle(textRange, style) {
    if (!textRange || !style) {
        return;
    }

    if (style.pointSize) {
        try {
            textRange.pointSize = style.pointSize;
        } catch (sizeError) {}
    }

    applyConfiguredFontFamily(textRange, style);
    applyFontStyleSafe(textRange, style.bold, style.italic);
    applyTextColor(textRange, style);
}

// Mirrors the web ImageBlock split: a leading "FIGURE 1.1" style prefix is
// rendered with the imageFigureNumber style; the rest keeps the caption style.
function parseFigureCaptionParts(caption) {
    var text = trimString(caption || "");
    var match;

    if (!text) {
        return null;
    }

    match = text.match(/^(FIGURE\s+\d+(?:\.\d+)?)([\s\S]*)$/i);
    if (!match) {
        return null;
    }

    return { prefix: match[1], rest: match[2] || "" };
}

function applyFigureCaptionPrefixStyle(textFrame, captionText) {
    var parts = parseFigureCaptionParts(captionText);
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

    frame.contents = cleanText;
    applyFrameStyle(frame, style);
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

function getBlockText(data) {
    var fields;
    var i;
    var value;
    var bulletLines;
    var bulletText;

    if (!data) {
        return "";
    }

    // BulletList blocks carry an "items" array instead of a text field.
    if (data.items && data.items.length !== undefined) {
        bulletLines = [];
        for (i = 0; i < data.items.length; i++) {
            bulletText = trimString(data.items[i]);
            if (bulletText) {
                bulletLines.push("\u2022 " + bulletText);
            }
        }
        if (bulletLines.length > 0) {
            return bulletLines.join("\r");
        }
    }

    fields = ["text", "title", "label", "content", "value"];
    for (i = 0; i < fields.length; i++) {
        if (data[fields[i]] !== undefined && data[fields[i]] !== null) {
            value = trimString(data[fields[i]]);
            if (value) {
                return value;
            }
        }
    }

    return "";
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
        logowithtext: "LogoWithText",
        subsectiontitle: "SubSectionTitle",
        caption: "FigureCaption",
        figurecaption: "FigureCaption"
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

function createGraphicFrameOnPage(page, layoutBounds, top, height) {
    var frame;
    var document;
    var imageProto;
    var protoBounds;
    var frameLeft;
    var frameWidth;
    var frameHeight;

    try {
        document = app.activeDocument;
    } catch (docError) {
        document = null;
    }

    if (document) {
        imageProto = findPageItemByLabel(document, "proto:imageFrame");
    }

    if (imageProto !== null) {
        protoBounds = imageProto.geometricBounds;
        frameLeft = protoBounds[1];
        frameWidth = protoBounds[3] - protoBounds[1];
        frameHeight = protoBounds[2] - protoBounds[0];

        frame = page.rectangles.add({
            geometricBounds: [top, frameLeft, top + frameHeight, frameLeft + frameWidth]
        });

        try {
            if (imageProto.appliedObjectStyle) {
                frame.applyObjectStyle(imageProto.appliedObjectStyle);
            }
        } catch (styleError) {}

        try {
            frame.strokeWeight = imageProto.strokeWeight;
            frame.strokeColor = imageProto.strokeColor;
            frame.strokeTint = imageProto.strokeTint;
            frame.fillColor = imageProto.fillColor;
            frame.fillTint = imageProto.fillTint;
        } catch (strokeFillError) {}

        try {
            frame.frameFittingOptions.fittingOnEmptyFrame = imageProto.frameFittingOptions.fittingOnEmptyFrame;
            frame.frameFittingOptions.fittingAlignment = imageProto.frameFittingOptions.fittingAlignment;
            frame.frameFittingOptions.autoFit = imageProto.frameFittingOptions.autoFit;
        } catch (fittingError) {}

        appendRenderLog(
            "Created image frame from proto:imageFrame " + frameWidth + " x " + frameHeight
        );
    } else {
        frame = page.rectangles.add({
            geometricBounds: [top, layoutBounds.left, top + height, layoutBounds.right]
        });
        appendRenderLog(
            "Created image frame width=" + (layoutBounds.right - layoutBounds.left)
        );
    }

    assignFrameToContentLayer(frame);
    clearRuntimeLabel(frame);
    return frame;
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

    // Use the visible graphic bottom when it sits inside the frame so the
    // caption hugs the rendered image instead of the (possibly taller) frame.
    if (graphicBottom > 0 && graphicBottom <= frameBottom) {
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

function tightenTextFrameToRenderedContent(textFrame) {
    var story;
    var fitPass;

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

    layoutBounds = ensureLayoutSpace(layoutState, minHeight);
    available = getAvailableColumnHeight(layoutState);

    if (available < DYNAMIC_LAYOUT.minTextFrameHeight) {
        addLayoutPage(layoutState);
        layoutBounds = getPageLayoutBounds(layoutState.page);
        available = getAvailableColumnHeight(layoutState);
    }

    frameHeight = Math.min(available, Math.max(initialHeight, minHeight));
    if (frameHeight < DYNAMIC_LAYOUT.minTextFrameHeight) {
        frameHeight = Math.min(available, DYNAMIC_LAYOUT.minTextFrameHeight);
    }

    frameTop = layoutState.cursorY;
    frame = createTextFrameOnPage(layoutState.page, layoutBounds, frameTop, frameHeight);
    frame.contents = cleanText;
    applyFrameStyle(frame, style);

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
        addLayoutPage(layoutState);
        layoutBounds = getPageLayoutBounds(layoutState.page);
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
        tightenTextFrameToRenderedContent(chainEnd);
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

    appendRenderLog(
    "Layout Bounds => left=" + leftMargin +
    ", right=" + rightMargin +
    ", page=[" + bounds.join(",") + "]" +
    ", usable=[" +
    (bounds[1] + leftMargin) + "," +
    (bounds[3] - rightMargin) + "]"
);

    return {
        top: bounds[0] + topMargin,
        left: bounds[1] + leftMargin,
        bottom: bounds[2] - bottomMargin,
        right: bounds[3] - rightMargin
    };
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
        blockGap: DYNAMIC_LAYOUT.blockGap
    };
}

function addLayoutPage(layoutState) {
    layoutState.page = layoutState.document.pages.add();
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
    var pageBreak;

    pageBreak = layoutState.cursorY >= bounds.bottom || layoutState.cursorY + needed > bounds.bottom;
    appendRenderLog(
        "ensureLayoutSpace: cursorY=" + layoutState.cursorY +
        ", needed=" + needed +
        ", bounds.top=" + bounds.top +
        ", bounds.bottom=" + bounds.bottom +
        ", cursorY+needed=" + (layoutState.cursorY + needed) +
        ", pageBreak=" + pageBreak
    );

    // Add one page at a time; multi-page text flow is handled in flowDynamicText().
    if (pageBreak) {
        addLayoutPage(layoutState);
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
            tightenTextFrameToRenderedContent(chainEnd);
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
        shrinkTextFrameToContentBottom(chainEnd);
        layoutState.cursorY = getTextFrameBottomY(chainEnd) + gap;
    } else {
        layoutState.cursorY = bounds[2] + gap;
    }
}

function advanceLayoutCursorAfterImageBlock(layoutState, imageFrame, captionFrame, gapAfter) {
    var imageBottom;
    var captionBottom;
    var blockBottom;
    var gap = gapAfter;

    if (!imageFrame) {
        return;
    }

    if (gap === undefined || gap === null) {
        gap = layoutState.blockGap;
    }
    if (gap === undefined || gap === null) {
        gap = DYNAMIC_LAYOUT.blockGap;
    }

    syncLayoutPageFromFrame(layoutState, captionFrame || imageFrame);

    imageBottom = getImageContentBottomY(imageFrame);
    blockBottom = imageBottom;

    if (captionFrame) {
        captionBottom = getFrameBottomY(getLastFrameInChain(captionFrame));
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

function populateDynamicTextBlock(layoutState, document, registryEntry, itemType, data, blockIndex) {
    var protoLabel = registryEntry.prototype;
    var protoResult;
    var protoFrame;
    var protoHeight;
    var frame;
    var cleanText = getBlockText(data);

    appendRenderLog("---");
    appendRenderLog("JSON block type: " + itemType);
    appendRenderLog("Dynamic prototype: " + protoLabel);
    appendRenderLog("Occurrence: " + blockIndex);
    appendRenderLog("Text length: " + cleanText.length);

    if (!cleanText || isPlaceholderText(cleanText)) {
        appendRenderLog("Status: not populated - empty or placeholder text in JSON");
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
    var urlOrPath = data.url;

    appendRenderLog("---");
    appendRenderLog("JSON block type: Image");
    appendRenderLog("Dynamic prototype: " + frameProtoLabel);
    appendRenderLog("Occurrence: " + blockIndex);
    appendRenderLog("Image path: " + (urlOrPath ? urlOrPath : "(empty)"));

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
    layoutBounds = ensureLayoutSpace(layoutState, protoHeight);
    appendRenderLog("Image block cursor trace [after ensureLayoutSpace]: cursorY=" + layoutState.cursorY);

    appendRenderLog("Image block cursor trace [before createGraphicFrameOnPage]: cursorY=" + layoutState.cursorY);
    try {
        imageFrame = createGraphicFrameOnPage(layoutState.page, layoutBounds, layoutState.cursorY, protoHeight);
        appendRenderLog("Image block cursor trace [after createGraphicFrameOnPage]: cursorY=" + layoutState.cursorY);
        if (!placeImageContentInFrame(imageFrame, imageFile)) {
            appendRenderLog("Status: not populated — graphic not visible after place/fit");
            warnings.push('Image #' + blockIndex + ' place/fit did not produce a visible graphic.');
            try {
                imageFrame.remove();
            } catch (removeFailedFrameError) {}
            return;
        }
        populatedCount += 1;
        appendRenderLog("Resolved image file: " + imageFile.fsName);
        appendRenderLog("Image status: populated (dynamic frame created on Content layer)");

        cleanCaption = trimString(data.caption || data.text || "");
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
        layoutState.cursorY = getImageContentBottomY(imageFrame) + DYNAMIC_LAYOUT.imageCaptionGap;
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
        populatedCount += 1;
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
    var textFrame;
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
    textLeft = logoLeft + logoWidth + LOGO_TEXT_GAP;
    textWidth = layoutBounds.right - textLeft;
    if (textWidth < 1) {
        textWidth = layoutBounds.right - layoutBounds.left;
    }
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

            textFrame.contents = cleanText;
            applyFrameStyle(textFrame, registryEntry.style);
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

function populateInJsonOrderDynamic(document, contentItems, scriptFolder) {
    var i;
    var item;
    var itemType;
    var data;
    var registryEntry;
    var typeCounts = {};
    var blockIndex;

    if (!layoutState) {
        layoutState = createLayoutState(document, document.pages[0]);
    }

    for (i = 0; i < contentItems.length; i++) {
        item = contentItems[i];
        itemType = normalizeBlockType(item.type);
        data = item.data || {};
        registryEntry = resolveRegistryEntry(itemType);

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

        if (registryEntry.kind === "text") {
            populateDynamicTextBlock(layoutState, document, registryEntry, itemType, data, blockIndex);
            continue;
        }

        logUnsupportedBlockType(itemType);
    }
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
        "imageCaption", "imageFigureNumber", "figureCaption", "logoText"
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
    BLOCK_REGISTRY.Topic.style = FRAME_STYLES.topic || FRAME_STYLES_DEFAULTS.topic;
    BLOCK_REGISTRY.SectionTitle.style = FRAME_STYLES.sectionTitle || FRAME_STYLES_DEFAULTS.sectionTitle;
    BLOCK_REGISTRY.SubSectionTitle.style = FRAME_STYLES.subSectionTitle || FRAME_STYLES_DEFAULTS.subSectionTitle;
    BLOCK_REGISTRY.FigureCaption.style = FRAME_STYLES.figureCaption || FRAME_STYLES_DEFAULTS.figureCaption;
    BLOCK_REGISTRY.Text.style = FRAME_STYLES.text || FRAME_STYLES_DEFAULTS.text;
    BLOCK_REGISTRY.Image.style = FRAME_STYLES.imageCaption || FRAME_STYLES_DEFAULTS.imageCaption;
    BLOCK_REGISTRY.ChapterNumber.style = FRAME_STYLES.chapterNumber || FRAME_STYLES_DEFAULTS.chapterNumber;
    BLOCK_REGISTRY.ChapterTitle.style = FRAME_STYLES.chapterTitle || FRAME_STYLES_DEFAULTS.chapterTitle;
    BLOCK_REGISTRY.LessonOverview.style = FRAME_STYLES.lessonOverview || FRAME_STYLES_DEFAULTS.lessonOverview;
    BLOCK_REGISTRY.ParagraphText.style = FRAME_STYLES.paragraphText || FRAME_STYLES_DEFAULTS.paragraphText;
    BLOCK_REGISTRY.LearningObjectives.style = FRAME_STYLES.learningObjectives || FRAME_STYLES_DEFAULTS.learningObjectives;
    BLOCK_REGISTRY.BulletList.style = FRAME_STYLES.bulletList || FRAME_STYLES_DEFAULTS.bulletList;
    BLOCK_REGISTRY.LogoWithText.style = FRAME_STYLES.logoText || FRAME_STYLES_DEFAULTS.logoText;
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
    var contentItems;
    var doc;
    var pdfFile;
    var w;
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
    
    // Load typography configuration from shared config file
    initializeStylesFromConfig(scriptFolderPath);
    rebuildBlockRegistry();
    
    flushRenderLog("started");

    if (!dataFile.exists) {
        throw new Error("tree_output.json not found at: " + dataFile.fsName);
    }

    if (!dataFile.open("r")) {
        throw new Error("Could not open tree_output.json for reading.");
    }
    rawJson = dataFile.read();
    dataFile.close();

    contentItems = parseJSON(rawJson);
    if (!contentItems || !contentItems.length) {
        throw new Error("tree_output.json is empty or invalid.");
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
        populateInJsonOrderDynamic(doc, contentItems, scriptFolderPath);
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