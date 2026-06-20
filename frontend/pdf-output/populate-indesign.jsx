// =============================================================================
// populate-indesign.jsx  (v9 — dedicated-frame layout)
// Reads tree_output.json and fills separate labeled frames in InDesign.
// Compatible with legacy ExtendScript (no JSON.parse).
// =============================================================================

// -----------------------------------------------------------------------------
// LEGACY JSON PARSER (json2.js style — works in ExtendScript ES3)
// -----------------------------------------------------------------------------
// ExtendScript in many InDesign versions does not include JSON.parse.
// This parser reads standard JSON objects, arrays, strings, and numbers.
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
// TEXT + STYLE HELPERS
// -----------------------------------------------------------------------------

function trimString(value) {
    return String(value).replace(/^\s+|\s+$/g, "");
}

// Styles matched to "sample test 4 pages.docx" / 4_Pages_word_template_class.json
var FRAME_STYLES = {
    lessonNumber: { pointSize: 14, bold: false, italic: false, leftIndent: 0, color: [46, 116, 181] },
    chapterOverview: { pointSize: 11, bold: false, italic: false, leftIndent: 0, color: [46, 116, 181] },
    topic: { pointSize: 11, bold: true, italic: false, leftIndent: 0, color: [31, 31, 31] },
    text: { pointSize: 12, bold: false, italic: false, leftIndent: 0, color: [31, 31, 31] },
    sectionTitle: { pointSize: 18, bold: false, italic: false, leftIndent: 0, color: [46, 116, 181] },
    imageCaption: { pointSize: 10, bold: false, italic: true, leftIndent: 0, color: [64, 64, 64] }
};

// Backend JSON block type -> style profile.
var TYPE_TO_STYLE = {
    LessonNumber: FRAME_STYLES.lessonNumber,
    ChapterOverview: FRAME_STYLES.chapterOverview,
    Topic: FRAME_STYLES.topic,
    Text: FRAME_STYLES.text,
    SectionTitle: FRAME_STYLES.sectionTitle
};

// Track skipped frames and how many frames were populated.
var warnings = [];
var populatedCount = 0;

// -----------------------------------------------------------------------------
// STEP 3 — Find text frames by Script Label
// -----------------------------------------------------------------------------
// In the InDesign DOM the Script Label property is called "label".
// Only TextFrame objects support .contents.

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

// -----------------------------------------------------------------------------
// STEP 3b — Image helpers (resolve path + place into a graphic frame)
// -----------------------------------------------------------------------------
// JSON is read-only from the backend — we do NOT change it.
// Backend may send URLs like "url.com/img.jpg" that don't match local filenames.
// Resolution order:
//   1. Use url/path as-is if the file exists
//   2. Try the filename part inside assets/
//   3. Fall back to assets/img_0001.png, img_0002.png by Image block order

function padImageIndex(number) {
    var numStr = String(number);

    while (numStr.length < 4) {
        numStr = "0" + numStr;
    }

    return numStr;
}

function resolveImageFile(urlOrPath, scriptFolder, imageIndex) {
    var normalized = String(urlOrPath).replace(/\\/g, "/");
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
        } catch (placeCheckError) {
            // This page item cannot hold a placed image.
        }
    }

    return null;
}

function fitFrameToContent(frame) {
    try {
        frame.fit(FitOptions.PROPORTIONALLY);
        return;
    } catch (fitErrorA) {
        // Try alternate enum name used in some InDesign versions.
    }

    try {
        frame.fit(FitOptions.proportionally);
    } catch (fitErrorB) {
        // Keep the placed image at its default size if fit fails.
    }
}

function placeImageInFrame(document, labelName, urlOrPath, scriptFolder, imageIndex) {
    var frame;
    var imageFile;

    if (!urlOrPath) {
        return;
    }

    frame = findPlaceableFrameByLabel(document, labelName);

    if (frame === null) {
        warnings.push(
            'Skipped "' + labelName + '": rectangle/graphic frame not found. ' +
            "Create a rectangle and set its Script Label to imageFrame."
        );
        return;
    }

    imageFile = resolveImageFile(urlOrPath, scriptFolder, imageIndex);

    if (imageFile === null) {
        warnings.push(
            'Image file not found for backend url: "' + urlOrPath + '". ' +
            "Expected a matching file in the assets folder."
        );
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
// STEP 4 — Apply character and paragraph formatting to a text frame
// -----------------------------------------------------------------------------
// Font families use different style names (Regular vs Roman, etc.).
// We try several common names and skip gracefully if none are available.

function ensureDocumentColor(document, colorName, rgb) {
    var color;

    try {
        color = document.colors.itemByName(colorName);
        return color;
    } catch (missingColor) {
        // Create the swatch the first time we need it.
    }

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

    if (!textRange || !style || !style.color) {
        return;
    }

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

    // First try setting fontStyle directly on the current font family.
    for (i = 0; i < candidates.length; i++) {
        try {
            textRange.fontStyle = candidates[i];
            return;
        } catch (styleError) {
            // Try the next common style name.
        }
    }

    // Fallback: request the font by "Family<Tab>Style" name.
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
        } catch (fontError) {
            // Try the next font style combination.
        }
    }
}

function applyFrameStyle(textFrame, style) {
    var story;
    var textRange;

    if (!textFrame || !style) {
        return;
    }

    story = textFrame.parentStory;

    if (!story || story.texts.length === 0) {
        return;
    }

    textRange = story.texts[0];

    if (style.pointSize) {
        try {
            textRange.pointSize = style.pointSize;
        } catch (sizeError) {
            warnings.push("Could not set point size on a frame.");
        }
    }

    applyFontStyleSafe(textRange, style.bold, style.italic);
    applyTextColor(textRange, style);

    if (style.leftIndent) {
        try {
            story.paragraphs[0].leftIndent = style.leftIndent;
        } catch (indentError) {
            warnings.push("Could not set left indent on a frame.");
        }
    }
}

// -----------------------------------------------------------------------------
// STEP 5 — Populate one labeled frame (skip + warn if missing)
// -----------------------------------------------------------------------------

function populateFrame(document, labelName, textContent, style) {
    var frame;
    var cleanText = trimString(textContent);

    if (!cleanText) {
        return;
    }

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
// STEP 6 — Populate dedicated labeled frames in JSON array order
// -----------------------------------------------------------------------------
// Each JSON block maps to its own Script Label (e.g. text1, chapterOverview3).
// See INDESIGN_TEMPLATE_MAPPING.md for the full label convention.

// Label prefix per JSON block type (see INDESIGN_TEMPLATE_MAPPING.md).
var TYPE_TO_LABEL_PREFIX = {
    LessonNumber: "lessonNumber",
    ChapterOverview: "chapterOverview",
    Topic: "topic",
    Text: "text",
    SectionTitle: "sectionTitle"
};

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
// STEP 7 — Export the active document as PDF
// -----------------------------------------------------------------------------

// Windows often prevents writing into Program Files. If tree_output.json lives under:
//   C:\Program Files\...\Scripts\Scripts Panel\...
// then exporting output.pdf to the same folder will fail.
//
// We try to export next to tree_output.json first (as requested). If that folder
// is not writable, we fall back to Desktop (or Documents) and report the path.

function canWriteToFolder(folder) {
    var testFile;
    var ok = false;

    try {
        testFile = File(folder + "/__pdf_export_test__.tmp");
        ok = testFile.open("w");
        if (ok) {
            testFile.write("ok");
            testFile.close();
            testFile.remove();
            return true;
        }
    } catch (e) {
        // Not writable.
    }

    return false;
}

function pickWritableExportFolder(preferredFolder) {
    // 1) Preferred folder (same as tree_output.json)
    if (preferredFolder && canWriteToFolder(preferredFolder)) {
        return preferredFolder;
    }

    // 2) Desktop
    try {
        if (Folder.desktop && canWriteToFolder(Folder.desktop.fsName)) {
            warnings.push("Export folder not writable; used Desktop instead.");
            return Folder.desktop.fsName;
        }
    } catch (e1) {}

    // 3) Documents (My Documents)
    try {
        if (Folder.myDocuments && canWriteToFolder(Folder.myDocuments.fsName)) {
            warnings.push("Export folder not writable; used Documents instead.");
            return Folder.myDocuments.fsName;
        }
    } catch (e2) {}

    // 4) Last resort: current folder (may still fail)
    return preferredFolder;
}

function exportActiveDocumentToPdf(document, preferredFolder) {
    var exportFolder = pickWritableExportFolder(preferredFolder);
    var pdfFile = File(exportFolder + "/output.pdf");
    var exportPreset;

    // Choose a PDF preset safely. itemByName is safer than item("name").
    try {
        exportPreset = app.pdfExportPresets.itemByName("[High Quality Print]");
        // Touching a property forces resolution; otherwise itemByName can be a lazy reference.
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
        // If no presets exist, export with default settings.
        document.exportFile(ExportFormat.PDF_TYPE, pdfFile);
    }

    return pdfFile;
}

// -----------------------------------------------------------------------------
// STEP 1 — Read and parse tree_output.json
// -----------------------------------------------------------------------------

var scriptFile = File($.fileName);
var scriptFolder = scriptFile.parent;
var dataFile = File(scriptFolder + "/tree_output.json");

if (!dataFile.exists) {
    alert("tree_output.json was not found.\n\nExpected location:\n" + dataFile.fsName);
    exit();
}

dataFile.open("r");
var rawJson = dataFile.read();
dataFile.close();

var contentItems;

try {
    contentItems = parseJSON(rawJson);
} catch (parseError) {
    alert("Could not parse tree_output.json:\n\n" + parseError.message);
    exit();
}

if (!contentItems || !contentItems.length) {
    alert("tree_output.json is empty or not a valid content array.");
    exit();
}

// -----------------------------------------------------------------------------
// STEP 2 — Get the active InDesign document
// -----------------------------------------------------------------------------

if (app.documents.length === 0) {
    var autoTemplate = File(scriptFolder + "/templates/projectX.indd");
    if (autoTemplate.exists) {
        try {
            app.open(autoTemplate);
        } catch (openTemplateError) {
            alert("Template open failed:\n\n" + openTemplateError.message);
            exit();
        }
    } else {
        alert("Please open an InDesign document first.\n\nTemplate not found at:\n" + autoTemplate.fsName);
        exit();
    }
}

var doc = app.activeDocument;

// -----------------------------------------------------------------------------
// STEP 8 — Populate all labeled frames from JSON
// -----------------------------------------------------------------------------

populateInJsonOrder(doc, contentItems, scriptFolder.fsName);

// -----------------------------------------------------------------------------
// STEP 9 — Export PDF next to tree_output.json
// -----------------------------------------------------------------------------

var pdfFile;
var successMessage;
var warningMessage = "";
var w;

try {
    pdfFile = exportActiveDocumentToPdf(doc, scriptFolder.fsName);
} catch (exportError) {
    alert(
        "Frames populated, but PDF export failed:\n\n" +
        exportError.message
    );
    exit();
}

if (warnings.length > 0) {
    warningMessage = "\n\nWarnings:\n";
    for (w = 0; w < warnings.length; w++) {
        warningMessage += "- " + warnings[w] + "\n";
    }
}

successMessage =
    "Document populated and exported successfully!\n\n" +
    "Frames populated: " + populatedCount + "\n" +
    "PDF saved to:\n" +
    pdfFile.fsName;

alert(successMessage);
