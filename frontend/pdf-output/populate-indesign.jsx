// =============================================================================
// populate-indesign.jsx (server-safe)
// Reads tree_output.json and fills labeled frames in InDesign.
// Exports output.pdf in the SAME folder as this script.
// =============================================================================

/* global app, File, Folder, ExportFormat, FitOptions, UserInteractionLevels, ColorModel, ColorSpace */

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
    if (f.open("w")) {
        f.write(content);
        f.close();
    }
}

function logInfo(scriptFolderPath, message) {
    try {
        writeTextFile(scriptFolderPath + "/render.log", message);
    } catch (e) {}
}

function logError(scriptFolderPath, message) {
    try {
        writeTextFile(scriptFolderPath + "/error.log", message);
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
// Styling maps
// -----------------------------------------------------------------------------
var FRAME_STYLES = {
    lessonNumber: { pointSize: 14, bold: false, italic: false, leftIndent: 0, color: [46, 116, 181] },
    chapterOverview: { pointSize: 11, bold: false, italic: false, leftIndent: 0, color: [46, 116, 181] },
    topic: { pointSize: 11, bold: true, italic: false, leftIndent: 0, color: [31, 31, 31] },
    text: { pointSize: 12, bold: false, italic: false, leftIndent: 0, color: [31, 31, 31] },
    sectionTitle: { pointSize: 18, bold: false, italic: false, leftIndent: 0, color: [46, 116, 181] },
    imageCaption: { pointSize: 10, bold: false, italic: true, leftIndent: 0, color: [64, 64, 64] }
};

var TYPE_TO_STYLE = {
    LessonNumber: FRAME_STYLES.lessonNumber,
    ChapterOverview: FRAME_STYLES.chapterOverview,
    Topic: FRAME_STYLES.topic,
    Text: FRAME_STYLES.text,
    SectionTitle: FRAME_STYLES.sectionTitle
};

var TYPE_TO_LABEL_PREFIX = {
    LessonNumber: "lessonNumber",
    ChapterOverview: "chapterOverview",
    Topic: "topic",
    Text: "text",
    SectionTitle: "sectionTitle"
};

var warnings = [];
var populatedCount = 0;

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

function clearLabeledTextFrames(document) {
    var i;
    var frame;
    var label;

    for (i = 0; i < document.textFrames.length; i++) {
        frame = document.textFrames[i];
        label = trimString(getItemLabel(frame));
        if (label) {
            frame.contents = "";
        }
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

function placeImageInFrame(document, labelName, urlOrPath, scriptFolder, imageIndex) {
    var frame;
    var imageFile;

    if (!urlOrPath) return;

    frame = findPlaceableFrameByLabel(document, labelName);
    if (frame === null) {
        warnings.push('Skipped "' + labelName + '": graphic frame not found.');
        return;
    }

    imageFile = resolveImageFile(urlOrPath, scriptFolder, imageIndex);
    if (imageFile === null) {
        warnings.push('Image file not found for "' + urlOrPath + '".');
        return;
    }

    try {
        frame.place(imageFile);
        fitFrameToContent(frame);
        populatedCount += 1;
    } catch (placeError) {
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

function populateFrame(document, labelName, textContent, style) {
    var frame;
    var cleanText = trimString(textContent || "");

    if (!cleanText) return;

    frame = findTextFrameByLabel(document, labelName);
    if (frame === null) {
        warnings.push('Skipped "' + labelName + '": text frame not found.');
        return;
    }

    frame.contents = cleanText;
    applyFrameStyle(frame, style);
    populatedCount += 1;
}

// -----------------------------------------------------------------------------
// Populate blocks in order
// -----------------------------------------------------------------------------
function resolveTextFrameLabel(document, baseLabel, index) {
    var numberedLabel = baseLabel + index;

    if (findTextFrameByLabel(document, numberedLabel) !== null) {
        return numberedLabel;
    }

    if (index === 1 && findTextFrameByLabel(document, baseLabel) !== null) {
        return baseLabel;
    }

    return numberedLabel;
}

function populateInJsonOrder(document, contentItems, scriptFolder) {
    var i;
    var item;
    var itemType;
    var data;
    var style;
    var text;
    var imageCount = 0;
    var typeCounts = {};
    var frameLabel;
    var captionLabel;
    var labelPrefix;
    var blockIndex;

    for (i = 0; i < contentItems.length; i++) {
        item = contentItems[i];
        itemType = item.type;
        data = item.data || {};

        if (itemType === "Image") {
            imageCount += 1;
            frameLabel = "imageFrame" + imageCount;
            captionLabel = "imageCaption" + imageCount;

            if (findPlaceableFrameByLabel(document, frameLabel) === null && imageCount === 1) {
                frameLabel = "imageFrame";
            }
            if (findTextFrameByLabel(document, captionLabel) === null && imageCount === 1) {
                captionLabel = "imageCaption";
            }

            placeImageInFrame(document, frameLabel, data.url, scriptFolder, imageCount);
            populateFrame(document, captionLabel, data.caption, FRAME_STYLES.imageCaption);
            continue;
        }

        style = TYPE_TO_STYLE[itemType];
        labelPrefix = TYPE_TO_LABEL_PREFIX[itemType];

        if (!style || !labelPrefix) {
            warnings.push('Skipped unknown block type: "' + itemType + '".');
            continue;
        }

        if (!typeCounts[itemType]) {
            typeCounts[itemType] = 0;
        }
        typeCounts[itemType] += 1;
        blockIndex = typeCounts[itemType];

        text = data.text || "";
        frameLabel = resolveTextFrameLabel(document, labelPrefix, blockIndex);
        populateFrame(document, frameLabel, text, style);
    }
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

    if (app.documents.length === 0) {
        if (!autoTemplate.exists) {
            throw new Error("No open document and template not found at: " + autoTemplate.fsName);
        }
        app.open(autoTemplate);
    }

    doc = app.activeDocument;
    clearLabeledTextFrames(doc);
    populateInJsonOrder(doc, contentItems, scriptFolderPath);
    pdfFile = exportActiveDocumentToPdf(doc, scriptFolderPath);

    if (warnings.length > 0) {
        warningText = "Warnings:\n";
        for (w = 0; w < warnings.length; w++) {
            warningText += "- " + warnings[w] + "\n";
        }
    }

    logInfo(
        scriptFolderPath,
        "PDF export success\n" +
        "Frames populated: " + populatedCount + "\n" +
        "PDF: " + pdfFile.fsName + "\n" +
        warningText
    );
}

try {
    main();
} catch (e) {
    var scriptPathForError = File($.fileName).parent.fsName;
    logError(scriptPathForError, "PDF render failed: " + e.message);
    throw e;
}