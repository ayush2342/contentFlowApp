#target indesign
// =============================================================================
// clients/cengage/populate.jsx
// Fill templates/projectX.indd from tree_output.json using EXISTING template
// geometry + paragraph styles (CHN/CHT/COOBT/COOB/TX1/T1/FIGORTABLE…).
// Does NOT invent typography. Exports output.pdf + output.indd.
// =============================================================================

/* global app, File, Folder, ExportFormat, SaveOptions, UserInteractionLevels,
   FitOptions, MeasurementUnits, LocationOptions, Nothing, AutoSizingTypeEnum,
   CoordinateSpaces, AnchorPoint, ResizeMethods, ScriptLanguage,
   ParagraphShadingWidthOptions, Justification, TextWrapModes, SpecialCharacters,
   OverrideType, PageSideOptions, ColorModel, ColorSpace, AnchorPosition, Position */

app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
try { app.linkingPreferences.checkLinksAtOpen = false; } catch (e0) {}

(function main() {
    var CLIENT_ID = "cengage";
    var scriptFolder = File($.fileName).parent;
    // When living under pdf-output/clients/<id>, allow fallbacks to pdf-output root.
    var workspaceRoot = scriptFolder;
    try {
        if (scriptFolder.parent && String(scriptFolder.parent.name) === "clients") {
            workspaceRoot = scriptFolder.parent.parent;
        }
    } catch (eRoot) {}

    var logFile = File(scriptFolder + "/bake.log");
    var renderStatusFile = File(scriptFolder + "/render.log");
    var templateFile = File(scriptFolder + "/templates/projectX.indd");
    var jsonFile = File(scriptFolder + "/tree_output.json");
    var pdfFile = File(scriptFolder + "/output.pdf");
    var inddOutFile = File(scriptFolder + "/output.indd");
    var doc;
    var warnings = [];
    var populated = 0;
    var bodyTxCount = 0;
    var imageIndex = 0;
    var usedLocalAssets = {};
    var VERSION = "cengage-v58-column-gap";

    /**
     * InDesign 2026 renamed the boolean to paragraphShadingOn.
     * Older builds used paragraphShading. Always go through these helpers.
     */
    function getShadingOn(obj) {
        if (!obj) return false;
        try { return !!obj.paragraphShadingOn; } catch (e0) {}
        try { return !!obj.paragraphShading; } catch (e1) {}
        return false;
    }
    function setShadingOn(obj, on) {
        if (!obj) return false;
        try { obj.paragraphShadingOn = !!on; return true; } catch (e0) {}
        try { obj.paragraphShading = !!on; return true; } catch (e1) {}
        return false;
    }
    function isNonPrintColor(sw) {
        var n;
        try { n = String(sw && sw.name || ""); } catch (e) { return true; }
        return !n || /^(Black|Paper|None|Registration|\[None\])$/i.test(n);
    }

    // Geometry fingerprints for CO-Verso content frames (client page 58).
    // projectX is currently in POINTS (pica values * 12 after earlier unit save).
    var CO_ROLES = [
        { role: "CHPN", top: 26.49, left: 35.0, tol: 8 },
        { role: "CHN", top: 355.375, left: 36.0, tol: 8 },
        { role: "CHT", top: 422.7, left: 36.0, tol: 8 },
        { role: "COOBT", top: 557.125, left: 36.0, tol: 8 },
        { role: "COOB", top: 612.0, left: 36.0, tol: 8 },
        { role: "PHCR", top: 332.925, left: 472.4, tol: 12 },
        { role: "RH", top: 726.0, left: 36.0, tol: 8 }
    ];
    var HERO_BOUNDS = { top: -9, left: -9, bottom: 342.75, right: 612, tol: 12 };

    var STYLE_BY_TYPE = {
        PartNumber: "CHPN",
        ChapterNumber: "CHN",
        LessonNumber: "CHN",
        ChapterTitle: "CHT",
        LessonTitle: "H1",
        ChapterOverview: "COOBT",
        LearningObjectives: "COOBT",
        LessonOverview: "COOB",
        Topic: "H1",
        SectionTitle: "MGOB_firstlast",
        SubSectionTitle: "H2",
        GreenSubSectionTitle: "H2",
        SubSectionHeading: "H3",
        SubTitle: "H3",
        SubTitlesList: "H2",
        ParagraphText: "TX1",
        Text: "TX1",
        Quotation: "EXT1",
        Quote: "EXT1",
        PullQuote: "EXT1",
        Extract: "EXT1",
        FigureCaption: "PHCAP",
        ImageCaption: "PHCAP"
    };

    function log(msg) {
        var line = String(msg || "");
        try {
            logFile.encoding = "UTF-8";
            if (logFile.open("a")) {
                logFile.write(line + "\n");
                logFile.close();
            }
        } catch (e1) {}
        try { $.writeln(line); } catch (e2) {}
    }

    function trim(s) {
        return String(s || "").replace(/^\s+|\s+$/g, "");
    }

    var MK_SUP_ON = "\uE001", MK_SUP_OFF = "\uE002";
    var MK_ITAL_ON = "\uE003", MK_ITAL_OFF = "\uE004";
    var MK_BOLD_ON = "\uE005", MK_BOLD_OFF = "\uE006";
    var MK_KT_ON = "\uE007", MK_KT_OFF = "\uE008";
    var inlineRuns = [];

    function readUtf8(file) {
        if (!file.exists) return null;
        file.encoding = "UTF-8";
        if (!file.open("r")) return null;
        var t = file.read();
        file.close();
        return t;
    }

    function parseJson(text) {
        if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
        return eval("(" + text + ")");
    }

    function itemLabel(item) {
        try { return trim(item.label || ""); } catch (e) { return ""; }
    }

    function near(a, b, tol) {
        return Math.abs(Number(a) - Number(b)) <= tol;
    }

    function findParaStyle(docRef, leafName) {
        var style = null;
        var i;
        function searchGroup(group) {
            var child;
            var nested;
            var j;
            try {
                child = group.paragraphStyles.itemByName(leafName);
                if (child && child.isValid) return child;
            } catch (e1) {}
            try {
                nested = group.paragraphStyleGroups;
                for (j = 0; j < nested.length; j++) {
                    child = searchGroup(nested[j]);
                    if (child) return child;
                }
            } catch (e2) {}
            return null;
        }
        try {
            style = docRef.paragraphStyles.itemByName(leafName);
            if (style && style.isValid) return style;
        } catch (e3) {}
        try {
            for (i = 0; i < docRef.paragraphStyleGroups.length; i++) {
                style = searchGroup(docRef.paragraphStyleGroups[i]);
                if (style) return style;
            }
        } catch (e4) {}
        return null;
    }

    /** projectX.textDefaults ships with KTRM (magenta 10pt) — strip it or every paste inherits it. */
    function noneCharacterStyle(docRef) {
        try {
            var none = docRef.characterStyles.itemByName("[None]");
            if (none && none.isValid) return none;
        } catch (e) {}
        try {
            return docRef.characterStyles[0];
        } catch (e2) {}
        return null;
    }

    function resetTextDefaults(docRef) {
        try {
            var none = noneCharacterStyle(docRef);
            if (none) docRef.textDefaults.appliedCharacterStyle = none;
        } catch (e1) {}
        try {
            var tx1 = findParaStyle(docRef, "TX1");
            if (tx1) docRef.textDefaults.appliedParagraphStyle = tx1;
        } catch (e2) {}
    }

    /**
     * Re-assert spacing/geometry from the template paragraph style.
     * Do not touch fill/font here — nested styles (H1Number, LONUM) own those.
     * MUST copy paragraphShading — extract/quote styles (EXT1) use a green band.
     */
    function docFromPara(para) {
        try { return para.parentStory.parent; } catch (e0) {}
        return null;
    }

    /**
     * Spot / Pantone rule colors often export as nothing in browser PDF viewers.
     * Keep process inks as-is; clone any other swatch into a process color.
     */
    function strokeProcessColor(docRef, swatch) {
        var name;
        var cv;
        var space;
        var sw;
        if (!swatch) return null;
        try { if (!swatch.isValid) return null; } catch (eV) { return null; }
        try {
            if (swatch.model === ColorModel.PROCESS) return swatch;
        } catch (eM) {}
        if (!docRef) return swatch;
        try {
            name = "CF_INK_" + String(swatch.name).replace(/[^A-Za-z0-9]+/g, "_").substring(0, 40);
        } catch (eN) { name = "CF_INK_Rule"; }
        try {
            sw = docRef.colors.itemByName(name);
            if (sw && sw.isValid) return sw;
        } catch (eFind) {}
        try { cv = swatch.colorValue; } catch (eCv) { cv = [0, 0, 0, 100]; }
        try { space = swatch.space; } catch (eSp) { space = ColorSpace.CMYK; }
        try {
            if (space === ColorSpace.LAB) {
                space = ColorSpace.CMYK;
                cv = [0, 0, 0, 80];
            }
        } catch (eLab) {}
        try {
            sw = docRef.colors.add({
                name: name,
                model: ColorModel.PROCESS,
                space: space,
                colorValue: cv
            });
            if (sw && sw.isValid) return sw;
        } catch (eAdd) {}
        try {
            sw = docRef.colors.itemByName("Black");
            if (sw && sw.isValid) return sw;
        } catch (eB) {}
        return swatch;
    }

    function copyProp(dest, src, key) {
        try { dest[key] = src[key]; } catch (e) {}
    }

    function styleHasRuleOrBorder(style) {
        if (!style) return false;
        try { if (style.ruleAbove) return true; } catch (e1) {}
        try { if (style.ruleBelow) return true; } catch (e2) {}
        try { if (style.paragraphBorderOn) return true; } catch (e3) {}
        try { if (style.paragraphBorder) return true; } catch (e4) {}
        return false;
    }

    /** Paragraph rules and borders from the template style, in an ink PDF viewers paint. */
    function copyParagraphRules(para, style, docRef) {
        var ink;
        var tint;
        var weight;
        var above = false;
        var below = false;
        var border = false;
        if (!para || !style) return;
        if (!docRef) docRef = docFromPara(para);
        try { above = !!style.ruleAbove; } catch (eA) {}
        try { below = !!style.ruleBelow; } catch (eB) {}
        try { if (style.paragraphBorderOn) border = true; } catch (eD0) {}
        try { if (style.paragraphBorder) border = true; } catch (eD1) {}

        try { para.ruleAbove = above; } catch (eOn) {}
        if (above) {
            copyProp(para, style, "ruleAboveOffset");
            copyProp(para, style, "ruleAboveLeftIndent");
            copyProp(para, style, "ruleAboveRightIndent");
            copyProp(para, style, "ruleAboveType");
            copyProp(para, style, "ruleAboveWidth");
            copyProp(para, style, "ruleAboveGapColor");
            copyProp(para, style, "ruleAboveGapTint");
            try { para.ruleAboveOverprint = false; } catch (eOp) {}
            try { para.ruleAboveGapOverprint = false; } catch (eGop) {}
            try { weight = parseFloat(style.ruleAboveLineWeight); } catch (eWp) { weight = 0; }
            if (!(weight > 0)) weight = 0.5;
            try { para.ruleAboveLineWeight = weight; } catch (eW) {}
            try { tint = parseFloat(style.ruleAboveTint); } catch (eTp) { tint = 100; }
            if (!(tint > 0)) tint = 100;
            try { para.ruleAboveTint = tint; } catch (eT) {}
            try {
                ink = strokeProcessColor(docRef, style.ruleAboveColor);
                if (ink) para.ruleAboveColor = ink;
            } catch (eC) {}
        }

        try { para.ruleBelow = below; } catch (eOn2) {}
        if (below) {
            copyProp(para, style, "ruleBelowOffset");
            copyProp(para, style, "ruleBelowLeftIndent");
            copyProp(para, style, "ruleBelowRightIndent");
            copyProp(para, style, "ruleBelowType");
            copyProp(para, style, "ruleBelowWidth");
            copyProp(para, style, "ruleBelowGapColor");
            copyProp(para, style, "ruleBelowGapTint");
            try { para.ruleBelowOverprint = false; } catch (eOp2) {}
            try { para.ruleBelowGapOverprint = false; } catch (eGop2) {}
            try { weight = parseFloat(style.ruleBelowLineWeight); } catch (eWp2) { weight = 0; }
            if (!(weight > 0)) weight = 0.5;
            try { para.ruleBelowLineWeight = weight; } catch (eW2) {}
            try { tint = parseFloat(style.ruleBelowTint); } catch (eTp2) { tint = 100; }
            if (!(tint > 0)) tint = 100;
            try { para.ruleBelowTint = tint; } catch (eT2) {}
            try {
                ink = strokeProcessColor(docRef, style.ruleBelowColor);
                if (ink) para.ruleBelowColor = ink;
            } catch (eC2) {}
        }

        try { if (border) para.paragraphBorderOn = true; } catch (eBOn) {}
        try { if (border) para.paragraphBorder = true; } catch (eBOn2) {}
        if (border) {
            copyProp(para, style, "paragraphBorderType");
            copyProp(para, style, "paragraphBorderWeight");
            copyProp(para, style, "paragraphBorderTopLineWeight");
            copyProp(para, style, "paragraphBorderBottomLineWeight");
            copyProp(para, style, "paragraphBorderLeftLineWeight");
            copyProp(para, style, "paragraphBorderRightLineWeight");
            copyProp(para, style, "paragraphBorderTopOffset");
            copyProp(para, style, "paragraphBorderBottomOffset");
            copyProp(para, style, "paragraphBorderLeftOffset");
            copyProp(para, style, "paragraphBorderRightOffset");
            copyProp(para, style, "paragraphBorderWidth");
            copyProp(para, style, "paragraphBorderTopOrigin");
            copyProp(para, style, "paragraphBorderBottomOrigin");
            copyProp(para, style, "paragraphBorderGapTint");
            copyProp(para, style, "paragraphBorderGapColor");
            try { para.paragraphBorderOverprint = false; } catch (eBop) {}
            try { tint = parseFloat(style.paragraphBorderTint); } catch (eBtp) { tint = 100; }
            if (!(tint > 0)) tint = 100;
            try { para.paragraphBorderTint = tint; } catch (eBt) {}
            try {
                ink = strokeProcessColor(docRef, style.paragraphBorderColor);
                if (ink) para.paragraphBorderColor = ink;
            } catch (eBc) {}
        }
    }

    function syncParaMetricsFromStyle(para, style) {
        if (!para || !style) return;
        try { para.spaceBefore = style.spaceBefore; } catch (e1) {}
        try { para.spaceAfter = style.spaceAfter; } catch (e2) {}
        try { para.leading = style.leading; } catch (e3) {}
        try { para.firstLineIndent = style.firstLineIndent; } catch (e5) {}
        try { para.leftIndent = style.leftIndent; } catch (e6) {}
        try { para.rightIndent = style.rightIndent; } catch (e7) {}
        try { para.justification = style.justification; } catch (e8) {}
        copyParagraphRules(para, style, docFromPara(para));
        try { para.keepWithNext = style.keepWithNext; } catch (e20) {}
        try { para.hyphenation = style.hyphenation; } catch (e21) {}
        // Green extract/quote band (EXT1 etc.) — paragraph shading from template.
        // ID 2026: paragraphShadingOn (boolean). Color/tint/offsets still apply.
        try {
            if (getShadingOn(style)) setShadingOn(para, true);
        } catch (eSh0) {}
        try {
            if (style.paragraphShadingColor) {
                para.paragraphShadingColor = style.paragraphShadingColor;
            }
        } catch (eSh1) {}
        try { para.paragraphShadingTint = style.paragraphShadingTint; } catch (eSh2) {}
        try { para.paragraphShadingWidth = style.paragraphShadingWidth; } catch (eSh3) {}
        try { para.paragraphShadingTopOrigin = style.paragraphShadingTopOrigin; } catch (eSh4) {}
        try { para.paragraphShadingBottomOrigin = style.paragraphShadingBottomOrigin; } catch (eSh5) {}
        try { para.paragraphShadingLeftOffset = style.paragraphShadingLeftOffset; } catch (eSh6) {}
        try { para.paragraphShadingRightOffset = style.paragraphShadingRightOffset; } catch (eSh7) {}
        try { para.paragraphShadingTopOffset = style.paragraphShadingTopOffset; } catch (eSh8) {}
        try { para.paragraphShadingBottomOffset = style.paragraphShadingBottomOffset; } catch (eSh9) {}
    }

    function applyParaStyleClean(para, style, docRef) {
        var none = noneCharacterStyle(docRef);
        var styleName = "";
        if (!para || !style) return;
        try { styleName = String(style.name || ""); } catch (eN) {}
        try {
            if (none) para.applyCharacterStyle(none);
        } catch (e0) {}
        try {
            // clearingOverrides=true pulls spaceBefore/After, rules, leading from the style.
            para.applyParagraphStyle(style, true);
        } catch (apErr) {
            try { para.appliedParagraphStyle = style; } catch (e1) {}
            try { para.clearOverrides(OverrideType.ALL); } catch (ov1) {
                try { para.clearOverrides(); } catch (ov2) {}
            }
        }
        // Do NOT clearOverrides after apply for extract/quote styles — some ID
        // builds drop paragraphShading when overrides are wiped again.
        // The same wipe drops paragraph rules/borders (glossary rules above GL).
        if (!/^EXT/i.test(styleName) && !/QUOTE|PULL|BX/i.test(styleName) &&
                !styleHasRuleOrBorder(style)) {
            try { para.clearOverrides(OverrideType.ALL); } catch (ov3) {}
        }
        // Re-assert template metrics (+ shading for EXT*) in case sticky overrides remain.
        syncParaMetricsFromStyle(para, style);
        if (styleHasRuleOrBorder(style) && !applyParaStyleClean.ruleLogged) {
            applyParaStyleClean.ruleLogged = true;
            try {
                log("Paragraph rule restored => " + styleName +
                    " above=" + para.ruleAbove +
                    " weight=" + para.ruleAboveLineWeight +
                    " tint=" + para.ruleAboveTint +
                    " color=" + (para.ruleAboveColor ? para.ruleAboveColor.name : "?"));
            } catch (eRuleLog) {}
        }
        if (/^EXT/i.test(styleName)) {
            try {
                log("EXT style applied => " + styleName +
                    " shadingOn=" + getShadingOn(para) +
                    " color=" + (para.paragraphShadingColor ? para.paragraphShadingColor.name : "?"));
            } catch (eLog) {}
        }
    }

    function applyStyleToParagraphs(story, styleName, docRef, fromIndex, toIndex) {
        var style = findParaStyle(docRef, styleName);
        var i;
        var para;
        if (!style) {
            warnings.push('Missing paragraph style "' + styleName + '" in projectX.indd');
            log("MISSING STYLE => " + styleName);
            return false;
        }
        try {
            for (i = fromIndex; i < toIndex && i < story.paragraphs.length; i++) {
                para = story.paragraphs[i];
                if (trim(para.contents) === "") continue;
                applyParaStyleClean(para, style, docRef);
            }
            log("Applied style " + style.name + " to paragraphs " + fromIndex + ".." + (toIndex - 1));
            return true;
        } catch (e) {
            warnings.push("applyStyle failed " + styleName + ": " + e.message);
            return false;
        }
    }

    function applyStyleToFrame(frame, styleName, docRef) {
        if (!frame) return false;
        return applyStyleToParagraphs(frame.parentStory, styleName, docRef, 0, frame.parentStory.paragraphs.length);
    }

    /** COOB nested style LONUM runs through the first EN SPACE. */
    function withCoobEnSpace(text) {
        // COOB's nested LONUM style (orange number) ends at the en-space, so the
        // JSON <b> wrapper is not needed — markers would block the ^\d match.
        var s = trim(stripMarkers(text));
        // "1-1 Define..." / "2-1a Something" → insert en-space after the code token.
        return s.replace(/^(\d+-\d+[a-zA-Z]?)\s+/, "$1\u2002");
    }

    function bringToFront(item) {
        try { item.bringToFront(); return true; } catch (e1) {}
        try {
            item.parent.pageItems.item(item.index); // no-op touch
        } catch (e2) {}
        return false;
    }

    function findLabeledAnywhere(page, label) {
        var list = collectByLabel(page, label);
        var i;
        var item;
        if (list.length) return list[0];
        list = overrideMasterLabeled(page, label);
        if (list.length) return list[0];
        try {
            if (page.appliedMaster) {
                for (i = 0; i < page.appliedMaster.allPageItems.length; i++) {
                    item = page.appliedMaster.allPageItems[i];
                    if (itemLabel(item) === label) {
                        try { return item.override(page); } catch (e) { return item; }
                    }
                }
            }
        } catch (e2) {}
        return null;
    }

    function hideItem(item) {
        if (!item) return;
        try { item.visible = false; } catch (e) {}
        // Hidden items with text wrap still reserve space — clear wrap.
        try {
            item.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
        } catch (e2) {
            try { item.textWrapPreferences.textWrapMode = 1852796517; } catch (e3) {}
        }
    }

    function shrinkFrameToContent(frame) {
        var b;
        var safety = 0;
        var left;
        var right;
        if (!frame) return;
        try {
            // Lock left/right — FRAME_TO_CONTENT can widen past the template
            // outer margin (e.g. opener COOB ending at ~571 instead of 540).
            try { b = frame.geometricBounds; left = b[1]; right = b[3]; } catch (e0) { return; }
            try { frame.fit(FitOptions.FRAME_TO_CONTENT); } catch (eFit) {}
            try {
                b = frame.geometricBounds;
                frame.geometricBounds = [b[0], left, b[2], right];
            } catch (eLock) {}
            try { frame.parentStory.recompose(); } catch (eR) {}
            // If still lots of empty height, trim bottom while content still fits.
            while (!frame.overflows && safety < 40) {
                safety += 1;
                b = frame.geometricBounds;
                if ((b[2] - b[0]) <= 20) break;
                frame.geometricBounds = [b[0], left, b[2] - 8, right];
                try { frame.parentStory.recompose(); } catch (e2) {}
                if (frame.overflows) {
                    frame.geometricBounds = [b[0], left, b[2], right];
                    try { frame.parentStory.recompose(); } catch (e3) {}
                    break;
                }
            }
        } catch (e) {}
    }

    /** Page-local geometricBounds for a labeled item on CO-Verso master. */
    function coVersoMasterLocalBounds(docRef, label) {
        var i;
        var j;
        var ms;
        var mp;
        var pb;
        var item;
        var g;
        try {
            for (i = 0; i < docRef.masterSpreads.length; i++) {
                ms = docRef.masterSpreads[i];
                if (String(ms.name) !== "CO-Verso") continue;
                try { mp = ms.pages[0]; pb = mp.bounds; } catch (ePb) {
                    pb = [0, 0, 783, 612];
                }
                for (j = 0; j < ms.allPageItems.length; j++) {
                    item = ms.allPageItems[j];
                    if (itemLabel(item) !== label) continue;
                    try { g = item.geometricBounds; } catch (eG) { continue; }
                    return {
                        top: g[0] - pb[0],
                        left: g[1] - pb[1],
                        bottom: g[2] - pb[0],
                        right: g[3] - pb[1]
                    };
                }
            }
        } catch (e) {}
        return null;
    }

    /**
     * Snap opener role frames to CO-Verso master geometry on the live page.
     * Spacing comes only from the template master — never invented margins.
     */
    function snapOpenerFramesToMaster(page, docRef) {
        var labels = ["CHPN", "CHPN_BG", "CHN", "CHT", "COOBT", "COOB", "PHCR", "HERO"];
        var li;
        var lab;
        var local;
        var fr;
        var pr;
        var bounds;
        var roleDef;
        var ri;
        try { pr = pageRect(page, docRef); } catch (ePr) {
            pr = { top: 0, left: 0, bottom: 783, right: 612, w: 612, h: 783 };
        }
        for (li = 0; li < labels.length; li++) {
            lab = labels[li];
            local = coVersoMasterLocalBounds(docRef, lab);
            if (!local) {
                // Fall back to fingerprint table for text roles / hero.
                if (lab === "HERO") {
                    local = {
                        top: HERO_BOUNDS.top,
                        left: HERO_BOUNDS.left,
                        bottom: HERO_BOUNDS.bottom,
                        right: HERO_BOUNDS.right
                    };
                } else {
                    for (ri = 0; ri < CO_ROLES.length; ri++) {
                        if (CO_ROLES[ri].role === lab) {
                            roleDef = CO_ROLES[ri];
                            // Width from prior VERIFY / labeled master when known.
                            local = {
                                top: roleDef.top,
                                left: roleDef.left,
                                bottom: roleDef.top + 30,
                                right: (lab === "CHN" || lab === "CHPN") ? 294 : 540
                            };
                            if (lab === "CHT") local.bottom = 518;
                            if (lab === "COOBT") local.bottom = 596.25;
                            if (lab === "COOB") local.bottom = 679.55;
                            if (lab === "PHCR") {
                                local.left = 472.4;
                                local.bottom = 342.06;
                                local.right = 540;
                            }
                            break;
                        }
                    }
                }
            }
            if (!local) continue;
            fr = null;
            try {
                if (lab === "HERO") fr = findHeroFrame(page);
                else if (lab === "CHPN_BG") fr = findLabeledAnywhere(page, "CHPN_BG");
                else fr = getOrOverrideRoleFrame(page, lab === "PHCR" ? "PHCR" : lab);
            } catch (eF) { fr = null; }
            if (!fr) continue;
            bounds = [
                pr.top + local.top,
                pr.left + local.left,
                pr.top + local.bottom,
                pr.left + local.right
            ];
            try {
                fr.locked = false;
                fr.geometricBounds = bounds;
                log("Snap opener " + lab + " => local=" +
                    [local.top, local.left, local.bottom, local.right] +
                    " abs=" + bounds);
            } catch (eSet) {
                log("Snap opener " + lab + " failed: " + eSet.message);
            }
        }
    }

    /**
     * CO-Verso is a left-hand (verso) master. After front-matter trim, page 0
     * becomes document page 1 (recto) and facing geometry shifts ~36pt —
     * text loses the template ~72pt outer/right margin. Force an even folio
     * so the opener stays LEFT_HAND like client page 58.
     */
    function ensureOpenerIsVerso(docRef, page) {
        var sideBefore = "?";
        var sideAfter = "?";
        var sec;
        try { sideBefore = String(page.side); } catch (e0) {}
        try {
            sec = docRef.sections[0];
            sec.continueNumbering = false;
            sec.pageNumberStart = 58; // even => verso / LEFT_HAND
        } catch (e1) {
            log("Could not set section pageNumberStart=58: " + e1.message);
        }
        try { unlockAllSpreads(docRef); } catch (e2) {}
        try { sideAfter = String(page.side); } catch (e3) {}
        log("Opener page side => before=" + sideBefore + " after=" + sideAfter +
            " name=" + page.name + " bounds=" + page.bounds);
        return page;
    }

    function setOpenerCoobt(frame, titleText, introText, docRef) {
        var story;
        var body;
        var titleClean = trim(stripMarkers(stripHtml(titleText || "")));
        var introClean = trim(stripMarkers(stripHtml(introText || "")));
        if (!frame) {
            warnings.push("Missing COOBT frame");
            return;
        }
        try {
            try { frame.previousTextFrame = Nothing; } catch (ePrev) {}
            try { frame.nextTextFrame = Nothing; } catch (eNext) {}
            body = titleClean;
            if (introClean) {
                body = body + (body ? "\r" : "") + introClean;
            }
            if (!body) {
                hideItem(frame);
                return;
            }
            story = frame.parentStory;
            story.contents = body;
            if (story.paragraphs.length >= 1 && titleClean) {
                applyStyleToParagraphs(story, "COOBT", docRef, 0, 1);
            }
            if (story.paragraphs.length >= 2 && introClean) {
                applyStyleToParagraphs(story, "LOTX", docRef, 1, story.paragraphs.length);
            } else if (story.paragraphs.length === 1 && introClean && !titleClean) {
                applyStyleToParagraphs(story, "LOTX", docRef, 0, 1);
            }
            growFrameToFit(frame);
            shrinkFrameToContent(frame);
            populated += 1;
            log("setOpenerCoobt paras=" + story.paragraphs.length + " overflows=" + frame.overflows);
        } catch (e) {
            warnings.push("setOpenerCoobt failed: " + e.message);
        }
    }

    function findChapterStartPage(docRef) {
        var i;
        var page;
        for (i = 0; i < docRef.pages.length; i++) {
            if (trim(String(docRef.pages[i].name || "")) === "58") return docRef.pages[i];
        }
        for (i = 0; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            try {
                if (page.appliedMaster && String(page.appliedMaster.name).indexOf("CO-") === 0) {
                    return page;
                }
            } catch (e) {}
        }
        return docRef.pages[0];
    }

    function findBodyStartPage(docRef) {
        var i;
        var page;
        // Prefer absolute template name, else first TX-Text page in document order.
        for (i = 0; i < docRef.pages.length; i++) {
            if (trim(String(docRef.pages[i].name || "")) === "59") return docRef.pages[i];
        }
        for (i = 0; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            try {
                if (page.appliedMaster && String(page.appliedMaster.name).indexOf("TX-Text") >= 0) {
                    return page;
                }
            } catch (e) {}
        }
        return docRef.pages[0];
    }

    function pageIndexOf(docRef, page) {
        var i;
        try {
            if (page && page.documentOffset >= 0) return page.documentOffset;
        } catch (e0) {}
        for (i = 0; i < docRef.pages.length; i++) {
            try {
                if (docRef.pages[i] === page) return i;
            } catch (e1) {}
        }
        return -1;
    }

    function jsonHasOpenerPage(pagesArr) {
        var i;
        for (i = 0; i < pagesArr.length; i++) {
            if (String(pagesArr[i].page_type || "").toLowerCase() === "opener") return true;
        }
        return false;
    }

    function stripHtml(s) {
        var t = String(s || "");
        var prev;
        var safety;
        // Structural breaks before tag removal.
        t = t.replace(/<br\s*\/?>/gi, "\n");
        t = t.replace(/<\/p>/gi, "\n");
        t = t.replace(/<\/div>/gi, "\n");
        t = t.replace(/<\/li>/gi, "\n");
        // Inline semantics survive as private-use markers; appendParagraph maps
        // them to template character styles (FTN / ITAL / KTRM).
        t = t.replace(/<sup\b[^>]*>/gi, MK_SUP_ON).replace(/<\/sup\s*>/gi, MK_SUP_OFF);
        t = t.replace(/<(?:i|em)\b[^>]*>/gi, MK_ITAL_ON).replace(/<\/(?:i|em)\s*>/gi, MK_ITAL_OFF);
        t = t.replace(/<(?:b|strong)\b[^>]*>/gi, MK_BOLD_ON).replace(/<\/(?:b|strong)\s*>/gi, MK_BOLD_OFF);
        // Markdown: **term** is a key term (KTRM) only when the JSON colours it
        // purple; other **runs** (box run-in heads) are plain bold. *emphasis* = ITAL.
        var mdBold = /\*\*([\s\S]*?)\*\*/;
        var mdMatch;
        var isKeyTerm;
        for (safety = 0; safety < 400; safety++) {
            mdMatch = mdBold.exec(t);
            if (!mdMatch) break;
            isKeyTerm = /color:\s*#9f248f/i.test(mdMatch[1]);
            t = t.substring(0, mdMatch.index) +
                (isKeyTerm ? MK_KT_ON : MK_BOLD_ON) + mdMatch[1] + (isKeyTerm ? MK_KT_OFF : MK_BOLD_OFF) +
                t.substring(mdMatch.index + mdMatch[0].length);
        }
        t = t.replace(/\*\*/g, "");
        t = t.replace(/(^|[^\*\w])\*(?!\s)([^\*\n]+?)\*(?![\*\w])/g, "$1" + MK_ITAL_ON + "$2" + MK_ITAL_OFF);
        // Remove every HTML/XML tag (attrs may include quotes/newlines before '>').
        for (safety = 0; safety < 8; safety++) {
            prev = t;
            t = t.replace(/<[^>]*>/g, "");
            if (t === prev) break;
        }
        t = t.replace(/&nbsp;/gi, " ");
        t = t.replace(/&amp;/gi, "&");
        t = t.replace(/&lt;/gi, "<");
        t = t.replace(/&gt;/gi, ">");
        t = t.replace(/&quot;/gi, "\"");
        t = t.replace(/&#39;/gi, "'");
        t = t.replace(/&#x27;/gi, "'");
        t = t.replace(/&rsquo;/gi, "\u2019");
        t = t.replace(/&lsquo;/gi, "\u2018");
        t = t.replace(/&rdquo;/gi, "\u201D");
        t = t.replace(/&ldquo;/gi, "\u201C");
        t = t.replace(/&mdash;/gi, "\u2014");
        t = t.replace(/&ndash;/gi, "\u2013");
        t = t.replace(/&[a-zA-Z]+;/g, " ");
        // "**term **next" — keep the trailing space outside the styled run.
        t = t.replace(/(\s+)([\uE002\uE004\uE006\uE008])/g, "$2$1");
        return t;
    }

    function stripMarkers(s) {
        return String(s || "").replace(/[\uE001-\uE008]/g, "");
    }

    /**
     * Split marked text into plain text + runs [{start, end, kind}] (end exclusive).
     * Leading/trailing whitespace is trimmed and offsets adjusted.
     */
    function parseInlineRuns(marked) {
        var src = String(marked || "");
        var plain = "";
        var flags = [];
        var sup = 0, ital = 0, bold = 0, kt = 0;
        var i, c, lead, tail, runs, kind, prev, start;
        for (i = 0; i < src.length; i++) {
            c = src.charAt(i);
            if (c === MK_SUP_ON) { sup++; continue; }
            if (c === MK_SUP_OFF) { if (sup) sup--; continue; }
            if (c === MK_ITAL_ON) { ital++; continue; }
            if (c === MK_ITAL_OFF) { if (ital) ital--; continue; }
            if (c === MK_BOLD_ON) { bold++; continue; }
            if (c === MK_BOLD_OFF) { if (bold) bold--; continue; }
            if (c === MK_KT_ON) { kt++; continue; }
            if (c === MK_KT_OFF) { if (kt) kt--; continue; }
            plain += c;
            flags.push(sup ? "sup" : (kt ? "kt" : (bold ? "bold" : (ital ? "ital" : ""))));
        }
        lead = 0;
        while (lead < plain.length && /\s/.test(plain.charAt(lead))) lead++;
        tail = plain.length;
        while (tail > lead && /\s/.test(plain.charAt(tail - 1))) tail--;
        plain = plain.substring(lead, tail);
        flags = flags.slice(lead, tail);
        runs = [];
        prev = "";
        start = 0;
        for (i = 0; i <= flags.length; i++) {
            kind = i < flags.length ? flags[i] : "";
            if (kind !== prev) {
                if (prev) runs.push({ start: start, end: i, kind: prev });
                start = i;
                prev = kind;
            }
        }
        return { text: plain, runs: runs };
    }

    function collectByLabel(page, label) {
        var found = [];
        var i;
        var item;
        try {
            for (i = 0; i < page.allPageItems.length; i++) {
                item = page.allPageItems[i];
                if (itemLabel(item) === label) found.push(item);
            }
        } catch (e) {}
        return found;
    }

    function overrideMasterLabeled(page, label) {
        var found = [];
        var i;
        var item;
        var ov;
        try {
            if (!page.appliedMaster || !page.appliedMaster.isValid) return found;
            for (i = 0; i < page.appliedMaster.allPageItems.length; i++) {
                item = page.appliedMaster.allPageItems[i];
                if (itemLabel(item) !== label) continue;
                try {
                    ov = item.override(page);
                    found.push(ov || item);
                } catch (e1) {
                    found.push(item);
                }
            }
        } catch (e2) {}
        return found;
    }

    function labelCoVersoMaster(docRef) {
        var i;
        var j;
        var ms;
        var item;
        var b;
        var role;
        var labeled = 0;
        for (i = 0; i < docRef.masterSpreads.length; i++) {
            ms = docRef.masterSpreads[i];
            if (String(ms.name) !== "CO-Verso") continue;
            for (j = 0; j < ms.allPageItems.length; j++) {
                item = ms.allPageItems[j];
                try { b = item.geometricBounds; } catch (eB) { continue; }
                // Hero image rectangle: tall black area on left.
                try {
                    if (item instanceof Rectangle &&
                        near(b[0], HERO_BOUNDS.top, HERO_BOUNDS.tol) &&
                        near(b[2], HERO_BOUNDS.bottom, HERO_BOUNDS.tol) &&
                        (b[3] - b[1]) > 400) {
                        item.label = "HERO";
                        labeled += 1;
                        log("Labeled CO-Verso HERO rectangle bounds=" + b);
                        continue;
                    }
                } catch (eR) {}
                // Small orange Part-number chip behind CHPN.
                try {
                    if (item instanceof Rectangle &&
                        near(b[0], 21.6, 8) && near(b[1], -9, 8) &&
                        (b[2] - b[0]) < 40 && (b[3] - b[1]) < 140) {
                        item.label = "CHPN_BG";
                        labeled += 1;
                        log("Labeled CO-Verso CHPN_BG bounds=" + b);
                        continue;
                    }
                } catch (eBg) {}
                if (!(item instanceof TextFrame)) continue;
                // Skip tiny diagnostic-sized frames (< ~10pt tall).
                if ((b[2] - b[0]) < 10) continue;
                for (role = 0; role < CO_ROLES.length; role++) {
                    if (near(b[0], CO_ROLES[role].top, CO_ROLES[role].tol) &&
                        near(b[1], CO_ROLES[role].left, CO_ROLES[role].tol)) {
                        item.label = CO_ROLES[role].role;
                        labeled += 1;
                        log("Labeled CO-Verso " + CO_ROLES[role].role + " bounds=" + b);
                        break;
                    }
                }
            }
        }
        return labeled;
    }

    function getOrOverrideRoleFrame(page, role) {
        var list;
        var i;
        var item;
        var b;
        var r;
        var def;
        var candidates = [];

        // 1) Already-labeled PAGE items (not master).
        list = collectByLabel(page, role);
        for (i = 0; i < list.length; i++) {
            try {
                if (list[i].parentPage && list[i].parentPage === page) return list[i];
            } catch (e0) {}
        }

        // 2) Geometry match on PAGE items first (overrides sit above masters).
        for (r = 0; r < CO_ROLES.length; r++) {
            if (CO_ROLES[r].role !== role) continue;
            def = CO_ROLES[r];
            try {
                for (i = 0; i < page.allPageItems.length; i++) {
                    item = page.allPageItems[i];
                    if (!(item instanceof TextFrame)) continue;
                    try {
                        if (!item.parentPage || item.parentPage !== page) continue;
                    } catch (eP) { continue; }
                    b = item.geometricBounds;
                    if (near(b[0], def.top, def.tol) && near(b[1], def.left, def.tol)) {
                        try { item.label = role; } catch (labErr) {}
                        log("Using page override for " + role + " bounds=" + b);
                        return item;
                    }
                }
            } catch (e1) {}
        }

        // 3) Override labeled master item onto the page.
        list = overrideMasterLabeled(page, role);
        if (list.length) {
            log("Using master override for " + role);
            return list[0];
        }

        // 4) Geometry match on master items, then override.
        try {
            if (page.appliedMaster) {
                for (i = 0; i < page.appliedMaster.allPageItems.length; i++) {
                    candidates.push(page.appliedMaster.allPageItems[i]);
                }
            }
        } catch (e) {}
        for (r = 0; r < CO_ROLES.length; r++) {
            if (CO_ROLES[r].role !== role) continue;
            def = CO_ROLES[r];
            for (i = 0; i < candidates.length; i++) {
                item = candidates[i];
                try {
                    if (!(item instanceof TextFrame)) continue;
                    b = item.geometricBounds;
                    if (near(b[0], def.top, def.tol) && near(b[1], def.left, def.tol)) {
                        try {
                            item = item.override(page);
                        } catch (ovErr) {}
                        try { item.label = role; } catch (labErr) {}
                        log("Using geometry master->page for " + role);
                        return item;
                    }
                } catch (e2) {}
            }
        }
        return null;
    }

    function hideStrayBodyFrames(docRef, startPage) {
        var i;
        var j;
        var page;
        var item;
        var lab;
        var hidden = 0;
        for (i = startPage.documentOffset; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            try {
                if (!page.appliedMaster || String(page.appliedMaster.name).indexOf("TX-Text") < 0) {
                    continue;
                }
            } catch (e) { continue; }
            try {
                for (j = 0; j < page.textFrames.length; j++) {
                    item = page.textFrames[j];
                    lab = itemLabel(item);
                    if (lab === "T1" || lab === "RH" || lab === "RH_VERSO" || lab === "RH_RECTO") continue;
                    // Hide unlabeled leftover pasteboard/sample frames.
                    try {
                        if (!lab) {
                            item.visible = false;
                            hidden += 1;
                        }
                        if (lab === "S1" && trim(String(item.contents || "")) === "") {
                            item.visible = false;
                            hidden += 1;
                        }
                    } catch (eH) {}
                }
                // FIGORTABLE emptiness is handled after images are placed.
            } catch (e2) {}
        }
        log("Hidden stray/empty body text frames => " + hidden);
    }

    function frameVisibleTextLength(frame) {
        try {
            if (!frame) return 0;
            try {
                if (frame.characters && frame.characters.length) return frame.characters.length;
            } catch (eC) {}
            return trim(String(frame.contents || "").replace(/[\uFEFF\u0008\u0018]/g, "")).length;
        } catch (e) {
            return 0;
        }
    }

    function frameCenterOnPage(frame, page) {
        var fb;
        var pb;
        var cx;
        var cy;
        try {
            fb = frame.geometricBounds;
            pb = page.bounds;
            cy = (fb[0] + fb[2]) / 2;
            cx = (fb[1] + fb[3]) / 2;
            return cy >= pb[0] - 2 && cy <= pb[2] + 2 &&
                cx >= pb[1] - 2 && cx <= pb[3] + 2;
        } catch (e) {
            return true;
        }
    }

    function pageHasPlacedGraphics(page) {
        var i;
        var item;
        var pb;
        var b;
        var cx;
        var cy;
        try { pb = page.bounds; } catch (e0) { return false; }
        try {
            for (i = 0; i < page.pageItems.length; i++) {
                item = page.pageItems[i];
                try { if (item.visible === false) continue; } catch (eV) {}
                try {
                    if (!(item.graphics && item.graphics.length > 0)) continue;
                    b = item.geometricBounds;
                    cy = (b[0] + b[2]) / 2;
                    cx = (b[1] + b[3]) / 2;
                    if (cy >= pb[0] - 2 && cy <= pb[2] + 2 &&
                        cx >= pb[1] - 2 && cx <= pb[3] + 2) {
                        return true;
                    }
                } catch (eG) {}
            }
        } catch (e) {}
        return false;
    }

    /**
     * Only strip blank pages AFTER the last page that holds story text or graphics.
     * Never delete interstitial pages — that breaks visual continuity and can orphan
     * overset text when frames were clamped or reflowed.
     */
    function removeTrailingEmptyPages(docRef, headFrame, keepFirstPage) {
        var keep = {};
        var i;
        var cur;
        var page;
        var removed = 0;
        var safety = 0;
        var off;
        var len;
        var maxKeep = keepFirstPage ? 0 : -1;
        var names = [];

        if (keepFirstPage) keep[0] = true;

        try {
            cur = headFrame;
            while (cur && safety < 400) {
                safety += 1;
                try {
                    if (cur.parentPage) {
                        off = pageIndexOf(docRef, cur.parentPage);
                        if (off >= 0) {
                            keep[off] = true;
                            if (off > maxKeep) maxKeep = off;
                            len = frameVisibleTextLength(cur);
                            if (len >= 8) log("T1 chars on page index " + off + " => " + len);
                        }
                    }
                } catch (e1) {}
                if (!cur.nextTextFrame) break;
                cur = cur.nextTextFrame;
            }
        } catch (e2) {}

        for (i = 0; i < docRef.pages.length; i++) {
            if (pageHasPlacedGraphics(docRef.pages[i])) {
                keep[i] = true;
                if (i > maxKeep) maxKeep = i;
            }
        }

        // Keep a contiguous block 0..maxKeep; only remove pages after that.
        if (maxKeep < 0) maxKeep = 0;
        for (i = 0; i <= maxKeep && i < docRef.pages.length; i++) {
            names.push(String(docRef.pages[i].name));
        }
        log("Keeping content pages => " + names.join(", ") +
            " (count=" + names.length + ", maxKeep=" + maxKeep + ")");

        for (i = docRef.pages.length - 1; i > maxKeep; i--) {
            if (docRef.pages.length <= 1) break;
            try {
                page = docRef.pages[i];
                log("Removing trailing empty page => name=" + page.name +
                    " master=" + (page.appliedMaster ? page.appliedMaster.name : "(none)"));
                page.remove();
                removed += 1;
            } catch (rmErr) {
                warnings.push("Could not remove empty page: " + rmErr.message);
            }
        }

        log("Removed trailing empty pages => " + removed + "; pages kept => " + docRef.pages.length);
        return removed;
    }

    /**
     * True when the page shows body copy or a figure. Footer frames (RH*) do
     * not count — a folio on an otherwise blank page is still an empty page.
     */
    function pageHasVisibleBody(page) {
        var j;
        var item;
        var lab;
        var raw;
        if (pageHasPlacedGraphics(page)) return true;
        try {
            for (j = 0; j < page.textFrames.length; j++) {
                item = page.textFrames[j];
                lab = itemLabel(item);
                if (lab === "RH" || lab === "RH_VERSO" || lab === "RH_RECTO") continue;
                try { if (item.visible === false) continue; } catch (eV) {}
                raw = "";
                try { raw = String(item.contents || ""); } catch (eC) { raw = ""; }
                raw = trim(raw.replace(/[\uFEFF\u0008\u0018\uFFFC\r\n]/g, ""));
                if (raw) return true;
            }
        } catch (e) {}
        return false;
    }

    /**
     * Drop interior pages whose body frames are empty after the final reflow.
     * Space-before suppression can pull a short overflow back onto the previous
     * page and leave the overflow page blank (footer only). Trailing-only
     * removal keeps those pages because their empty frames are still threaded.
     * Deleting an empty threaded frame rejoins the story; keep page 0.
     */
    function removeInteriorEmptyPages(docRef) {
        var i;
        var page;
        var removed = 0;
        for (i = docRef.pages.length - 1; i >= 1; i--) {
            page = docRef.pages[i];
            if (pageHasVisibleBody(page)) continue;
            try {
                log("Removing empty body page => index=" + i + " name=" + page.name);
                page.remove();
                removed += 1;
            } catch (eR) {
                warnings.push("Could not remove empty body page: " + eR.message);
                log("Could not remove empty body page " + i + ": " + eR.message);
            }
        }
        log("Removed empty body pages => " + removed + "; pages kept => " + docRef.pages.length);
        return removed;
    }

    /** Drop leftover template pages so overflow always adds clean TX pages. */
    function trimToMinimalStartPages(docRef, hasOpenerFlag) {
        var i;
        var firstTx = -1;
        var removed = 0;
        if (!hasOpenerFlag) {
            while (docRef.pages.length > 1) {
                try {
                    docRef.pages[docRef.pages.length - 1].remove();
                    removed += 1;
                } catch (e) { break; }
            }
            log("Trimmed to single body start page; removed trailing template => " + removed);
            return docRef.pages[0];
        }
        for (i = 0; i < docRef.pages.length; i++) {
            try {
                if (docRef.pages[i].appliedMaster &&
                    String(docRef.pages[i].appliedMaster.name).indexOf("TX-Text") >= 0) {
                    firstTx = i;
                    break;
                }
            } catch (e1) {}
        }
        if (firstTx < 0) return docRef.pages[0];
        while (docRef.pages.length > firstTx + 1) {
            try {
                docRef.pages[docRef.pages.length - 1].remove();
                removed += 1;
            } catch (e2) { break; }
        }
        log("Trimmed after first TX body page; removed trailing template => " + removed);
        return docRef.pages[0];
    }

    function hideUnusedFigures(docRef, startPage) {
        var i;
        var j;
        var page;
        var item;
        var lab;
        var hidden = 0;
        for (i = startPage.documentOffset; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            try {
                for (j = 0; j < page.allPageItems.length; j++) {
                    item = page.allPageItems[j];
                    lab = itemLabel(item);
                    // Collapse unused figure placeholders and any empty wrapped graphics.
                    try {
                        if (lab === "FIGORTABLE" || lab === "S1") {
                            var emptyFig = true;
                            try {
                                if (item.graphics && item.graphics.length > 0) emptyFig = false;
                            } catch (eG) {}
                            try {
                                if (item instanceof TextFrame && trim(String(item.contents || ""))) {
                                    emptyFig = false;
                                }
                            } catch (eT) {}
                            if (emptyFig) {
                                hideItem(item);
                                hidden += 1;
                            }
                            continue;
                        }
                    } catch (eF) {}

                    // Any unlabeled empty rectangle that still wraps text.
                    try {
                        if (!lab && (item instanceof Rectangle)) {
                            var hasArt = false;
                            try { hasArt = item.graphics && item.graphics.length > 0; } catch (eA) {}
                            if (!hasArt) {
                                try {
                                    if (item.textWrapPreferences.textWrapMode !== TextWrapModes.NONE) {
                                        hideItem(item);
                                        hidden += 1;
                                    }
                                } catch (eW) {
                                    hideItem(item);
                                    hidden += 1;
                                }
                            }
                        }
                    } catch (eR) {}
                }
            } catch (e2) {}
        }
        try { docRef.recompose(); } catch (e3) {}
        log("Hidden unused FIGORTABLE/wrap placeholders => " + hidden);
    }

    function ensureCoobTwoColumns(frame, docRef) {
        var i;
        var j;
        var ms;
        var item;
        var gut = 12;
        var cols = 2;
        if (!frame) return;
        if (!docRef) {
            try { docRef = frame.parentPage.parent.parent; } catch (eD) { docRef = null; }
        }
        if (docRef) {
            try {
                for (i = 0; i < docRef.masterSpreads.length; i++) {
                    ms = docRef.masterSpreads[i];
                    if (String(ms.name) !== "CO-Verso") continue;
                    for (j = 0; j < ms.allPageItems.length; j++) {
                        item = ms.allPageItems[j];
                        if (itemLabel(item) !== "COOB") continue;
                        if (!(item instanceof TextFrame)) continue;
                        try { cols = item.textFramePreferences.textColumnCount || 2; } catch (eC) {}
                        try { gut = item.textFramePreferences.textColumnGutter; } catch (eG) {}
                        break;
                    }
                }
            } catch (eM) {}
        }
        try {
            frame.textFramePreferences.textColumnCount = cols;
            try { frame.textFramePreferences.textColumnGutter = gut; } catch (eG2) {}
            log("COOB frame set to " + cols + " columns gutter=" + gut + " (from template)");
        } catch (e) {
            warnings.push("Could not set COOB columns: " + e.message);
        }
    }

    function growFrameToFit(frame) {
        var b;
        var safety = 0;
        if (!frame) return;
        try {
            while (frame.overflows === true && safety < 30) {
                safety += 1;
                b = frame.geometricBounds;
                frame.geometricBounds = [b[0], b[1], b[2] + 14, b[3]];
                try { frame.parentStory.recompose(); } catch (eR) {}
            }
            if (safety) log("Grew frame to fit; steps=" + safety + " overflows=" + frame.overflows);
        } catch (e) {
            warnings.push("growFrameToFit failed: " + e.message);
        }
    }

    /**
     * After template snap, COOB may clip extra LessonOverview lines (e.g. 5-5/5-6).
     * Keep master left/right/top; grow bottom only until all copy is visible,
     * stopping above the RH band (~726) so margins stay template-faithful.
     */
    function fitOpenerCoobToContent(page, docRef) {
        var frame;
        var local;
        var pr;
        var left;
        var right;
        var top;
        var bottom;
        var maxBottom;
        var safety = 0;
        var story;
        var total = 0;
        var visible = 0;
        var needsGrow;

        try { frame = getOrOverrideRoleFrame(page, "COOB"); } catch (e0) { frame = null; }
        if (!frame) return;
        try { ensureCoobTwoColumns(frame, docRef); } catch (eCols) {}

        local = coVersoMasterLocalBounds(docRef, "COOB");
        try { pr = pageRect(page, docRef); } catch (ePr) {
            pr = { top: 0, left: 0, bottom: 783, right: 612, w: 612, h: 783 };
        }
        if (local) {
            left = pr.left + local.left;
            right = pr.left + local.right;
            top = pr.top + local.top;
            bottom = pr.top + local.bottom;
        } else {
            try {
                var gb0 = frame.geometricBounds;
                left = gb0[1];
                right = gb0[3];
                top = gb0[0];
                bottom = gb0[2];
            } catch (eGb) { return; }
        }
        // Stay above running head / footer furniture (template RH top ~726).
        maxBottom = pr.top + 720;
        try {
            frame.locked = false;
            frame.geometricBounds = [top, left, bottom, right];
        } catch (eSet) {}

        try { story = frame.parentStory; } catch (eS) { story = null; }
        while (safety < 40) {
            safety += 1;
            try { if (story && story.recompose) story.recompose(); } catch (eR) {}
            needsGrow = false;
            try { if (frame.overflows === true) needsGrow = true; } catch (eO) {}
            try {
                total = story ? story.characters.length : 0;
                visible = frame.characters ? frame.characters.length : 0;
                if (total > visible + 1) needsGrow = true;
            } catch (eC) {}
            if (!needsGrow) break;
            bottom += 12;
            if (bottom > maxBottom) {
                bottom = maxBottom;
                try { frame.geometricBounds = [top, left, bottom, right]; } catch (eMax) {}
                log("COOB hit max bottom=" + bottom + " still overset");
                break;
            }
            try { frame.geometricBounds = [top, left, bottom, right]; } catch (eGrow) { break; }
        }
        log("fitOpenerCoobToContent => bounds=" + frame.geometricBounds +
            " overflows=" + frame.overflows +
            " paras=" + (function () {
                try { return frame.parentStory.paragraphs.length; } catch (eP) { return "?"; }
            }()) +
            " steps=" + safety);
    }

    function setFrameText(frame, text, styleName, docRef) {
        var story;
        var clean = trim(stripMarkers(stripHtml(text || "")));
        if (!frame) {
            warnings.push("Missing frame for style " + styleName);
            return;
        }
        try {
            if (!clean) {
                hideItem(frame);
                log("Hidden empty frame for style " + styleName);
                return;
            }
            // Opener slots must be independent frames. If COOBT is threaded into
            // COOB, the second paragraph overflows and is then wiped by COOB fill.
            try { frame.previousTextFrame = Nothing; } catch (ePrev) {}
            try { frame.nextTextFrame = Nothing; } catch (eNext) {}

            story = frame.parentStory;
            story.contents = clean.replace(/\n/g, "\r");
            applyStyleToFrame(frame, styleName, docRef);
            if (styleName === "COOB") {
                ensureCoobTwoColumns(frame, docRef);
            }
            // Do not shrink opener identity chips/titles — FRAME_TO_CONTENT can
            // detach/clear short CHPN overrides sitting over the hero.
            if (styleName !== "CHPN" && styleName !== "CHN" && styleName !== "CHT" &&
                styleName !== "PHCR" && styleName !== "PHCR_white") {
                growFrameToFit(frame);
                if (frame.overflows !== true) {
                    shrinkFrameToContent(frame);
                }
                growFrameToFit(frame);
            }
            try { frame.visible = true; } catch (eVis) {}
            populated += 1;
            log("setFrameText " + styleName +
                " storyParas=" + story.paragraphs.length +
                " frameChars=" + String(frame.contents || "").length +
                " storyChars=" + String(story.contents || "").length +
                " overflows=" + frame.overflows);
        } catch (e) {
            warnings.push("setFrameText failed: " + e.message);
        }
    }

    function getStoryHeadFrame(frame) {
        var cur = frame;
        try { while (cur.previousTextFrame) cur = cur.previousTextFrame; } catch (e) {}
        return cur;
    }

    function getStoryTailFrame(frame) {
        var cur = frame;
        try { while (cur.nextTextFrame) cur = cur.nextTextFrame; } catch (e) {}
        return cur;
    }

    /**
     * Body top = template master T1 top (36pt). Client PDF: images at 36pt,
     * first text line bbox ~33pt. Left/right/bottom still come from the template.
     */
    var CLIENT_BODY_TOP = 36;

    function applyClientBodyTop(cols) {
        var i;
        if (!cols) return cols;
        for (i = 0; i < cols.length; i++) {
            try {
                if (cols[i] && cols[i].top != null && cols[i].top > CLIENT_BODY_TOP) {
                    cols[i].top = CLIENT_BODY_TOP;
                }
            } catch (e) {}
        }
        return cols;
    }

    function getMasterT1Columns(docRef) {
        return applyClientBodyTop(getMasterT1ColumnsForSide(docRef, false));
    }

    /** Page-local T1 columns from TX-Text master (verso or recto side). */
    function getMasterT1ColumnsForSide(docRef, useRightMaster) {
        var cols = [
            { top: CLIENT_BODY_TOP, left: 36, bottom: 702.54, right: 279 },
            { top: CLIENT_BODY_TOP, left: 297, bottom: 702.54, right: 540 }
        ];
        var i;
        var j;
        var ms;
        var mp;
        var pb;
        var item;
        var g;
        var found = [];
        var pageW = 612;
        try { pageW = Number(docRef.documentPreferences.pageWidth) || pageW; } catch (eW) {}
        try {
            for (i = 0; i < docRef.masterSpreads.length; i++) {
                ms = docRef.masterSpreads[i];
                if (String(ms.name).indexOf("TX-Text") < 0) continue;
                mp = ms.pages[0];
                if (useRightMaster && ms.pages.length > 1) {
                    try { mp = ms.pages[1]; } catch (eR) { mp = ms.pages[0]; }
                }
                try { pb = mp.bounds; } catch (ePb) { pb = [0, 0, 783, pageW]; }
                found = [];
                for (j = 0; j < ms.allPageItems.length; j++) {
                    item = ms.allPageItems[j];
                    if (itemLabel(item) !== "T1") continue;
                    if (!(item instanceof TextFrame)) continue;
                    try {
                        if (item.parentPage && item.parentPage !== mp) continue;
                    } catch (ePP) {}
                    try { g = item.geometricBounds; } catch (eG) { continue; }
                    found.push({
                        top: g[0] - pb[0],
                        left: g[1] - pb[1],
                        bottom: g[2] - pb[0],
                        right: g[3] - pb[1]
                    });
                }
                if (found.length >= 2) {
                    found.sort(function (a, b) { return a.left - b.left; });
                    if (!getMasterT1ColumnsForSide.logged) {
                        getMasterT1ColumnsForSide.logged = true;
                        log("Master T1 columns from INDD => " +
                            found[0].top + "," + found[0].left + "," + found[0].bottom + "," + found[0].right +
                            " / " +
                            found[1].top + "," + found[1].left + "," + found[1].bottom + "," + found[1].right);
                    }
                    return found.slice(0, 2);
                }
            }
        } catch (e) {}
        // Always keep verso page-local insets (36/279, 297/540) so both sides
        // retain the template ~72pt outer margin. Do not mirror to pageW-36.
        return cols;
    }

    /**
     * Book parity: opener (doc page 0) is folio 1 = recto. Body runs with
     * facingPages=false, so page.side is useless there — use documentOffset.
     */
    function isRightHandPage(page) {
        var docRef;
        try {
            docRef = page.parent.parent;
            if (docRef.documentPreferences.facingPages) {
                if (page.side && String(page.side).indexOf("RIGHT") >= 0) return true;
                if (page.side && String(page.side).indexOf("LEFT") >= 0) return false;
            }
        } catch (e0) {}
        try { return page.documentOffset % 2 === 0; } catch (e1) {}
        return false;
    }

    /** Client interior: recto columns sit 36pt right of verso (72/318, 333/579). */
    var RECTO_COLUMN_SHIFT = 36;

    function columnsForPage(docRef, page) {
        var cols = applyClientBodyTop(getMasterT1ColumnsForSide(docRef, false));
        var out = [];
        var i;
        var shift = isRightHandPage(page) ? RECTO_COLUMN_SHIFT : 0;
        for (i = 0; i < cols.length; i++) {
            out.push({
                top: cols[i].top,
                left: cols[i].left + shift,
                bottom: cols[i].bottom,
                right: cols[i].right + shift
            });
        }
        return out;
    }

    /** Reliable page rect: facing-pages docs often report stale 0..612 bounds on
     * newly added pages, then later correct spread coords — that parked recto
     * columns off-page and made every other PDF page look empty. */
    function pageRect(page, docRef) {
        var w = 612;
        var h = 783;
        var b;
        var left = 0;
        var top = 0;
        try {
            w = Number(docRef.documentPreferences.pageWidth) || w;
            h = Number(docRef.documentPreferences.pageHeight) || h;
        } catch (eW) {}
        try {
            b = page.bounds;
            // Trust bounds only when width matches the document page width.
            if (Math.abs((b[3] - b[1]) - w) < 1.5) {
                return { top: b[0], left: b[1], bottom: b[2], right: b[3], w: w, h: h };
            }
            // Stale/single-page bounds on a right-hand page: shift by page width.
            left = b[1];
            top = b[0];
            try {
                if (page.side && String(page.side).indexOf("RIGHT") >= 0 && left < w * 0.25) {
                    left = w;
                }
            } catch (eSide) {}
        } catch (eB) {}
        return { top: top, left: left, bottom: top + h, right: left + w, w: w, h: h };
    }

    /**
     * Place a T1 column using exact master page-local insets.
     * Never widen to pageRight-36 — that ate the ~72pt outer margin on recto/odd pages.
     */
    function t1BoundsOnPage(page, col, docRef) {
        var pr = pageRect(page, docRef || page.parent.parent);
        var pageTop = pr.top;
        var pageLeft = pr.left;
        var pageBottom = pr.bottom;
        var pageRight = pr.right;
        var pageW = pr.w;
        var leftInset = col.left;
        var rightInset = col.right;
        var topInset = col.top;
        var bottomInset = col.bottom;
        var outerMargin = 72;
        var x1;
        var x2;
        var y1;
        var y2;

        // Verso: 36 inner-left / 72 outer-right. Recto mirrors: 72 left / 36 right.
        try { outerMargin = Math.max(36, pageW - 540); } catch (eM) {}
        if (isRightHandPage(page)) outerMargin = Math.max(0, outerMargin - RECTO_COLUMN_SHIFT);

        if (leftInset < 0) leftInset = 36;
        if (rightInset > pageW) rightInset = pageW - outerMargin;
        if (rightInset - leftInset < 120) {
            if (leftInset < pageW * 0.4) {
                leftInset = 36;
                rightInset = 279;
            } else {
                leftInset = 297;
                rightInset = pageW - outerMargin;
            }
        }
        if (rightInset > pageW - outerMargin) rightInset = pageW - outerMargin;
        if (leftInset < 36) leftInset = 36;

        x1 = pageLeft + leftInset;
        x2 = pageLeft + rightInset;
        y1 = pageTop + topInset;
        y2 = pageTop + bottomInset;

        if (x2 > pageRight - outerMargin) x2 = pageRight - outerMargin;
        if (x1 < pageLeft + 36) x1 = pageLeft + 36;
        if (x2 <= x1 + 120) x2 = x1 + 243;
        if (y2 > pageBottom - 36) y2 = pageBottom - 36;
        if (y1 < pageTop + CLIENT_BODY_TOP) y1 = pageTop + CLIENT_BODY_TOP;
        return [y1, x1, y2, x2];
    }

    function forceT1FrameBounds(frame, page, col, docRef) {
        var bounds = t1BoundsOnPage(page, col, docRef);
        var gb;
        try { frame.locked = false; } catch (eL) {}
        // CRITICAL: auto-sizing grows the frame past the page trim so InDesign
        // reports no overset, but PDF export crops the spilled text.
        try {
            frame.textFramePreferences.autoSizingType = AutoSizingTypeEnum.OFF;
        } catch (eA) {
            try { frame.textFramePreferences.autoSizingType = 1852796517; } catch (eA2) {}
        }
        try { frame.textFramePreferences.textColumnCount = 1; } catch (eC) {}
        clearTextWrap(frame);
        try {
            frame.geometricBounds = bounds;
        } catch (e) {
            try {
                frame.move([bounds[1], bounds[0]]);
            } catch (eM) {}
        }
        try {
            gb = frame.geometricBounds;
            if (Math.abs(gb[3] - bounds[3]) > 0.75 || Math.abs(gb[2] - bounds[2]) > 0.75 ||
                Math.abs(gb[1] - bounds[1]) > 0.75) {
                try {
                    frame.resize(
                        CoordinateSpaces.PASTEBOARD_COORDINATES,
                        AnchorPoint.TOP_LEFT_ANCHOR,
                        ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH,
                        [bounds[3] - bounds[1], bounds[2] - bounds[0]]
                    );
                    frame.move([bounds[1], bounds[0]]);
                } catch (eR) {
                    try { frame.geometricBounds = bounds; } catch (eG2) {}
                }
            }
        } catch (eV) {}
        try {
            gb = frame.geometricBounds;
            if (Math.abs(gb[3] - bounds[3]) > 1 || gb[3] > bounds[3] + 1) {
                log("WARN forceT1 still wrong => got " + gb + " want " + bounds);
            }
        } catch (eW) {}
        return bounds;
    }

    function restoreFullColumnT1OnPage(page, masterCols) {
        var frames = [];
        var i;
        var item;
        var col;
        var target;
        var toDelete = [];
        var bounds;
        var docRef = null;
        var pr;
        var ov;

        try { docRef = page.parent.parent; } catch (eD) {}
        // Spacing from template master T1 only — never invent margins.
        try { masterCols = columnsForPage(docRef, page); } catch (eSide) {}
        if (!masterCols || masterCols.length < 2) {
            try { masterCols = getMasterT1Columns(docRef); } catch (eC) {
                masterCols = [
                    { top: CLIENT_BODY_TOP, left: 36, bottom: 702.54, right: 279 },
                    { top: CLIENT_BODY_TOP, left: 297, bottom: 702.54, right: 540 }
                ];
            }
        }
        try { pr = pageRect(page, docRef); } catch (ePr) {
            pr = { w: 612, left: 0, right: 612, top: 0, bottom: 783 };
        }

        // Override + remove master T1 so we own the thread; geometry still from
        // the template measurements copied into masterCols above.
        try {
            ov = overrideMasterLabeled(page, "T1");
            for (i = 0; i < ov.length; i++) {
                try { ov[i].remove(); } catch (eRm) {
                    try { ov[i].visible = false; } catch (eH) {}
                }
            }
        } catch (eOv) {}

        // Remove old page-level T1 overrides — they keep broken thread links / spilled bounds.
        try {
            for (i = page.textFrames.length - 1; i >= 0; i--) {
                item = page.textFrames[i];
                try {
                    if (itemLabel(item) !== "T1") continue;
                    if (item.parentPage !== page) continue;
                    toDelete.push(item);
                } catch (eP) {}
            }
            for (i = 0; i < toDelete.length; i++) {
                try { toDelete[i].remove(); } catch (eR) {}
            }
        } catch (e2) {}

        // Create two fresh full-height columns from template geometry.
        for (i = 0; i < 2; i++) {
            col = masterCols[i];
            bounds = t1BoundsOnPage(page, col, docRef);
            target = page.textFrames.add({ geometricBounds: bounds });
            target.label = "T1";
            bounds = forceT1FrameBounds(target, page, col, docRef);
            try { target.visible = true; } catch (eV) {}
            frames.push(target);
            try {
                var gb = target.geometricBounds;
                var localL = gb[1] - pr.left;
                var localR = gb[3] - pr.left;
                log("T1 create p" + page.name + " col" + i +
                    " top=" + (gb[0] - pr.top).toFixed(1) +
                    " local=" + localL.toFixed(1) + ".." + localR.toFixed(1) +
                    " rightMargin=" + (pr.w - localR).toFixed(1));
                if ((gb[3] - gb[1]) > pr.w * 0.55 ||
                    localR > pr.w - (isRightHandPage(page) ? 24 : 60)) {
                    log("WARN T1 bounds still wide on p" + page.name +
                        " => " + gb + " pageRect=" + [pr.top, pr.left, pr.bottom, pr.right]);
                    forceT1FrameBounds(target, page, col, docRef);
                }
            } catch (eChk) {}
        }
        return frames;
    }

    /** Refit every threaded T1 frame to master column geometry on its parent page. */
    function refitStoryT1Frames(head, docRef) {
        var masterCols;
        var cur = head;
        var safety = 0;
        var page;
        var lastPageId = null;
        var colIndex = 0;
        var fixed = 0;
        var before;
        var after;
        var pageId;

        while (cur && safety < 400) {
            safety += 1;
            try {
                page = cur.parentPage;
                if (page) {
                    pageId = String(page.id);
                    if (pageId !== lastPageId) {
                        colIndex = 0;
                        lastPageId = pageId;
                        masterCols = columnsForPage(docRef, page);
                    }
                    before = String(cur.geometricBounds);
                    forceT1FrameBounds(cur, page, masterCols[colIndex > 1 ? 1 : colIndex], docRef);
                    after = String(cur.geometricBounds);
                    if (before !== after) {
                        fixed += 1;
                        log("Refit T1 story frame p" + page.name +
                            " col" + colIndex + " " + before + " -> " + after);
                    }
                    colIndex += 1;
                }
            } catch (e1) {}
            if (!cur.nextTextFrame) break;
            cur = cur.nextTextFrame;
        }
        return fixed;
    }

    /** Repair any T1 whose right edge spills past the page (clips in PDF). */
    function clampAllT1FramesToPage(docRef, masterCols) {
        var i;
        var j;
        var page;
        var item;
        var b;
        var pr;
        var maxRight;
        var pageW;
        var fixed = 0;
        var colW = masterCols[1].right - masterCols[1].left;
        for (i = 0; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            try { pr = pageRect(page, docRef); } catch (e0) { continue; }
            pageW = pr.w;
            maxRight = pr.left + columnsForPage(docRef, page)[1].right;
            try {
                for (j = 0; j < page.textFrames.length; j++) {
                    item = page.textFrames[j];
                    if (itemLabel(item) !== "T1") continue;
                    try {
                        if (item.parentPage !== page) continue;
                    } catch (eP) { continue; }
                    try { b = item.geometricBounds; } catch (eB) { continue; }
                    if (b[3] > maxRight + 0.5 || (b[3] - b[1]) > colW + 30 || b[1] < pr.left - 0.5) {
                        var mid = (pr.left + pr.right) / 2;
                        var useRight = ((b[1] + b[3]) / 2) >= mid;
                        var pageCols = columnsForPage(docRef, page);
                        forceT1FrameBounds(item, page, pageCols[useRight ? 1 : 0], docRef);
                        fixed += 1;
                        log("Clamped T1 on p" + page.name + " right " + b[3] +
                            " -> " + item.geometricBounds[3]);
                    }
                }
            } catch (e1) {}
        }
        return fixed;
    }

    function clearTextWrap(item) {
        try {
            item.textWrapPreferences.textWrapMode = TextWrapModes.NONE;
        } catch (e1) {
            try { item.textWrapPreferences.textWrapMode = 1852796517; } catch (e2) {}
        }
    }

    function cleanupTxPageDetritus(page) {
        var i;
        var item;
        var lab;
        var removed = 0;
        var items;
        try { items = page.pageItems.everyItem().getElements(); } catch (e0) {
            items = [];
            try {
                for (i = page.pageItems.length - 1; i >= 0; i--) items.push(page.pageItems[i]);
            } catch (e1) {}
        }
        // Walk top-down copy because we may remove items.
        for (i = page.pageItems.length - 1; i >= 0; i--) {
            try { item = page.pageItems[i]; } catch (e2) { continue; }
            lab = itemLabel(item);
            // Keep structural labels; strip leftover client furniture.
            if (lab === "T1" || lab === "FIGORTABLE" || lab === "S1" || lab === "RH" ||
                lab === "RH_VERSO" || lab === "RH_RECTO") {
                if (lab === "FIGORTABLE" || lab === "S1") {
                    try {
                        if (!item.graphics || item.graphics.length === 0) {
                            clearTextWrap(item);
                            try { item.visible = false; } catch (eH) {}
                        }
                    } catch (eF) {
                        clearTextWrap(item);
                        try { item.visible = false; } catch (eH2) {}
                    }
                }
                continue;
            }
            try {
                clearTextWrap(item);
                item.visible = false;
                // Prefer remove for unlabeled leftover frames/rects that punch holes.
                try { item.remove(); removed += 1; } catch (eR) {}
            } catch (e3) {}
        }
        return removed;
    }

    function unlinkTextFrame(frame) {
        try { frame.nextTextFrame = Nothing; } catch (e1) {}
        try { frame.previousTextFrame = Nothing; } catch (e2) {}
        try { frame.contents = ""; } catch (e3) {}
    }

    function rebuildBodyColumnFlow(docRef, startPage) {
        var masterCols = getMasterT1Columns(docRef);
        var pageIndex;
        var page;
        var startIndex = startPage.documentOffset;
        var allFrames = [];
        var frames;
        var i;
        var junk = 0;
        var linked = 0;

        log("Master T1 columns => " +
            masterCols[0].left + ".." + masterCols[0].right + " / " +
            masterCols[1].left + ".." + masterCols[1].right);

        for (pageIndex = startIndex; pageIndex < docRef.pages.length; pageIndex++) {
            page = docRef.pages[pageIndex];
            try {
                if (!page.appliedMaster || String(page.appliedMaster.name).indexOf("TX-Text") < 0) {
                    continue;
                }
            } catch (e) { continue; }

            junk += cleanupTxPageDetritus(page);
            frames = restoreFullColumnT1OnPage(page, masterCols);
            for (i = 0; i < frames.length; i++) allFrames.push(frames[i]);
        }

        if (!allFrames.length) throw new Error("No T1 columns after rebuild");

        // Break every old thread first (each frame becomes its own empty story).
        for (i = 0; i < allFrames.length; i++) {
            unlinkTextFrame(allFrames[i]);
        }

        // Relink left→right, page→page into one story.
        for (i = 0; i < allFrames.length - 1; i++) {
            try {
                allFrames[i].nextTextFrame = allFrames[i + 1];
                linked += 1;
            } catch (linkErr) {
                warnings.push("T1 rethread failed at " + i + ": " + linkErr.message);
                log("T1 rethread failed at " + i + " => " + linkErr.message);
            }
        }

        try { allFrames[0].parentStory.contents = ""; } catch (eC) {
            try { allFrames[0].contents = ""; } catch (eC2) {}
        }

        // New text inherits doc.textDefaults — template defaults are INDSE3 + KTRM (magenta).
        resetTextDefaults(docRef);
        try {
            var tx1 = findParaStyle(docRef, "TX1");
            var none = noneCharacterStyle(docRef);
            if (tx1) allFrames[0].parentStory.appliedParagraphStyle = tx1;
            if (none) {
                try { allFrames[0].parentStory.appliedCharacterStyle = none; } catch (eAcs) {}
            }
        } catch (eDef) {}

        log("Rebuilt body columns => frames=" + allFrames.length +
            " linked=" + linked +
            " cleanedJunk=" + junk +
            " headPage=" + (allFrames[0].parentPage ? allFrames[0].parentPage.name : "?"));
        return allFrames[0];
    }

    function isJunkBodyText(type, text) {
        var t = trim(stripMarkers(text || ""));
        var ty = trim(type || "");
        if (ty === "footer" || ty === "Footer" || ty === "PageHeader" || ty === "header") {
            return true;
        }
        // Folio / running head lines incorrectly classified as ParagraphText.
        if (/^\d{1,3}$/.test(t)) return true;
        if (/^Part\s+\w+:/i.test(t)) return true;
        if (/^Part One:/i.test(t)) return true;
        // Running heads that leaked into body JSON (e.g. "Chapter 1: An Overview of Marketing").
        if (/^Chapter\s+\d+\s*:/i.test(t) && t.length < 80) return true;
        return false;
    }

    /** Label bottom running-footer frames on TX-Text / CO masters. */
    function labelFooterFramesOnMaster(ms) {
        var j;
        var item;
        var b;
        var n = 0;
        try {
            for (j = 0; j < ms.allPageItems.length; j++) {
                item = ms.allPageItems[j];
                if (!(item instanceof TextFrame)) continue;
                try { b = item.geometricBounds; } catch (eB) { continue; }
                // Footer band near the bottom of the master page (CO-Verso ~726, TX-Text ~756).
                if (b[0] < 700 || b[0] > 780) continue;
                if ((b[3] - b[1]) < 200) continue;
                // Verso/even = left of spread; recto/odd = right of spread.
                if (b[1] < 400) {
                    item.label = "RH_VERSO";
                } else {
                    item.label = "RH_RECTO";
                }
                n += 1;
                log("Labeled " + ms.name + " " + item.label + " bounds=" + b);
            }
        } catch (e) {}
        return n;
    }

    function labelAllFooterMasters(docRef) {
        var i;
        var ms;
        var n = 0;
        for (i = 0; i < docRef.masterSpreads.length; i++) {
            ms = docRef.masterSpreads[i];
            if (/^(TX-Text|CO-Verso|CO-Recto)$/.test(String(ms.name))) {
                n += labelFooterFramesOnMaster(ms);
            }
        }
        return n;
    }

    /**
     * Client footers (TX-Text body pages only — not opener unless JSON has footer):
     *  even (verso): left — "60  Part One: The World of Marketing"
     *  odd  (recto): right — "Chapter 1: An Overview of Marketing  61"
     * RH paragraph style uses Away From Binding, so one style covers both sides.
     */
    function fillFooterFrame(frame, beforeMarker, afterMarker, docRef, folioNum) {
        var story;
        var rh;
        var none;
        var i;
        if (!frame) return false;
        try {
            try { frame.previousTextFrame = Nothing; } catch (e0) {}
            try { frame.nextTextFrame = Nothing; } catch (e1) {}
            story = frame.parentStory;
            story.contents = "";
            if (beforeMarker) {
                story.insertionPoints.item(-1).contents = String(beforeMarker);
            }
            // Prefer explicit folio from JSON plan so PDF always shows the number
            // even if auto-page-number markers fail to resolve on single-sided docs.
            if (folioNum != null && !isNaN(folioNum)) {
                story.insertionPoints.item(-1).contents = String(folioNum);
            } else {
                try {
                    story.insertionPoints.item(-1).contents = SpecialCharacters.AUTO_PAGE_NUMBER;
                } catch (eNum) {
                    story.insertionPoints.item(-1).contents = "#";
                }
            }
            if (afterMarker) {
                story.insertionPoints.item(-1).contents = String(afterMarker);
            }
            rh = findParaStyle(docRef, "RH");
            none = noneCharacterStyle(docRef);
            if (rh) {
                for (i = 0; i < story.paragraphs.length; i++) {
                    applyParaStyleClean(story.paragraphs[i], rh, docRef);
                    try {
                        if (none) story.paragraphs[i].applyCharacterStyle(none);
                    } catch (eNone) {}
                    try { story.paragraphs[i].appliedFont = rh.appliedFont; } catch (eF) {}
                    try { story.paragraphs[i].fontStyle = rh.fontStyle; } catch (eFs) {}
                    try { story.paragraphs[i].pointSize = rh.pointSize; } catch (eSz) {}
                    try { story.paragraphs[i].fillColor = rh.fillColor; } catch (eFc) {}
                }
                try {
                    log("Footer RH applied => font=" + story.paragraphs[0].appliedFont.name +
                        "/" + story.paragraphs[0].fontStyle +
                        " size=" + story.paragraphs[0].pointSize);
                } catch (eLog) {}
            }
            try { frame.visible = true; } catch (eV) {}
            return true;
        } catch (e) {
            warnings.push("fillFooterFrame failed: " + e.message);
            return false;
        }
    }

    function clearMasterFooterFrame(frame) {
        if (!frame) return;
        try {
            frame.parentStory.contents = "";
        } catch (e1) {
            try { frame.contents = ""; } catch (e2) {}
        }
        try { frame.visible = false; } catch (e3) {}
    }

    function findMasterFooter(docRef, masterName, label) {
        var i;
        var j;
        var ms;
        var item;
        for (i = 0; i < docRef.masterSpreads.length; i++) {
            ms = docRef.masterSpreads[i];
            if (String(ms.name) !== masterName) continue;
            for (j = 0; j < ms.allPageItems.length; j++) {
                item = ms.allPageItems[j];
                if (itemLabel(item) === label) return item;
            }
        }
        return null;
    }

    /** Clear all master RH frames so footers are not inherited on every page. */
    function clearAllMasterFooters(docRef) {
        var names = ["TX-Text", "CO-Verso", "CO-Recto"];
        var labels = ["RH", "RH_VERSO", "RH_RECTO"];
        var i;
        var j;
        labelAllFooterMasters(docRef);
        for (i = 0; i < names.length; i++) {
            for (j = 0; j < labels.length; j++) {
                clearMasterFooterFrame(findMasterFooter(docRef, names[i], labels[j]));
            }
        }
    }

    /**
     * Build folio→footer plan from JSON blocks with type === "footer"/"Footer" ONLY.
     * Supports:
     *   { type:"Footer", data:{ text:"Part One: ...", page:30 } }
     *   { type:"footer", data:{ text:"2" } } + { text:"Part One: ..." }
     */
    function buildFooterPlanFromJson(pagesArr) {
        var plan = {};
        var pi;
        var bi;
        var content;
        var block;
        var type;
        var data;
        var text;
        var folio;
        var part;
        var chapter;
        var pageNo;
        var explicitPage;
        for (pi = 0; pi < pagesArr.length; pi++) {
            content = pagesArr[pi].content || [];
            folio = null;
            part = "";
            chapter = "";
            pageNo = parseInt(pagesArr[pi].page_no, 10);
            if (isNaN(pageNo)) pageNo = pi + 1;
            for (bi = 0; bi < content.length; bi++) {
                block = content[bi];
                type = trim(block.type || "");
                if (type !== "footer" && type !== "Footer") continue;
                data = block.data || {};
                text = blockText(data);
                explicitPage = parseInt(data.page, 10);
                if (!isNaN(explicitPage)) folio = explicitPage;
                if (!text) continue;
                if (/^\d{1,3}$/.test(text)) {
                    if (folio === null) folio = parseInt(text, 10);
                } else if (/^Part\s+/i.test(text)) {
                    part = text;
                } else if (/^Chapter\s+\d+/i.test(text)) {
                    chapter = text.replace(/\s+/g, " ");
                } else if (!part && !chapter) {
                    // Unknown running-head copy — treat as part-style on even, chapter on odd later.
                    if (folio !== null && folio % 2 === 0) part = text;
                    else chapter = text;
                }
            }
            if (folio === null && !part && !chapter) continue;
            if (folio === null) folio = pageNo;
            plan[String(folio)] = {
                folio: folio,
                part: part,
                chapter: chapter,
                jsonPageNo: pageNo
            };
            log("JSON footer plan => folio=" + folio +
                " part=\"" + part + "\" chapter=\"" + chapter +
                "\" jsonPage=" + pageNo);
        }
        return plan;
    }

    function overridePageFooterFrame(page, label) {
        var list;
        var i;
        var item;
        var b;
        var lab;
        list = collectByLabel(page, label);
        for (i = 0; i < list.length; i++) {
            try {
                if (list[i].parentPage === page) return list[i];
            } catch (e0) {}
        }
        try {
            if (page.appliedMaster) {
                for (i = 0; i < page.appliedMaster.allPageItems.length; i++) {
                    item = page.appliedMaster.allPageItems[i];
                    lab = itemLabel(item);
                    if (lab === label || (label.indexOf("RH") === 0 && lab === "RH")) {
                        try { return item.override(page); } catch (e1) { return item; }
                    }
                }
                // Geometry fallback: bottom band text frames.
                for (i = 0; i < page.appliedMaster.allPageItems.length; i++) {
                    item = page.appliedMaster.allPageItems[i];
                    if (!(item instanceof TextFrame)) continue;
                    try { b = item.geometricBounds; } catch (eB) { continue; }
                    if (b[0] < 710 || b[0] > 750) continue;
                    if (label.indexOf("VERSO") >= 0 && b[1] < 400) {
                        try { item.label = label; } catch (eL) {}
                        try { return item.override(page); } catch (e2) { return item; }
                    }
                    if (label.indexOf("RECTO") >= 0 && b[1] >= 400) {
                        try { item.label = label; } catch (eL2) {}
                        try { return item.override(page); } catch (e3) { return item; }
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    function hidePageFooter(page) {
        var labels = ["RH", "RH_VERSO", "RH_RECTO"];
        var li;
        var frame;
        var hidden = 0;
        for (li = 0; li < labels.length; li++) {
            frame = overridePageFooterFrame(page, labels[li]);
            if (!frame) continue;
            try { frame.parentStory.contents = ""; } catch (e1) {
                try { frame.contents = ""; } catch (e2) {}
            }
            try { frame.visible = false; } catch (e3) {}
            hidden += 1;
        }
        return hidden;
    }

    /**
     * Page-local footer band from the master the page uses.
     * Body pages follow TX-Text (frame height and footer position both live there).
     * The opener follows CO-Verso. Recto pages shift the verso band by 36pt.
     */
    function masterFooterLocal(docRef, masterNamePart) {
        var key = masterNamePart || "TX-Text";
        var i;
        var j;
        var ms;
        var mp;
        var item;
        var g;
        var pb;
        var lab;
        var local;
        var best = null;
        if (!masterFooterLocal.cache) masterFooterLocal.cache = {};
        if (masterFooterLocal.cache[key]) return masterFooterLocal.cache[key];
        try {
            for (i = 0; i < docRef.masterSpreads.length; i++) {
                ms = docRef.masterSpreads[i];
                if (String(ms.name).indexOf(key) < 0) continue;
                mp = ms.pages[0];
                try { pb = mp.bounds; } catch (ePb) { pb = [0, 0, 783, 612]; }
                for (j = 0; j < ms.allPageItems.length; j++) {
                    item = ms.allPageItems[j];
                    if (!(item instanceof TextFrame)) continue;
                    try {
                        if (item.parentPage && item.parentPage !== mp) continue;
                    } catch (ePP) {}
                    try { lab = itemLabel(item); } catch (eL) { lab = ""; }
                    try { g = item.geometricBounds; } catch (eG) { continue; }
                    if (lab !== "RH_VERSO" && lab !== "RH") {
                        if ((g[2] - g[0]) > 24 || (g[3] - g[1]) < 200 || (g[0] - pb[0]) < 700) continue;
                    }
                    local = {
                        top: g[0] - pb[0],
                        left: g[1] - pb[1],
                        bottom: g[2] - pb[0],
                        right: g[3] - pb[1]
                    };
                    if (lab === "RH_VERSO" || lab === "RH") {
                        best = local;
                        break;
                    }
                    if (!best) best = local;
                }
                if (best) break;
            }
        } catch (e) {}
        if (!best) {
            best = { top: 726, left: 36, bottom: 738, right: 540 };
            log("Footer local fallback for " + key);
        } else {
            log("Footer from INDD " + key + " => " +
                best.top + "," + best.left + "," + best.bottom + "," + best.right);
        }
        masterFooterLocal.cache[key] = best;
        return best;
    }

    /**
     * Page-local RH footer frame taken from the applied master's verso band.
     * Critical when facingPages=false: RH_RECTO master items sit at x≈684–1188 and
     * land off-page on single-sided spreads, so footers never appear in the PDF.
     */
    function ensurePageLocalFooterFrame(page, docRef) {
        var pr;
        var bounds;
        var frame = null;
        var list;
        var i;
        var labels = ["RH", "RH_VERSO", "RH_RECTO"];
        var lab;
        var rh;
        var masterKey = "TX-Text";
        try { pr = pageRect(page, docRef); } catch (ePr) {
            pr = { top: 0, left: 0, bottom: 783, right: 612, w: 612, h: 783 };
        }
        try {
            if (page.appliedMaster && String(page.appliedMaster.name).indexOf("CO-") >= 0) {
                masterKey = "CO-Verso";
            }
        } catch (eMk) {}
        rh = masterFooterLocal(docRef, masterKey);
        var shift = isRightHandPage(page) ? RECTO_COLUMN_SHIFT : 0;
        var span = null;
        var si;
        var sItem;
        var sb;
        try {
            for (si = 0; si < page.textFrames.length; si++) {
                sItem = page.textFrames[si];
                if (itemLabel(sItem) !== "T1") continue;
                try { if (sItem.parentPage !== page) continue; } catch (ePP) {}
                try { sb = sItem.geometricBounds; } catch (eSb) { continue; }
                if ((sb[2] - sb[0]) < 200 || (sb[3] - sb[1]) < 80) continue;
                if (!span) span = { left: sb[1], right: sb[3] };
                if (sb[1] < span.left) span.left = sb[1];
                if (sb[3] > span.right) span.right = sb[3];
            }
        } catch (eSpan) { span = null; }
        if (span) {
            // Match the columns on this page. Page inserts/removals change
            // even/odd after the columns were built, so a fresh 36pt shift
            // lands the footer off the TX-Text edges.
            bounds = [pr.top + rh.top, span.left, pr.top + rh.bottom, span.right];
        } else {
            bounds = [
                pr.top + rh.top,
                pr.left + rh.left + shift,
                pr.top + rh.bottom,
                pr.left + rh.right + shift
            ];
        }

        for (i = 0; i < labels.length; i++) {
            lab = labels[i];
            list = collectByLabel(page, lab);
            if (list.length) {
                frame = list[0];
                break;
            }
        }
        if (!frame) {
            try {
                frame = overridePageFooterFrame(page, "RH_VERSO");
            } catch (eOv) { frame = null; }
        }
        if (!frame) {
            try {
                frame = overridePageFooterFrame(page, "RH");
            } catch (eOv2) { frame = null; }
        }
        if (!frame) {
            try {
                frame = page.textFrames.add({ geometricBounds: bounds });
                frame.label = "RH";
            } catch (eAdd) {
                log("Could not create footer frame: " + eAdd.message);
                return null;
            }
        }
        try {
            frame.locked = false;
            frame.visible = true;
            frame.geometricBounds = bounds;
        } catch (eSet) {
            try { frame.move([bounds[1], bounds[0]]); } catch (eM) {}
        }
        try { frame.bringToFront(); } catch (eF) {}
        return frame;
    }

    /**
     * Show footers only on document pages whose displayed folio appears in a
     * JSON block with type "footer". All other pages hide RH frames.
     */
    function applyPerPageFootersFromJson(docRef, pagesArr) {
        var plan = buildFooterPlanFromJson(pagesArr);
        var startNum = 1;
        var i;
        var page;
        var displayNum;
        var entry;
        var frame;
        var shown = 0;
        var hidden = 0;
        var useEvenStyle;
        var facing = true;
        var sideName = "";

        clearAllMasterFooters(docRef);

        try {
            if (docRef.sections.length > 0) {
                startNum = docRef.sections[0].pageNumberStart;
            }
        } catch (eS) {}
        try { facing = !!docRef.documentPreferences.facingPages; } catch (eFace) { facing = false; }

        for (i = 0; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            displayNum = startNum + i;
            entry = plan[String(displayNum)];
            if (!entry) {
                hidden += hidePageFooter(page);
                continue;
            }

            // Even folio = part title (verso style); odd = chapter title (recto style).
            // Do NOT trust page.side when facing is off — SINGLE_SIDED made every
            // page pick RH_RECTO and parked footers off the visible page.
            useEvenStyle = (displayNum % 2 === 0);
            if (facing) {
                try {
                    sideName = String(page.side || "");
                    if (sideName.indexOf("LEFT") >= 0) useEvenStyle = true;
                    else if (sideName.indexOf("RIGHT") >= 0) useEvenStyle = false;
                } catch (eSide) {}
            }

            hidePageFooter(page);
            frame = ensurePageLocalFooterFrame(page, docRef);
            if (!frame) {
                log("No footer frame on folio=" + displayNum);
                continue;
            }

            if (useEvenStyle && entry.part) {
                if (fillFooterFrame(frame, "", "\u2003" + entry.part, docRef, displayNum)) {
                    try { frame.parentStory.paragraphs[0].justification = Justification.LEFT_ALIGN; } catch (eJ1) {}
                    shown += 1;
                    log("Show footer folio=" + displayNum + " (even/local) => # " + entry.part);
                }
            } else if (!useEvenStyle && entry.chapter) {
                if (fillFooterFrame(frame, entry.chapter + "\u2003", "", docRef, displayNum)) {
                    try { frame.parentStory.paragraphs[0].justification = Justification.RIGHT_ALIGN; } catch (eJ2) {}
                    shown += 1;
                    log("Show footer folio=" + displayNum + " (odd/local) => " + entry.chapter + " #");
                }
            } else if (entry.part) {
                // Folio parity mismatch but we have part text — still show it.
                if (fillFooterFrame(frame, "", "\u2003" + entry.part, docRef, displayNum)) {
                    try { frame.parentStory.paragraphs[0].justification = Justification.LEFT_ALIGN; } catch (eJ3) {}
                    shown += 1;
                    log("Show footer folio=" + displayNum + " (part fallback) => # " + entry.part);
                }
            } else if (entry.chapter) {
                if (fillFooterFrame(frame, entry.chapter + "\u2003", "", docRef, displayNum)) {
                    try { frame.parentStory.paragraphs[0].justification = Justification.RIGHT_ALIGN; } catch (eJ4) {}
                    shown += 1;
                    log("Show footer folio=" + displayNum + " (chapter fallback) => " + entry.chapter + " #");
                }
            } else {
                // JSON footer with page only (empty text) — still print the folio.
                if (fillFooterFrame(frame, "", "", docRef, displayNum)) {
                    shown += 1;
                    log("Show footer folio=" + displayNum + " (folio only)");
                }
            }
        }
        log("Per-page footers => shown=" + shown + " hiddenPagesCleared=" + hidden +
            " facing=" + facing +
            " planFolios=" + (function () {
                var k;
                var keys = [];
                for (k in plan) if (plan.hasOwnProperty(k)) keys.push(k);
                return keys.join(",");
            }()));
        return shown;
    }

    function firstFooterFolio(pagesArr) {
        var plan = buildFooterPlanFromJson(pagesArr);
        var k;
        var min = null;
        var n;
        for (k in plan) {
            if (!plan.hasOwnProperty(k)) continue;
            n = parseInt(k, 10);
            if (min === null || n < min) min = n;
        }
        return min;
    }

    function relabelTxTextColumns(docRef) {
        // Kept for bake/save path; rebuildBodyColumnFlow owns runtime geometry.
        var i;
        var j;
        var page;
        var item;
        var b;
        var w;
        var h;
        var count = 0;
        for (i = 0; i < docRef.pages.length; i++) {
            page = docRef.pages[i];
            try {
                if (!page.appliedMaster || String(page.appliedMaster.name).indexOf("TX-Text") < 0) {
                    continue;
                }
            } catch (e) { continue; }
            try {
                for (j = 0; j < page.textFrames.length; j++) {
                    item = page.textFrames[j];
                    try { b = item.geometricBounds; } catch (eB) { continue; }
                    h = b[2] - b[0];
                    w = b[3] - b[1];
                    if (h > 400 && w > 180 && w < 320) {
                        item.label = "T1";
                        count += 1;
                    }
                }
            } catch (e2) {}
        }
        log("Relabeled TX-Text body columns as T1 => " + count);
        return count;
    }

    function ensureT1Story(docRef, startPage) {
        return rebuildBodyColumnFlow(docRef, startPage);
    }

    /** Fresh 2-column T1 story on one page — NOT linked to any prior JSON page. */
    function createFreshT1StoryOnPage(docRef, page) {
        var masterCols = columnsForPage(docRef, page);
        var frames;
        var i;
        try {
            if (!page.appliedMaster || String(page.appliedMaster.name).indexOf("TX-Text") < 0) {
                var txMaster = docRef.masterSpreads.itemByName("TX-Text");
                if (txMaster && txMaster.isValid) page.appliedMaster = txMaster;
            }
        } catch (eM) {}
        cleanupTxPageDetritus(page);
        frames = restoreFullColumnT1OnPage(page, masterCols);
        for (i = 0; i < frames.length; i++) unlinkTextFrame(frames[i]);
        if (frames.length >= 2) {
            try { frames[1].previousTextFrame = frames[0]; } catch (eL) {
                try { frames[0].nextTextFrame = frames[1]; } catch (eL2) {}
            }
        }
        if (!frames.length) throw new Error("createFreshT1StoryOnPage: no T1 frames on " + page.name);
        try { frames[0].parentStory.contents = ""; } catch (eC) {
            try { frames[0].contents = ""; } catch (eC2) {}
        }
        resetTextDefaults(docRef);
        try {
            var tx1 = findParaStyle(docRef, "TX1");
            var none = noneCharacterStyle(docRef);
            if (tx1) frames[0].parentStory.appliedParagraphStyle = tx1;
            if (none) {
                try { frames[0].parentStory.appliedCharacterStyle = none; } catch (eAcs) {}
            }
        } catch (eDef) {}
        return frames[0];
    }

    /**
     * Add a body page without hitting InDesign's "Spread cannot have more than
     * 10 pages" limit (#1282). Always create/append via a new spread when
     * needed, and never flip facingPages here (opener mode needs facing ON).
     */
    function unlockAllSpreads(docRef) {
        var si;
        try { docRef.documentPreferences.allowPageShuffle = true; } catch (e0) {}
        try {
            for (si = 0; si < docRef.spreads.length; si++) {
                try { docRef.spreads[si].allowPageShuffle = true; } catch (e1) {}
            }
        } catch (e2) {}
    }

    function safeAddPage(docRef, afterPage) {
        var page = null;
        var spread = null;
        var afterIdx = -1;
        var lastIdx;
        var facing = true;
        unlockAllSpreads(docRef);
        try { facing = !!docRef.documentPreferences.facingPages; } catch (eFace) {}

        try {
            if (afterPage && afterPage.isValid) afterIdx = pageIndexOf(docRef, afterPage);
        } catch (eIdx) { afterIdx = -1; }
        lastIdx = docRef.pages.length - 1;

        try {
            if (!facing) {
                // Single-page spreads: create a new spread, use its page.
                if (typeof LocationOptions !== "undefined") {
                    if (afterIdx >= 0 && afterIdx < lastIdx) {
                        spread = docRef.spreads.add(LocationOptions.AFTER, afterPage.parent);
                    } else {
                        spread = docRef.spreads.add(LocationOptions.AT_END);
                    }
                } else {
                    spread = docRef.spreads.add();
                }
                try { spread.allowPageShuffle = true; } catch (eSp) {}
                page = spread.pages[0];
            } else {
                // Facing pages: add one page at end/after; ID manages 2-page spreads.
                if (afterIdx >= 0 && afterIdx < lastIdx && typeof LocationOptions !== "undefined") {
                    page = docRef.pages.add(LocationOptions.AFTER, afterPage);
                } else if (typeof LocationOptions !== "undefined") {
                    page = docRef.pages.add(LocationOptions.AT_END);
                } else {
                    page = docRef.pages.add();
                }
            }
        } catch (eAdd) {
            log("safeAddPage primary failed (" + eAdd.message + "); retry AT_END");
            try {
                if (typeof LocationOptions !== "undefined") {
                    page = docRef.pages.add(LocationOptions.AT_END);
                } else {
                    page = docRef.pages.add();
                }
            } catch (e2) {
                throw new Error("safeAddPage failed: " + eAdd.message + " / " + e2.message);
            }
        }
        return page;
    }

    function ensureDocPageIndex(docRef, index) {
        var txMaster = null;
        var page;
        try { txMaster = docRef.masterSpreads.itemByName("TX-Text"); } catch (eM) {}
        while (docRef.pages.length <= index) {
            page = safeAddPage(docRef, docRef.pages[docRef.pages.length - 1]);
            try {
                if (txMaster && txMaster.isValid) page.appliedMaster = txMaster;
            } catch (eA) {}
        }
        return docRef.pages[index];
    }

    function storyPageOffsets(head, docRef) {
        var cur = head;
        var safety = 0;
        var offs = [];
        var seen = {};
        var off;
        while (cur && safety < 400) {
            safety += 1;
            try {
                if (cur.parentPage) {
                    off = pageIndexOf(docRef, cur.parentPage);
                    if (off >= 0 && !seen[off]) {
                        seen[off] = true;
                        offs.push(off);
                    }
                }
            } catch (e1) {}
            if (!cur.nextTextFrame) break;
            cur = cur.nextTextFrame;
        }
        offs.sort(function (a, b) { return a - b; });
        return offs;
    }

    function storyVisibleCharCount(head) {
        var cur = head;
        var safety = 0;
        var n = 0;
        while (cur && safety < 400) {
            safety += 1;
            try { n += cur.characters.length; } catch (e1) {
                try { n += String(cur.contents || "").length; } catch (e2) {}
            }
            if (!cur.nextTextFrame) break;
            cur = cur.nextTextFrame;
        }
        return n;
    }

    function storyHasOverset(head) {
        var story;
        var total = 0;
        var visible = 0;
        var tail;
        if (!head) return false;
        try { story = head.parentStory; } catch (e0) { return false; }
        try { if (story && story.recompose) story.recompose(); } catch (r0) {}
        try {
            tail = getStoryTailFrame(head);
            if (tail && tail.overflows === true) return true;
        } catch (e1) {}
        try {
            if (story && story.overflows === true) return true;
        } catch (e2) {}
        // Reliable fallback: compare story length vs characters sitting in frames.
        try { total = story.characters.length; } catch (e3) { total = 0; }
        visible = storyVisibleCharCount(head);
        if (total > visible + 1) return true;
        return false;
    }

    /**
     * One JSON page is one PDF page. Text that does not fit stays overset and
     * is left out of the export. Do not add a continuation page.
     */
    function ensureOverflowCapacity(head, docRef) {
        var overset = false;
        var tail = null;
        try { if (head && head.parentStory) head.parentStory.recompose(); } catch (e0) {}
        try { overset = storyHasOverset(head); } catch (e1) { overset = false; }
        if (overset) {
            try { tail = getStoryTailFrame(head); } catch (eT) { tail = null; }
            log("Trimmed overflow; left overset on page " +
                (tail && tail.parentPage ? tail.parentPage.name : "?"));
        }
        return tail || getStoryTailFrame(head);
    }

    function logStoryOverset(head, docRef, label) {
        var tail;
        var overset = false;
        var total = 0;
        var visible = 0;
        try {
            try { head.parentStory.recompose(); } catch (r0) {}
            tail = getStoryTailFrame(head);
            overset = storyHasOverset(head);
            try { total = head.parentStory.characters.length; } catch (eT) {}
            visible = storyVisibleCharCount(head);
            log((label || "Story") + " overset=" + overset +
                " chars=" + visible + "/" + total +
                " pages=" + docRef.pages.length +
                " tailPage=" + (tail && tail.parentPage ? tail.parentPage.name : "?"));
        } catch (e) {
            log((label || "Story") + " overset check failed: " + e.message);
        }
        return overset;
    }

    var NAMED_HTML_COLORS = {
        red: "#FF0000",
        blue: "#0000FF",
        green: "#008000",
        black: "#000000",
        white: "#FFFFFF",
        orange: "#FFA500",
        purple: "#800080",
        yellow: "#FFFF00",
        maroon: "#800000",
        navy: "#000080",
        teal: "#008080",
        gray: "#808080",
        grey: "#808080"
    };

    function normalizeMarkerColor(value) {
        var raw = trim(String(value || ""));
        var hex = raw.replace(/^#/, "");
        var i;
        var expanded = "";
        if (/^[0-9a-fA-F]{6}$/.test(hex)) return "#" + hex.toUpperCase();
        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            for (i = 0; i < hex.length; i++) expanded += hex.charAt(i) + hex.charAt(i);
            return "#" + expanded.toUpperCase();
        }
        return "";
    }

    function cssColorToHex(token) {
        var hex;
        var named;
        token = trim(String(token || ""));
        if (!token) return "";
        if (token.charAt(0) === "#") {
            hex = token.replace(/^#/, "");
            if (hex.length === 3) {
                hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
            }
            if (hex.length !== 6) return "";
            return "#" + hex.toUpperCase();
        }
        named = NAMED_HTML_COLORS[token.toLowerCase()];
        return named || "";
    }

    function hexToRgbList(hex) {
        var clean = String(hex || "").replace(/^#/, "");
        if (clean.length !== 6) return [0, 0, 0];
        return [
            parseInt(clean.substring(0, 2), 16),
            parseInt(clean.substring(2, 4), 16),
            parseInt(clean.substring(4, 6), 16)
        ];
    }

    function readStyleColor(attrs) {
        var match = /(?:^|[^-a-zA-Z])color\s*:\s*(#[0-9a-fA-F]{3,6}|[a-zA-Z]+)/.exec(String(attrs || ""));
        return match ? cssColorToHex(match[1]) : "";
    }

    function readStyleBackground(attrs) {
        var match = /background-color\s*:\s*(#[0-9a-fA-F]{3,6}|[a-zA-Z]+)/i.exec(String(attrs || ""));
        return match ? cssColorToHex(match[1]) : "";
    }

    function readStyleFontSize(attrs) {
        var match = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*(pt|px)?/i.exec(String(attrs || ""));
        var size;
        if (!match) return 0;
        size = Number(match[1]);
        if (!size || size <= 0) return 0;
        if (String(match[2] || "").toLowerCase() === "px") size = size * 0.75;
        return size;
    }

    function readTextDecoration(attrs) {
        var match = /text-decoration(?:-line)?\s*:\s*([^;"']+)/i.exec(String(attrs || ""));
        var value;
        if (!match) return { underline: false, strike: false, strikeDouble: false };
        value = String(match[1] || "").toLowerCase();
        return {
            underline: value.indexOf("underline") >= 0,
            strike: value.indexOf("line-through") >= 0,
            strikeDouble: value.indexOf("line-through") >= 0 && /text-decoration-style\s*:\s*double/i.test(String(attrs || ""))
        };
    }

    function markdownToHtmlTheme(value) {
        var text = String(value || "");
        var safety;
        var mdMatch;
        var isKeyTerm;
        var mdBold;
        text = text.replace(/~~~~([\s\S]+?)~~~~/g, "<s data-strike=\"double\">$1</s>");
        text = text.replace(/~~([\s\S]+?)~~/g, "<s>$1</s>");
        text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<b><i>$1</i></b>");
        text = text.replace(/__([^\n]+?)__/g, "<b>$1</b>");
        mdBold = /\*\*([\s\S]*?)\*\*/;
        for (safety = 0; safety < 400; safety++) {
            mdMatch = mdBold.exec(text);
            if (!mdMatch) break;
            isKeyTerm = /color:\s*#9f248f/i.test(mdMatch[1]);
            text = text.substring(0, mdMatch.index) +
                (isKeyTerm ? "<kt>" : "<b>") + mdMatch[1] + (isKeyTerm ? "</kt>" : "</b>") +
                text.substring(mdMatch.index + mdMatch[0].length);
        }
        text = text.replace(/\*\*/g, "");
        text = text.replace(/(^|[^\*\w])\*(?!\s)([^\*\n]+?)\*(?![\*\w])/g, "$1<i>$2</i>");
        return text;
    }

    function sameThemeRun(a, b) {
        return a.italic === b.italic && a.bold === b.bold && a.underline === b.underline &&
            a.strike === b.strike && a.strikeDouble === b.strikeDouble &&
            a.superscript === b.superscript && a.subscript === b.subscript && a.highlight === b.highlight &&
            a.keyterm === b.keyterm && a.backgroundColor === b.backgroundColor &&
            a.fontSize === b.fontSize && a.color === b.color;
    }

    function mergeThemeRuns(runs) {
        var points = [];
        var uniq = [];
        var merged = [];
        var i;
        var j;
        var run;
        var start;
        var end;
        var slice;
        var covering;
        if (!runs || runs.length < 2) return runs || [];
        for (i = 0; i < runs.length; i++) {
            run = runs[i];
            if (!run || run.end <= run.start) continue;
            points.push(run.start);
            points.push(run.end);
        }
        points.sort(function (a, b) { return a - b; });
        for (i = 0; i < points.length; i++) {
            if (!uniq.length || uniq[uniq.length - 1] !== points[i]) uniq.push(points[i]);
        }
        for (i = 0; i < uniq.length - 1; i++) {
            start = uniq[i];
            end = uniq[i + 1];
            covering = [];
            for (j = 0; j < runs.length; j++) {
                run = runs[j];
                if (!run || run.start >= end || run.end <= start) continue;
                covering.push({ run: run, index: j });
            }
            if (!covering.length) continue;
            slice = {
                start: start,
                end: end,
                italic: false,
                bold: false,
                underline: false,
                strike: false,
                strikeDouble: false,
                superscript: false,
                subscript: false,
                highlight: false,
                keyterm: false,
                backgroundColor: "",
                fontSize: 0,
                color: ""
            };
            for (j = 0; j < covering.length; j++) {
                run = covering[j].run;
                if (run.italic) slice.italic = true;
                if (run.bold) slice.bold = true;
                if (run.underline) slice.underline = true;
                if (run.strike) slice.strike = true;
                if (run.strikeDouble) slice.strikeDouble = true;
                if (run.superscript) slice.superscript = true;
                if (run.subscript) slice.subscript = true;
                if (run.highlight) slice.highlight = true;
                if (run.keyterm) slice.keyterm = true;
            }
            covering.sort(function (a, b) {
                var aSpan = a.run.end - a.run.start;
                var bSpan = b.run.end - b.run.start;
                if (aSpan !== bSpan) return aSpan - bSpan;
                return a.index - b.index;
            });
            for (j = 0; j < covering.length; j++) {
                run = covering[j].run;
                if (!slice.color && run.color) slice.color = run.color;
                if (!slice.backgroundColor && run.backgroundColor) slice.backgroundColor = run.backgroundColor;
                if (!slice.fontSize && run.fontSize) slice.fontSize = run.fontSize;
            }
            if (merged.length && merged[merged.length - 1].end === slice.start &&
                sameThemeRun(merged[merged.length - 1], slice)) {
                merged[merged.length - 1].end = slice.end;
            } else {
                merged.push(slice);
            }
        }
        return merged.length ? merged : runs;
    }

    function parseThemeInline(raw) {
        var text = markdownToHtmlTheme(raw);
        var plain = "";
        var runs = [];
        var stack = [];
        var last = 0;
        var re;
        var m;
        var tag;
        var attrs;
        var isClose;
        var isSelfClose;
        var i;
        var open;
        var slice;
        var kind;
        var color;
        var start;
        var end;
        var out;
        text = text
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;/gi, "'");
        if (text.indexOf("<") < 0) {
            return { text: trim(text), runs: [] };
        }
        re = /<\/?([a-zA-Z0-9]+)(\s[^>]*)?\s*\/?>/g;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) plain += text.substring(last, m.index);
            tag = String(m[1] || "").toLowerCase();
            attrs = m[2] || "";
            isClose = m[0].charAt(1) === "/";
            isSelfClose = /\/\s*>$/.test(m[0]) || tag === "br";
            if (!isClose && isSelfClose && tag === "br") {
                plain += "\r";
            } else if (!isClose && !isSelfClose) {
                if (tag === "i" || tag === "em" || tag === "b" || tag === "strong" || tag === "u" ||
                    tag === "s" || tag === "strike" || tag === "del" ||
                    tag === "span" || tag === "sup" || tag === "sub" || tag === "mark" || tag === "kt") {
                    var deco = readTextDecoration(attrs);
                    stack.push({
                        tag: tag,
                        start: plain.length,
                        italic: tag === "i" || tag === "em",
                        bold: tag === "b" || tag === "strong",
                        underline: tag === "u" || deco.underline,
                        strike: tag === "s" || tag === "strike" || tag === "del" || deco.strike,
                        strikeDouble: deco.strikeDouble || /data-strike\s*=\s*["']?double/i.test(attrs),
                        superscript: tag === "sup",
                        subscript: tag === "sub",
                        highlight: tag === "mark",
                        keyterm: tag === "kt",
                        color: readStyleColor(attrs),
                        backgroundColor: readStyleBackground(attrs),
                        fontSize: readStyleFontSize(attrs)
                    });
                }
            } else if (isClose) {
                for (i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].tag !== tag) continue;
                    open = stack[i];
                    stack.splice(i, 1);
                    if (plain.length > open.start) {
                        runs.push({
                            start: open.start,
                            end: plain.length,
                            italic: open.italic,
                            bold: open.bold,
                            underline: open.underline,
                            strike: open.strike,
                            strikeDouble: open.strikeDouble,
                            superscript: open.superscript,
                            subscript: open.subscript,
                            highlight: open.highlight,
                            keyterm: open.keyterm,
                            color: open.color,
                            backgroundColor: open.backgroundColor,
                            fontSize: open.fontSize
                        });
                    }
                    break;
                }
            }
            last = m.index + m[0].length;
        }
        if (last < text.length) plain += text.substring(last);
        runs = mergeThemeRuns(runs);
        out = [];
        for (i = 0; i < runs.length; i++) {
            slice = runs[i];
            color = slice.color || "";
            kind = "";
            if (slice.superscript) kind = "sup";
            else if (slice.keyterm || (slice.bold && /^#9F248F$/i.test(color))) {
                kind = "kt";
                color = "";
            } else if (slice.bold) kind = "bold";
            else if (slice.italic) kind = "ital";
            start = slice.start;
            end = slice.end;
            while (start < end && /\s/.test(plain.charAt(start))) start++;
            while (end > start && /\s/.test(plain.charAt(end - 1))) end--;
            if (end <= start) continue;
            if (!kind && !slice.italic && !slice.underline && !slice.strike && !slice.subscript &&
                !slice.highlight && !color && !slice.backgroundColor && !slice.fontSize) {
                continue;
            }
            out.push({
                start: start,
                end: end,
                kind: kind,
                italic: kind === "bold" && slice.italic,
                underline: slice.underline ? true : false,
                strike: slice.strike ? true : false,
                strikeDouble: slice.strikeDouble ? true : false,
                superscript: slice.superscript ? true : false,
                subscript: slice.subscript && !slice.superscript,
                color: color,
                backgroundColor: slice.backgroundColor || "",
                fontSize: slice.fontSize || 0,
                highlight: slice.highlight ? true : false
            });
        }
        return trimThemePlain(plain, out);
    }

    function trimThemePlain(plain, runs) {
        var lead = 0;
        var tail;
        var i;
        var run;
        var start;
        var end;
        var out = [];
        while (lead < plain.length && /\s/.test(plain.charAt(lead))) lead++;
        tail = plain.length;
        while (tail > lead && /\s/.test(plain.charAt(tail - 1))) tail--;
        plain = plain.substring(lead, tail);
        for (i = 0; i < runs.length; i++) {
            run = runs[i];
            start = run.start - lead;
            end = run.end - lead;
            if (start < 0) start = 0;
            if (end > plain.length) end = plain.length;
            if (end <= start) continue;
            run.start = start;
            run.end = end;
            out.push(run);
        }
        return { text: plain, runs: out };
    }

    function parseForPlace(text) {
        var s = String(text || "");
        if (/[\uE001-\uE008]/.test(s)) return parseInlineRuns(s);
        return parseThemeInline(s);
    }

    function appendParagraph(story, text, styleName, docRef) {
        var style;
        var startIndex;
        var i;
        var parsed = parseForPlace(text);
        var clean;
        var ktEnd;
        if (/^GL/.test(String(styleName)) && parsed.runs.length && parsed.runs[0].kind === "kt") {
            ktEnd = parsed.runs[0].end;
            if (parsed.text.charAt(ktEnd) === " ") {
                parsed.text = parsed.text.substring(0, ktEnd) + "\u2002" + parsed.text.substring(ktEnd + 1);
            }
        }
        clean = parsed.text;
        var charBase = 0;
        if (!clean) return "";
        style = findParaStyle(docRef, styleName);
        if (!style) {
            warnings.push('Missing style "' + styleName + '" — content still placed');
            log("MISSING STYLE => " + styleName);
        }
        try {
            if (!story.contents) {
                story.contents = clean + "\r";
                startIndex = 0;
                charBase = 0;
            } else {
                startIndex = story.paragraphs.length;
                charBase = story.characters.length;
                story.insertionPoints.item(-1).contents = clean + "\r";
            }
        } catch (e) {
            warnings.push("append failed: " + e.message);
            return "";
        }
        try { story.recompose(); } catch (r0) {}
        if (style) {
            try {
                for (i = Math.max(0, startIndex); i < story.paragraphs.length; i++) {
                    if (trim(story.paragraphs[i].contents) === "") continue;
                    applyParaStyleClean(story.paragraphs[i], style, docRef);
                }
            } catch (e2) {}
        }
        for (i = 0; i < parsed.runs.length; i++) {
            var srcRun = parsed.runs[i];
            var run = {
                storyId: story.id,
                start: charBase + srcRun.start,
                text: clean.substring(srcRun.start, srcRun.end),
                charStyle: inlineCharStyleName(srcRun.kind, styleName),
                // KTRM is 10pt (body size); margin glossary terms keep GL size.
                matchParaSize: srcRun.kind === "kt" && /^GL/.test(String(styleName)),
                italic: srcRun.italic ? true : false,
                underline: srcRun.underline ? true : false,
                strike: srcRun.strike ? true : false,
                strikeDouble: srcRun.strikeDouble ? true : false,
                superscript: srcRun.superscript ? true : false,
                subscript: srcRun.subscript ? true : false,
                color: srcRun.color || "",
                backgroundColor: srcRun.backgroundColor || "",
                fontSize: srcRun.fontSize || 0,
                highlight: srcRun.highlight ? true : false
            };
            if (run.charStyle || run.italic || run.underline || run.strike || run.superscript ||
                run.subscript || run.color || run.backgroundColor || run.fontSize || run.highlight) {
                applyInlineRun(docRef, run);
                inlineRuns.push(run);
            }
        }
        populated += 1;
        return clean.substring(0, 20);
    }

    function inlineCharStyleName(kind, paraStyleName) {
        var p = String(paraStyleName || "");
        if (kind === "sup") return "FTN";
        if (kind === "ital") return "ITAL";
        if (kind === "kt") return "KTRM";
        // Headings already carry their weight in the paragraph style. Body bold
        // (box run-in heads) is Neue Kabel Bold in the client — BCPN Bold, no colour.
        if (kind === "bold") return /^(TX|GL|BL|NL|PHCAP|EXT)/.test(p) ? "BCPN Bold" : "";
        return "";
    }

    function findCharStyle(docRef, name) {
        var i, s;
        try {
            s = docRef.characterStyles.itemByName(name);
            if (s && s.isValid) return s;
        } catch (e1) {}
        try {
            for (i = 0; i < docRef.allCharacterStyles.length; i++) {
                if (docRef.allCharacterStyles[i].name === name) return docRef.allCharacterStyles[i];
            }
        } catch (e2) {}
        return null;
    }

    function ensureRgbSwatch(docRef, name, rgb) {
        var sw;
        try {
            sw = docRef.colors.itemByName(name);
            if (sw && sw.isValid) return sw;
        } catch (e0) {}
        try {
            sw = docRef.colors.add({
                name: name,
                model: ColorModel.PROCESS,
                space: ColorSpace.RGB,
                colorValue: rgb
            });
            if (sw && sw.isValid) return sw;
        } catch (e1) {
            log("swatch " + name + " failed: " + e1.message);
        }
        return null;
    }

    function applyFillHex(docRef, range, hex) {
        var sw = ensureRgbSwatch(docRef, "CF_COLOR_" + String(hex).replace(/^#/, ""), hexToRgbList(hex));
        if (!sw) return false;
        try {
            range.fillColor = sw;
            return true;
        } catch (e) {
            return false;
        }
    }

    function applyBoldItalicFace(range) {
        var names = ["Bold Italic", "BoldItalic", "Bold Oblique"];
        var i;
        for (i = 0; i < names.length; i++) {
            try {
                range.fontStyle = names[i];
                return;
            } catch (eFace) {}
        }
    }

    function applyHighlightBar(docRef, range, hexColor) {
        var rgb = hexToRgbList(hexColor || "#FFE666");
        var color = ensureRgbSwatch(docRef, "CF_HIGHLIGHT_" + rgb.join("_"), rgb);
        var weight = 8;
        try { weight = Math.max(7, Number(range.pointSize) * 0.9); } catch (eW) {}
        try {
            range.underline = true;
            if (color) range.underlineColor = color;
            range.underlineWeight = weight;
            range.underlineOffset = -(weight * 0.32);
            range.underlineTint = 100;
        } catch (eH) {}
    }

    /** Apply a template character style, then local underline / size / colour. */
    function applyInlineRun(docRef, run) {
        var story, cs, range, pos, contents;
        if (!run || !run.text) return false;
        try {
            story = docRef.stories.itemByID(run.storyId);
            contents = String(story.contents);
            pos = run.start;
            if (contents.substr(pos, run.text.length) !== run.text) {
                pos = contents.indexOf(run.text, Math.max(0, run.start - 8));
                if (pos < 0) return false;
                run.start = pos;
            }
            range = story.characters.itemByRange(pos, pos + run.text.length - 1);
            if (run.charStyle) {
                cs = findCharStyle(docRef, run.charStyle);
                if (!cs) warnings.push('Missing character style "' + run.charStyle + '"');
                else range.appliedCharacterStyle = cs;
            }
            if (run.matchParaSize) {
                try {
                    range.pointSize = story.characters[pos].paragraphs[0].appliedParagraphStyle.pointSize;
                } catch (eSz) {}
            }
            if (run.italic && run.charStyle === "BCPN Bold") applyBoldItalicFace(range);
            else if (run.italic && !run.charStyle) {
                cs = findCharStyle(docRef, "ITAL");
                if (cs) {
                    try { range.appliedCharacterStyle = cs; } catch (eItal) {}
                }
            }
            if (run.fontSize) {
                try { range.pointSize = run.fontSize; } catch (eFs) {}
            }
            if (run.color) applyFillHex(docRef, range, run.color);
            if (run.superscript || run.charStyle === "FTN") {
                try { range.position = Position.SUPERSCRIPT; } catch (eSup) {}
            } else if (run.subscript) {
                try { range.position = Position.SUBSCRIPT; } catch (eSub) {}
            }
            if (run.backgroundColor) applyHighlightBar(docRef, range, run.backgroundColor);
            else if (run.highlight) applyHighlightBar(docRef, range, "");
            else if (run.underline) {
                try { range.underline = true; } catch (eU) {}
            }
            if (run.strike) {
                try {
                    range.strikeThru = true;
                    if (run.strikeDouble) {
                        try {
                            range.strikeThruWeight = Math.max(1.25, Number(range.pointSize) * 0.14);
                        } catch (eSw) {}
                    }
                } catch (eSt) {}
            }
            return true;
        } catch (e) {
            log("inline run failed " + (run.charStyle || "format") + " '" + run.text + "': " + e.message);
            return false;
        }
    }

    function reapplyInlineRuns(docRef) {
        var i, ok = 0;
        for (i = 0; i < inlineRuns.length; i++) {
            if (applyInlineRun(docRef, inlineRuns[i])) ok++;
        }
        log("Inline character styles (FTN/ITAL/KTRM) => " + ok + "/" + inlineRuns.length);
    }

    /**
     * JSON may embed a list inside one ParagraphText: "Intro:\n\n 1. 1. Item\n 2.  Item"
     * or "\n - Item". Split into paragraphs: kind "para" | "num" | "bullet".
     * Literal markers are removed — NL_* / BL_* auto-number and bullet; `number`
     * keeps the JSON value so runs that continue (e.g. "3.") start correctly.
     */
    function stripOuterMarker(raw, pattern) {
        var s = String(raw || "");
        var i = 0;
        var close;
        var m;
        while (i < s.length) {
            if (s.charAt(i) === "<") {
                close = s.indexOf(">", i);
                if (close < 0) break;
                i = close + 1;
                continue;
            }
            if (/\s/.test(s.charAt(i))) {
                i++;
                continue;
            }
            m = pattern.exec(s.substring(i));
            if (m && m.index === 0) return trim(s.substring(0, i) + s.substring(i + m[0].length));
            break;
        }
        return trim(s);
    }

    /**
     * Turn <ol>/<ul>/<li> into the same "1. " / "- " lines splitEmbeddedList
     * already styles as NL_* / BL_*. Plain text without those tags is unchanged.
     */
    function normalizeHtmlLists(text) {
        var s = String(text || "");
        var re;
        var m;
        var out;
        var last;
        var tag;
        var closing;
        var inOl;
        var n;
        if (!/<\s*\/?\s*(?:ul|ol|li)\b/i.test(s)) return s;
        re = /<\s*(\/?)\s*(ul|ol|li)\b[^>]*>/ig;
        out = "";
        last = 0;
        inOl = false;
        n = 0;
        while ((m = re.exec(s)) !== null) {
            out += s.substring(last, m.index);
            closing = m[1] === "/";
            tag = String(m[2] || "").toLowerCase();
            if (tag === "ol") {
                if (!closing) {
                    inOl = true;
                    n = 0;
                } else {
                    inOl = false;
                }
                out += "\n";
            } else if (tag === "ul") {
                if (!closing) inOl = false;
                out += "\n";
            } else if (!closing) {
                if (inOl) {
                    n += 1;
                    out += "\n" + n + ". ";
                } else {
                    out += "\n- ";
                }
            } else {
                out += "\n";
            }
            last = m.index + m[0].length;
        }
        return out + s.substring(last);
    }

    function leadingListLevel(seg) {
        var lead = /^[ \t]*/.exec(String(seg || ""));
        var width = lead ? lead[0].replace(/\t/g, "  ").length : 0;
        return Math.floor(width / 2);
    }

    function splitEmbeddedList(text) {
        var lines = normalizeHtmlLists(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n+/);
        var out = [];
        var i;
        var seg;
        var plain;
        var m;
        var hashes;
        var level;
        for (i = 0; i < lines.length; i++) {
            seg = lines[i];
            level = leadingListLevel(seg);
            plain = trim(stripMarkers(stripHtml(seg)));
            if (!plain) continue;
            hashes = plain.match(/^(#{1,6})\s+/);
            if (hashes) {
                out.push({
                    text: stripOuterMarker(seg, /^(#{1,6})\s+/),
                    kind: hashes[1].length === 1 ? "h1" : "h2"
                });
                continue;
            }
            if (/^>\s?/.test(plain)) {
                out.push({ text: stripOuterMarker(seg, /^>\s?/), kind: "quote" });
                continue;
            }
            m = plain.match(/^(\d+)\.\s/);
            if (m) {
                out.push({
                    text: stripOuterMarker(seg, new RegExp("^" + m[1] + "\\.\\s+(?:" + m[1] + "\\.\\s*)?")),
                    kind: "num",
                    number: parseInt(m[1], 10),
                    level: level
                });
            } else if ((m = plain.match(/^(\d+)\)\s/))) {
                out.push({
                    text: stripOuterMarker(seg, new RegExp("^" + m[1] + "\\)\\s+")),
                    kind: "num",
                    number: parseInt(m[1], 10),
                    level: level
                });
            } else if (/^[-\u2022\u2013*+]\s/.test(plain)) {
                out.push({ text: stripOuterMarker(seg, /^[-\u2022\u2013*+]\s+/), kind: "bullet", level: level });
            } else {
                out.push({ text: seg, kind: "para" });
            }
        }
        return out;
    }

    var listStarts = [];
    var listLevels = [];
    var markerColorRuns = [];

    /** Pin each numbered item to the number written in the text. */
    function applyListStart(docRef, rec) {
        var story, contents, pos, para;
        try {
            story = docRef.stories.itemByID(rec.storyId);
            contents = String(story.contents);
            pos = rec.charIndex;
            if (contents.substr(pos, rec.probe.length) !== rec.probe) {
                pos = contents.indexOf(rec.probe, Math.max(0, rec.charIndex - 8));
                if (pos < 0) return false;
                rec.charIndex = pos;
            }
            para = story.characters[pos].paragraphs[0];
            para.numberingContinue = false;
            para.numberingStartAt = rec.number;
            return true;
        } catch (e) {
            log("list start failed n=" + rec.number + ": " + e.message);
            return false;
        }
    }

    function reapplyListStarts(docRef) {
        var i, ok = 0;
        for (i = 0; i < listStarts.length; i++) {
            if (applyListStart(docRef, listStarts[i])) ok++;
        }
        log("Numbered list starts => " + ok + "/" + listStarts.length);
    }

    function applyListLevel(docRef, rec) {
        var story, contents, pos, para, base;
        try {
            story = docRef.stories.itemByID(rec.storyId);
            contents = String(story.contents);
            pos = rec.charIndex;
            if (contents.substr(pos, rec.probe.length) !== rec.probe) {
                pos = contents.indexOf(rec.probe, Math.max(0, rec.charIndex - 8));
                if (pos < 0) return false;
                rec.charIndex = pos;
            }
            para = story.characters[pos].paragraphs[0];
            base = 0;
            try { base = Number(para.appliedParagraphStyle.leftIndent) || 0; } catch (eBase) {}
            para.leftIndent = base + (rec.level * 18);
            return true;
        } catch (e) {
            log("list level failed: " + e.message);
            return false;
        }
    }

    function reapplyListLevels(docRef) {
        var i, ok = 0;
        for (i = 0; i < listLevels.length; i++) {
            if (applyListLevel(docRef, listLevels[i])) ok++;
        }
        if (listLevels.length) log("Nested list indents => " + ok + "/" + listLevels.length);
    }

    function ensureMarkerCharStyle(docRef, hex) {
        var name = "CF_MARKER_" + String(hex || "").replace(/^#/, "");
        var cs = findCharStyle(docRef, name);
        var sw;
        if (cs) return cs;
        sw = ensureRgbSwatch(docRef, "CF_COLOR_" + String(hex).replace(/^#/, ""), hexToRgbList(hex));
        if (!sw) return null;
        try {
            cs = docRef.characterStyles.add({ name: name });
            cs.fillColor = sw;
            return cs;
        } catch (e) {
            log("marker character style failed " + name + ": " + e.message);
            return findCharStyle(docRef, name);
        }
    }

    function applyMarkerColor(docRef, rec) {
        var story;
        var contents;
        var pos;
        var para;
        var cs;
        try {
            story = docRef.stories.itemByID(rec.storyId);
            contents = String(story.contents);
            pos = rec.charIndex;
            if (contents.substr(pos, rec.probe.length) !== rec.probe) {
                pos = contents.indexOf(rec.probe, Math.max(0, rec.charIndex - 8));
                if (pos < 0) return false;
                rec.charIndex = pos;
            }
            para = story.characters[pos].paragraphs[0];
            cs = ensureMarkerCharStyle(docRef, rec.color);
            if (!cs) return false;
            try { para.bulletsCharacterStyle = cs; } catch (eB) {}
            try { para.numberingCharacterStyle = cs; } catch (eN) {}
            return true;
        } catch (e) {
            log("marker color failed: " + e.message);
            return false;
        }
    }

    function queueMarkerColor(docRef, story, charIndex, probe, color) {
        var rec;
        if (!color || !probe) return;
        rec = {
            storyId: story.id,
            charIndex: charIndex,
            probe: probe,
            color: color
        };
        markerColorRuns.push(rec);
        applyMarkerColor(docRef, rec);
    }

    function reapplyMarkerColors(docRef) {
        var i, ok = 0;
        for (i = 0; i < markerColorRuns.length; i++) {
            if (applyMarkerColor(docRef, markerColorRuns[i])) ok++;
        }
        log("Marker colors => " + ok + "/" + markerColorRuns.length);
    }

    function listStyleName(type, isFirst, isLast) {
        if (type === "BulletList") {
            if (isLast && !isFirst) return "BL_last";
            if (isFirst) return "BL_first";
            return "BL_mid";
        }
        if (isLast && !isFirst) return "NL_last";
        if (isFirst) return "NL_first";
        return "NL_mid";
    }

    function isGlossaryPlain(text) {
        var marked = trim(String(text || ""));
        var s = trim(stripMarkers(marked));
        if (!s || s.length >= 280) return false;
        if (/shutterstock\.com/i.test(s) || /^credit:/i.test(s)) return false;
        // A margin glossary opens with a purple key term. A body sentence that
        // only continues in lowercase is not a glossary and must not get the rule.
        if (marked.charAt(0) !== MK_KT_ON) return false;
        return /^[a-z]/.test(s);
    }

    function isGlossaryStyleName(name) {
        return name === "GL" || name === "GLDEF" || name === "GLDEF_last";
    }

    function ensureDividerInk(docRef) {
        var sw;
        try {
            sw = docRef.colors.itemByName("Black");
            if (sw && sw.isValid && sw.model === ColorModel.PROCESS) return sw;
        } catch (e0) {}
        try {
            sw = docRef.colors.itemByName("CF_DIVIDER");
            if (sw && sw.isValid) return sw;
        } catch (e1) {}
        try {
            sw = docRef.colors.add({
                name: "CF_DIVIDER",
                model: ColorModel.PROCESS,
                space: ColorSpace.CMYK,
                colorValue: [0, 0, 0, 55]
            });
            if (sw && sw.isValid) return sw;
        } catch (e2) {}
        try { return docRef.colors.itemByName("Black"); } catch (e3) {}
        return null;
    }

    /**
     * One column rule above each glossary group (marketing / exchange / …).
     * GL itself has no rule; GLDEF may. Force a visible process stroke when
     * the style rule is absent, and drop the rule on follow-on definitions
     * so the group matches the template: a single line over the first term.
     */
    function applyGlossaryDividers(docRef) {
        var si;
        var pi;
        var story;
        var para;
        var name;
        var prev = false;
        var first = false;
        var on = 0;
        var ink = ensureDividerInk(docRef);
        var weight;
        var above;
        for (si = 0; si < docRef.stories.length; si++) {
            try { story = docRef.stories[si]; } catch (eS) { continue; }
            prev = false;
            for (pi = 0; pi < story.paragraphs.length; pi++) {
                para = story.paragraphs[pi];
                try { if (trim(para.contents) === "") continue; } catch (eC) { continue; }
                try { name = String(para.appliedParagraphStyle.name || ""); } catch (eN) { name = ""; }
                if (!isGlossaryStyleName(name)) {
                    prev = false;
                    continue;
                }
                first = !prev;
                prev = true;
                if (!first) {
                    try { para.ruleAbove = false; } catch (eOff) {}
                    try { para.paragraphBorderTopLineWeight = 0; } catch (eTop) {}
                    continue;
                }
                try { above = !!para.ruleAbove; } catch (eA) { above = false; }
                try { weight = parseFloat(para.ruleAboveLineWeight); } catch (eW) { weight = 0; }
                if (!above || !(weight > 0)) {
                    try { para.ruleAbove = true; } catch (eOn) {}
                    try { para.ruleAboveLineWeight = 0.6; } catch (eWt) {}
                    try { para.ruleAboveTint = 100; } catch (eTi) {}
                    try { para.ruleAboveOffset = 8; } catch (eOf) {}
                    try { para.ruleAboveLeftIndent = 0; } catch (eL) {}
                    try { para.ruleAboveRightIndent = 0; } catch (eR) {}
                    if (ink) {
                        try { para.ruleAboveColor = ink; } catch (eCol) {}
                    }
                } else {
                    try { para.ruleAboveOverprint = false; } catch (eOp) {}
                    try {
                        if (para.ruleAboveColor) {
                            para.ruleAboveColor = strokeProcessColor(docRef, para.ruleAboveColor);
                        }
                    } catch (eInk) {}
                    try {
                        if (!(parseFloat(para.ruleAboveLineWeight) > 0.3)) para.ruleAboveLineWeight = 0.6;
                    } catch (eWt2) {}
                }
                try { para.ruleAboveWidth = RuleWidth.COLUMN_WIDTH; } catch (eWid) {}
                try { para.ruleAboveOverprint = false; } catch (eOp2) {}
                try {
                    if (!(parseFloat(para.spaceBefore) > 6)) para.spaceBefore = 10;
                } catch (eSb) {}
                on += 1;
            }
        }
        log("Glossary dividers => " + on);
    }

    function styleForBody(type, text, rawText) {
        var t = trim(type);
        var s = trim(stripMarkers(text || ""));
        // JSON only distinguishes heading levels by colour: orange = H3
        // (12pt Medium), green = H2 (15pt Bold).
        if (t === "SubSectionTitle" && /color:\s*#c[9a]5027/i.test(String(rawText || ""))) {
            return "H3";
        }
        if (t === "ParagraphText" || t === "Text") {
            if (/shutterstock\.com/i.test(s) || /^credit:/i.test(s)) return "PHCR";
            // Glossary definitions start with a purple key term and keep the GL typeface.
            // The divider is drawn later; GLDEF would replace this font.
            if (isGlossaryPlain(text)) return "GL";
            bodyTxCount += 1;
            return bodyTxCount === 1 ? "TX1" : "TX2";
        }
        if (t === "Quotation" || t === "Quote" || t === "PullQuote" || t === "Extract") {
            return "EXT1";
        }
        return STYLE_BY_TYPE[t] || "TX1";
    }

    /** Prefer EXT1 (template extract/quote style). */
    function resolveExtractStyleName(docRef) {
        if (findParaStyle(docRef, "EXT1")) return "EXT1";
        var names = ["EXT", "EXTA", "EXT2", "PULL", "Quote"];
        var i;
        for (i = 0; i < names.length; i++) {
            if (findParaStyle(docRef, names[i])) return names[i];
        }
        return "EXT1";
    }

    function appendQuotation(story, data, docRef) {
        var quoteText = blockText(data);
        var author = trim(stripHtml((data && data.author) || ""));
        var styleName = resolveExtractStyleName(docRef);
        var authorStyle = findParaStyle(docRef, "EXT2") ? "EXT2" : styleName;
        var st;
        var startPara;
        var i;
        // Avoid duplicating when JSON wrongly copies quote into author.
        if (author && quoteText && author === quoteText) author = "";
        if (!quoteText && author) {
            quoteText = author;
            author = "";
        }
        if (!quoteText) return;
        try { startPara = story.paragraphs.length; } catch (eS) { startPara = 0; }
        st = findParaStyle(docRef, styleName);
        try {
            log("Quotation style=" + styleName +
                " styleShadingOn=" + getShadingOn(st) +
                " styleColor=" + (st && st.paragraphShadingColor ? st.paragraphShadingColor.name : "?") +
                " styleTint=" + (st ? st.paragraphShadingTint : "?"));
        } catch (eL0) {}
        appendParagraph(story, quoteText, styleName, docRef);
        if (author) {
            if (!/^[\u2014\u2013\-]/.test(author)) author = "\u2014" + author;
            appendParagraph(story, author, authorStyle, docRef);
        }
        // Re-assert green band on every quotation paragraph we just added.
        try {
            for (i = startPara; i < story.paragraphs.length; i++) {
                if (trim(story.paragraphs[i].contents) === "") continue;
                // Author line uses EXT2 typography but same green band as EXT1.
                ensureExtractGreenShading(story.paragraphs[i], docRef, styleName);
                // Tighten gap so quote + attribution read as one green box.
                try {
                    if (i > startPara) story.paragraphs[i].spaceBefore = 0;
                    if (i < story.paragraphs.length - 1) story.paragraphs[i].spaceAfter = 2;
                } catch (eSp) {}
            }
        } catch (eFix) {
            log("Quotation shading reinforce failed: " + eFix.message);
        }
    }

    function themeTableCellText(cell) {
        if (cell === null || cell === undefined) return "";
        if (typeof cell === "object") {
            return cell.text === null || cell.text === undefined ? "" : String(cell.text);
        }
        return String(cell);
    }

    function themeTableMatrix(data) {
        var tableData = (data && data.table && typeof data.table === "object") ? data.table : (data || {});
        var cols = tableData.cols || data.cols || data.headers || [];
        var rows = tableData.rows || data.rows || [];
        var headerCount;
        var headerRows = [];
        var bodyRows = [];
        var widths = tableData.column_widths_pt || data.columnWidths || [];
        var i;
        var j;
        var cells;
        var outRow;
        var colCount = 0;
        if (!rows || rows.length === undefined) rows = [];
        if (!cols || cols.length === undefined) cols = [];
        headerCount = Number(tableData.header_row_count);
        if (isNaN(headerCount)) headerCount = Number(data.headerRowCount);
        if (isNaN(headerCount)) headerCount = cols.length ? 1 : 0;
        if (headerCount < 0) headerCount = 0;
        if (rows.length && rows[0] && typeof rows[0][0] === "object") {
            if (headerCount > rows.length) headerCount = rows.length;
            for (i = 0; i < rows.length; i++) {
                cells = rows[i] && rows[i].length !== undefined ? rows[i] : [rows[i]];
                if (cells.length > colCount) colCount = cells.length;
                outRow = [];
                for (j = 0; j < cells.length; j++) outRow.push(themeTableCellText(cells[j]));
                if (i < headerCount) headerRows.push(outRow);
                else bodyRows.push(outRow);
            }
        } else {
            colCount = cols.length;
            for (i = 0; i < rows.length; i++) {
                cells = rows[i] && rows[i].length !== undefined ? rows[i] : [rows[i]];
                if (cells.length > colCount) colCount = cells.length;
            }
            if (cols.length) {
                outRow = [];
                for (i = 0; i < colCount; i++) outRow.push(themeTableCellText(cols[i]));
                headerRows.push(outRow);
            }
            for (i = 0; i < rows.length; i++) {
                cells = rows[i] && rows[i].length !== undefined ? rows[i] : [rows[i]];
                outRow = [];
                for (j = 0; j < colCount; j++) outRow.push(themeTableCellText(cells[j]));
                bodyRows.push(outRow);
            }
        }
        if (!colCount && data && data.text) {
            colCount = 1;
            bodyRows.push([String(data.text)]);
        }
        return {
            title: trim(String((data && data.title) || tableData.title || "")),
            headerRows: headerRows,
            bodyRows: bodyRows,
            widths: widths,
            columnCount: colCount,
            span: String((data && (data.span || data.column_span)) || "full").toLowerCase()
        };
    }

    function storyContentBottom(head) {
        var cur = head;
        var safety = 0;
        var bottom = null;
        var gb;
        while (cur && safety < 30) {
            safety += 1;
            try {
                if (cur.lines && cur.lines.length) {
                    gb = cur.lines[cur.lines.length - 1].geometricBounds;
                    if (bottom === null || gb[2] > bottom) bottom = gb[2];
                }
            } catch (eL) {}
            try { cur = cur.nextTextFrame; } catch (eN) { break; }
            if (!cur) break;
        }
        return bottom;
    }

    function tableAccentColor(docRef) {
        var h2 = findParaStyle(docRef, "H2");
        try {
            if (h2 && h2.fillColor && h2.fillColor.isValid) return h2.fillColor;
        } catch (e0) {}
        return ensureRgbSwatch(docRef, "CF_TABLE_GREEN", [46, 125, 70]);
    }

    function fillThemeTableCell(cell, html, docRef, header) {
        var parsed = parseThemeInline(String(html || "").replace(/\\n/g, "\n"));
        var plain = String(parsed.text || "").replace(/\r\n/g, "\n").replace(/\n/g, "\r");
        var tx = findParaStyle(docRef, "TX2") || findParaStyle(docRef, "TX1");
        var boldStyle = findCharStyle(docRef, "BCPN Bold");
        var pi;
        var ri;
        var run;
        var start;
        var end;
        if (!plain) plain = " ";
        try { cell.contents = plain; } catch (eC) { return; }
        try {
            for (pi = 0; pi < cell.paragraphs.length; pi++) {
                if (tx) cell.paragraphs[pi].appliedParagraphStyle = tx;
                cell.paragraphs[pi].spaceBefore = pi === 0 ? 0 : 4;
                cell.paragraphs[pi].spaceAfter = 2;
            }
        } catch (eP) {}
        if (header && boldStyle) {
            try { cell.texts[0].appliedCharacterStyle = boldStyle; } catch (eH) {}
        }
        for (ri = 0; parsed.runs && ri < parsed.runs.length; ri++) {
            run = parsed.runs[ri];
            if (run.kind !== "bold" && run.kind !== "kt") continue;
            start = run.start;
            end = run.end - 1;
            if (end < start || !boldStyle) continue;
            try {
                cell.characters.itemByRange(start, end).appliedCharacterStyle = boldStyle;
            } catch (eB) {}
        }
    }

    /**
     * Theme 2 table is the green boxed callout, sized to the column pair.
     * span "column" keeps it in the first column. Anything else spans both
     * columns' live width, not the paper edge. Text that does not fit is overset.
     */
    function placeThemeTable(docRef, page, storyHead, data) {
        var matrix = themeTableMatrix(data || {});
        var cols;
        var leftBox;
        var rightBox;
        var left;
        var right;
        var colTop;
        var colBottom;
        var top;
        var frame;
        var accent;
        var rowCount;
        var table;
        var allRows;
        var r;
        var c;
        var width;
        var shares;
        var sum;
        var i;
        var gb;
        if (!matrix.columnCount) {
            log("Table skipped — no rows");
            return;
        }
        cols = columnsForPage(docRef, page);
        if (!cols.length) return;
        leftBox = t1BoundsOnPage(page, cols[0], docRef);
        rightBox = t1BoundsOnPage(page, cols[cols.length - 1], docRef);
        left = leftBox[1];
        right = rightBox[3];
        colTop = leftBox[0];
        colBottom = leftBox[2];
        if (matrix.span === "column" || matrix.span === "1") right = leftBox[3];
        top = storyContentBottom(storyHead);
        if (top === null || top < colTop) top = colTop;
        else top += 8;
        if (top > colBottom - 36) {
            log("Table trimmed — no room left on page " + page.name);
            return;
        }
        try {
            frame = page.textFrames.add({
                geometricBounds: [top, left, Math.min(top + 120, colBottom), right]
            });
        } catch (eAdd) {
            log("Table frame failed: " + eAdd.message);
            return;
        }
        try { frame.label = "CF_TABLE"; } catch (eLab) {}
        accent = tableAccentColor(docRef);
        try { frame.strokeWeight = 1.25; } catch (eSw) {}
        try { if (accent) frame.strokeColor = accent; } catch (eSc) {}
        try { frame.fillColor = docRef.swatches.itemByName("Paper"); } catch (eFill) {}
        try { frame.textFramePreferences.insetSpacing = [8, 10, 8, 10]; } catch (eIn) {}
        if (matrix.title) {
            appendParagraph(frame.parentStory, matrix.title, "H2", docRef);
        }
        allRows = matrix.headerRows.concat(matrix.bodyRows);
        rowCount = allRows.length;
        try {
            table = frame.parentStory.insertionPoints[-1].tables.add({
                columnCount: matrix.columnCount,
                bodyRowCount: rowCount
            });
        } catch (eTab) {
            log("Table object failed: " + eTab.message);
            return;
        }
        try { table.strokeWeight = 0; } catch (eTs) {}
        width = Math.max(40, (right - left) - 22);
        shares = [];
        sum = 0;
        if (matrix.widths && matrix.widths.length === matrix.columnCount) {
            for (i = 0; i < matrix.columnCount; i++) {
                shares.push(Number(matrix.widths[i]) || 0);
                sum += shares[i];
            }
        }
        for (c = 0; c < matrix.columnCount; c++) {
            try {
                table.columns[c].width = (sum > 0 ? (shares[c] / sum) : (1 / matrix.columnCount)) * width;
            } catch (eW) {}
        }
        for (r = 0; r < rowCount; r++) {
            for (c = 0; c < matrix.columnCount; c++) {
                try {
                    fillThemeTableCell(
                        table.rows[r].cells[c],
                        (allRows[r] && allRows[r][c]) || "",
                        docRef,
                        r < matrix.headerRows.length
                    );
                } catch (eCell) {
                    log("Table cell " + r + "," + c + " failed: " + eCell.message);
                }
            }
        }
        try { frame.fit(FitOptions.FRAME_TO_CONTENT); } catch (eFit) {}
        try {
            gb = frame.geometricBounds;
            if (gb[2] > colBottom) {
                frame.geometricBounds = [gb[0], gb[1], colBottom, gb[3]];
                log("Table height trimmed to column bottom on " + page.name);
            }
        } catch (eClamp) {}
        forceJumpWrap(frame);
        try { frame.textWrapPreferences.textWrapOffset = [8, 6, 10, 6]; } catch (eOff) {}
        try { docRef.recompose(); } catch (eRc) {}
        log("Placed theme2 table span=" + matrix.span +
            " cols=" + matrix.columnCount +
            " rows=" + rowCount +
            " bounds=" + frame.geometricBounds);
    }

    /**
     * Bake green extract shading into EXT1/EXT2 *styles* so the saved .indd
     * keeps it, and PDF browsers see process color (not Pantone spot tint).
     */
    function bakeExtractStylesGreen(docRef) {
        var green = ensureProcessSageGreen(docRef);
        var names = ["EXT1", "EXT2"];
        var i;
        var st;
        if (!green) {
            log("bakeExtractStylesGreen: no sage swatch");
            return;
        }
        for (i = 0; i < names.length; i++) {
            st = findParaStyle(docRef, names[i]);
            if (!st) continue;
            try {
                setShadingOn(st, true);
                st.paragraphShadingColor = green;
                st.paragraphShadingTint = 100;
                try { st.paragraphShadingTopOffset = 6; } catch (e1) {}
                try { st.paragraphShadingBottomOffset = 6; } catch (e2) {}
                try { st.paragraphShadingLeftOffset = 8; } catch (e3) {}
                try { st.paragraphShadingRightOffset = 8; } catch (e4) {}
                log("Baked style " + names[i] + " shadingOn=" + getShadingOn(st) +
                    " color=" + green.name + " tint=100");
            } catch (eSet) {
                log("bakeExtractStylesGreen " + names[i] + " failed: " + eSet.message);
            }
        }
    }

    /**
     * Guarantee EXT* paragraphs show the green shading band.
     * Uses process sage RGB so Chrome/Edge PDF viewers actually paint the fill
     * (PANTONE spot @20% often looks invisible in browser viewers).
     */
    function ensureExtractGreenShading(para, docRef, styleName) {
        var style = findParaStyle(docRef, styleName || "EXT1");
        var color;
        if (!para) return;
        if (style) syncParaMetricsFromStyle(para, style);
        color = ensureProcessSageGreen(docRef);
        if (!color) {
            log("Quotation shading MISSING — could not create process sage green");
            return;
        }
        try {
            if (!setShadingOn(para, true)) {
                log("Quotation shadingOn property unavailable");
                return;
            }
            para.paragraphShadingColor = color;
            // Sage RGB is already a light wash — use 100% tint (not Pantone@20).
            try { para.paragraphShadingTint = 100; } catch (eT) {}
            try {
                para.paragraphShadingWidth = ParagraphShadingWidthOptions.COLUMN_WIDTH;
            } catch (eW) {
                try { para.paragraphShadingWidth = 1131565687; } catch (eW2) {}
            }
            try { para.paragraphShadingTopOffset = 6; } catch (eTo) {}
            try { para.paragraphShadingBottomOffset = 6; } catch (eBo) {}
            try { para.paragraphShadingLeftOffset = 8; } catch (eLo) {}
            try { para.paragraphShadingRightOffset = 8; } catch (eRo) {}
            log("Quotation shading ON => swatch=" + color.name +
                " tint=" + para.paragraphShadingTint +
                " on=" + getShadingOn(para));
        } catch (eSet) {
            log("Quotation shading force failed: " + eSet.message);
        }
    }

    /** Process RGB sage matching client pull-quote sample — visible in browser PDFs. */
    function ensureProcessSageGreen(docRef) {
        var sw;
        var i;
        try {
            sw = docRef.colors.itemByName("Extract Sage Green");
            if (sw && sw.isValid) return sw;
        } catch (e0) {}
        try {
            // Prefer itemByName miss → add. Avoid mutating existing colors (can hang ID).
            sw = docRef.colors.add({
                name: "Extract Sage Green",
                model: ColorModel.PROCESS,
                space: ColorSpace.RGB,
                colorValue: [192, 210, 194]
            });
            if (sw && sw.isValid) return sw;
        } catch (e1) {
            log("ensureProcessSageGreen RGB add: " + e1.message);
        }
        try {
            sw = docRef.colors.add({
                name: "Extract Sage Green",
                model: ColorModel.PROCESS,
                space: ColorSpace.CMYK,
                colorValue: [20, 0, 15, 0]
            });
            if (sw && sw.isValid) return sw;
        } catch (e2) {
            log("ensureProcessSageGreen CMYK add: " + e2.message);
        }
        // Last resort: any process green already in the doc (never Pantone spot).
        try {
            for (i = 0; i < docRef.colors.length; i++) {
                sw = docRef.colors[i];
                try {
                    if (String(sw.name) === "C=100 M=30 Y=100 K=0") return sw;
                } catch (e3) {}
            }
        } catch (e4) {}
        return null;
    }

    function findExtractGreenSwatch(docRef) {
        return ensureProcessSageGreen(docRef);
    }

    function resolveImage(url) {
        var name;
        var candidates;
        var i;
        var f;
        var folder;
        var files;
        var fi;
        var n;
        var raw;
        var repoRoot;
        var pick;
        imageIndex += 1;
        raw = trim(String(url || ""));
        if (!raw) return null;
        name = raw.replace(/^.*[\\\/]/, "");
        try {
            repoRoot = workspaceRoot.parent; // frontend/
            if (repoRoot && repoRoot.parent) repoRoot = repoRoot.parent; // contentFlowApp/
        } catch (eR) { repoRoot = workspaceRoot; }

        candidates = [
            // Exact basename from JSON url (server downloads hash.jpg into assets/)
            scriptFolder.fsName + "/assets/" + name,
            workspaceRoot.fsName + "/assets/" + name,
            raw,
            scriptFolder.fsName + "/" + raw,
            workspaceRoot.fsName + "/" + raw,
            (repoRoot ? repoRoot.fsName + "/" + raw : ""),
            (workspaceRoot.parent ? workspaceRoot.parent.fsName + "/" + raw : "")
        ];
        for (i = 0; i < candidates.length; i++) {
            if (!candidates[i]) continue;
            f = File(candidates[i]);
            if (f.exists) {
                try { usedLocalAssets[String(f.name)] = true; } catch (eU) {}
                log("resolveImage => " + f.fsName + " (json url basename=" + name + ")");
                return f;
            }
        }

        // Local preview only: map JSON Image #N → next unused assets/img_*.*
        // Still an Image slot from JSON — never drop the block. Server path uses hash files.
        folder = Folder(scriptFolder + "/assets");
        if (!folder.exists) folder = Folder(workspaceRoot + "/assets");
        if (folder.exists) {
            try {
                files = folder.getFiles(function (file) {
                    var nm = String(file.name || "").toLowerCase();
                    // Prefer sample placeholders; skip already-resolved hash downloads.
                    return /^img_\d+\.(png|jpg|jpeg|tif|tiff|gif|webp)$/i.test(nm);
                });
                files.sort(function (a, b) {
                    var an = String(a.name).toLowerCase();
                    var bn = String(b.name).toLowerCase();
                    if (an < bn) return -1;
                    if (an > bn) return 1;
                    return 0;
                });
                pick = null;
                for (fi = 0; fi < files.length; fi++) {
                    n = String(files[fi].name || "");
                    if (usedLocalAssets[n]) continue;
                    pick = files[fi];
                    break;
                }
                if (!pick && files.length) {
                    pick = files[(imageIndex - 1) % files.length];
                }
                if (pick) {
                    try { usedLocalAssets[String(pick.name)] = true; } catch (eU2) {}
                    log("resolveImage JSON Image#" + imageIndex +
                        " missing " + name + " → local stand-in " + pick.name);
                    return pick;
                }
            } catch (eScan) {
                log("assets scan failed: " + eScan.message);
            }
        }
        log("resolveImage MISS => " + name);
        return null;
    }

    function findHeroFrame(page) {
        var list = collectByLabel(page, "HERO");
        var i;
        var item;
        var b;
        if (list.length) return list[0];
        list = overrideMasterLabeled(page, "HERO");
        if (list.length) return list[0];
        try {
            for (i = 0; i < page.allPageItems.length; i++) {
                item = page.allPageItems[i];
                if (!(item instanceof Rectangle)) continue;
                b = item.geometricBounds;
                if (near(b[0], HERO_BOUNDS.top, HERO_BOUNDS.tol) &&
                    (b[2] - b[0]) > 200 && (b[3] - b[1]) > 400) {
                    try { item.label = "HERO"; } catch (e) {}
                    return item;
                }
            }
            if (page.appliedMaster) {
                for (i = 0; i < page.appliedMaster.allPageItems.length; i++) {
                    item = page.appliedMaster.allPageItems[i];
                    if (!(item instanceof Rectangle)) continue;
                    b = item.geometricBounds;
                    if (near(b[0], HERO_BOUNDS.top, HERO_BOUNDS.tol) &&
                        (b[2] - b[0]) > 200 && (b[3] - b[1]) > 400) {
                        try { item = item.override(page); } catch (e2) {}
                        try { item.label = "HERO"; } catch (e3) {}
                        return item;
                    }
                }
            }
        } catch (e4) {}
        return null;
    }

    function findNextFigOrTable(docRef, fromPage) {
        var p;
        var i;
        var frames;
        var start = fromPage ? fromPage.documentOffset : 0;
        var ov;
        var page;
        // Prefer empty page-level FIGORTABLE; override from master if needed.
        for (p = start; p < docRef.pages.length; p++) {
            page = docRef.pages[p];
            try {
                ov = overrideMasterLabeled(page, "FIGORTABLE");
            } catch (eOv) { ov = []; }
            frames = collectByLabel(page, "FIGORTABLE");
            if (!frames.length && ov && ov.length) frames = ov;
            for (i = 0; i < frames.length; i++) {
                try {
                    if (!frames[i].graphics || frames[i].graphics.length === 0) {
                        try { frames[i].visible = true; } catch (eV) {}
                        return frames[i];
                    }
                } catch (e) {
                    try { frames[i].visible = true; } catch (eV2) {}
                    return frames[i];
                }
            }
        }
        return null;
    }

    /**
     * Ensure a placeable figure rectangle exists near the story page.
     * TX rebuild often leaves no empty FIGORTABLE overrides, so create one
     * in the left T1 column using template column geometry.
     */
    function ensureFigOrTableFrame(docRef, nearPage) {
        var frame;
        var page;
        var pr;
        var cols;
        var col;
        var top;
        var bottom;
        var bounds;
        frame = findNextFigOrTable(docRef, nearPage);
        if (frame) return frame;
        page = nearPage;
        if (!page) {
            try { page = docRef.pages[docRef.pages.length - 1]; } catch (eP) { return null; }
        }
        try { pr = pageRect(page, docRef); } catch (ePr) {
            pr = { top: 0, left: 0, bottom: 783, right: 612, w: 612, h: 783 };
        }
        cols = columnsForPage(docRef, page);
        col = (cols && cols.length) ? cols[0] : { top: 36, left: 36, bottom: 702, right: 279 };
        top = pr.top + col.top + 24;
        bottom = top + 210;
        if (bottom > pr.top + (col.bottom || 702) - 24) {
            bottom = pr.top + (col.bottom || 702) - 24;
        }
        bounds = [top, pr.left + col.left, bottom, pr.left + col.right];
        try {
            frame = page.rectangles.add({ geometricBounds: bounds });
            frame.label = "FIGORTABLE";
            try { frame.visible = true; } catch (eV) {}
            clearTextWrap(frame);
            log("Created FIGORTABLE frame on p" + page.name + " bounds=" + bounds);
            return frame;
        } catch (eAdd) {
            try {
                frame = page.textFrames.add({ geometricBounds: bounds });
                frame.label = "FIGORTABLE";
                frame.contents = "";
                log("Created FIGORTABLE textFrame on p" + page.name);
                return frame;
            } catch (eAdd2) {
                log("Could not create FIGORTABLE: " + eAdd.message + " / " + eAdd2.message);
                return null;
            }
        }
    }

    /**
     * Opener hero is full-bleed art, not a body figure: no column snap / live-area
     * clamp. scale_percent is a share of the full-bleed width (100 = edge to edge).
     */
    function placeHeroImage(frame, file, scalePercent) {
        var scale = parseFloat(scalePercent);
        var w;
        if (!frame || !file) return false;
        if (!(scale > 0)) scale = 100;
        if (scale > 100) scale = 100;
        w = (HERO_BOUNDS.right - HERO_BOUNDS.left) * scale / 100;
        try {
            try { frame.visible = true; } catch (eV) {}
            frame.geometricBounds = [HERO_BOUNDS.top, HERO_BOUNDS.left,
                HERO_BOUNDS.bottom, HERO_BOUNDS.left + w];
            frame.place(file, false);
            try { frame.fit(FitOptions.FILL_PROPORTIONALLY); } catch (e1) {}
            try { frame.fit(FitOptions.CENTER_CONTENT); } catch (e2) {}
            populated += 1;
            log("Hero placed scale=" + scale + "% bounds=" + frame.geometricBounds.join(","));
            return true;
        } catch (e) {
            warnings.push("hero place failed: " + e.message);
            return false;
        }
    }

    function placeInFrame(frame, file) {
        if (!frame || !file) return false;
        try {
            try { frame.visible = true; } catch (eV) {}
            frame.place(file, false);
            try { frame.fit(FitOptions.PROPORTIONALLY); } catch (e1) {}
            try { frame.fit(FitOptions.CENTER_CONTENT); } catch (e2) {}
            snapFigureToNearestColumn(frame);
            forceJumpWrap(frame);
            try {
                clampFigureToLiveArea(frame, frame.parentPage.parent.parent);
            } catch (eCl) {
                clampFigureToLiveArea(frame, null);
            }
            populated += 1;
            return true;
        } catch (e) {
            warnings.push("place failed: " + e.message);
            return false;
        }
    }

    /** Last threaded frame that actually holds lines. */
    function storyEndFrame(story) {
        var cur = null;
        var last = null;
        var safety = 0;
        try { cur = story.textFrames[0]; } catch (e0) { cur = null; }
        while (cur && safety < 30) {
            safety += 1;
            try {
                if (cur.lines && cur.lines.length > 0) last = cur;
            } catch (eL) {}
            try { cur = cur.nextTextFrame; } catch (eN) { break; }
            if (!cur || cur === last) break;
        }
        return last;
    }

    /**
     * Column rectangle in pasteboard coordinates, extended down to the footer.
     * The text frame often ends with the type, while the page still has the
     * column gap under both columns. That gap is where the figure belongs.
     */
    function columnLiveBox(page, docRef, frameBounds) {
        var pr;
        var cols;
        var i;
        var box;
        var best;
        var bestDist;
        var dist;
        var mid;
        var footerTop;
        var items;
        var lab;
        var b;
        var bottom;
        pr = pageRect(page, docRef);
        mid = frameBounds ? (frameBounds[1] + frameBounds[3]) / 2 : (pr.left + pr.right) / 2;
        cols = columnsForPage(docRef, page) || [];
        best = null;
        bestDist = 1e9;
        for (i = 0; i < cols.length; i++) {
            box = t1BoundsOnPage(page, cols[i], docRef);
            dist = Math.abs(((box[1] + box[3]) / 2) - mid);
            if (dist < bestDist) {
                bestDist = dist;
                best = box;
            }
        }
        if (!best) best = [pr.top + 36, pr.left + 36, pr.bottom - 36, pr.left + 279];
        footerTop = pr.bottom - 28;
        try {
            items = page.allPageItems;
            for (i = 0; i < items.length; i++) {
                lab = itemLabel(items[i]);
                if (lab !== "RH" && lab !== "RH_VERSO" && lab !== "RH_RECTO") continue;
                b = items[i].geometricBounds;
                if (b[0] > pr.top + 200 && b[0] < footerTop) footerTop = b[0] - 8;
            }
        } catch (eF) {}
        bottom = best[2];
        if (footerTop > bottom) bottom = footerTop;
        if (bottom > pr.bottom - 16) bottom = pr.bottom - 16;
        return { top: best[0], left: best[1], bottom: bottom, right: best[3] };
    }

    /**
     * Place the figure where the story has been filled so far, in that column.
     * An Image block that is last in the JSON stays after that text. The caption
     * is appended next and wraps underneath.
     * Room is the column under the last line, down to the footer — not the
     * text frame's own bottom, which can stop where the type stops.
     */
    function placeAnchoredImage(story, file, docRef, scalePercent, preferPage) {
        var anchor;
        var page;
        var colW;
        var figH;
        var maxH;
        var top;
        var left;
        var right;
        var bottom;
        var rect;
        var scale;
        var noneSw;
        var b;
        var nh;
        var naturalH;
        var cropped;
        if (!story || !file) return false;
        try {
            anchor = null;
            try {
                var tf = storyEndFrame(story);
                var gb;
                var live;
                var text = "";
                if (!tf) {
                    var ip = story.insertionPoints.item(-1);
                    tf = ip.parentTextFrames[0];
                }
                gb = tf.geometricBounds;
                live = columnLiveBox(tf.parentPage, docRef, gb);
                top = live.top;
                try { text = String(story.contents || ""); } catch (eT) {}
                if (trim(text) && tf.lines.length > 0) {
                    try { top = Number(tf.lines.item(-1).baseline) + 8; } catch (eB) {}
                }
                if (top < live.top) top = live.top;
                anchor = {
                    page: tf.parentPage,
                    top: top,
                    left: live.left,
                    right: live.right,
                    bottom: live.bottom
                };
                log("Image gap => lineTop=" + top +
                    " frameBottom=" + gb[2] +
                    " columnBottom=" + live.bottom +
                    " L=" + live.left + " R=" + live.right);
            } catch (eA) {}
            page = (anchor && anchor.page) || preferPage || null;
            if (!page) return false;
            if (!anchor) {
                anchor = { page: page, top: 36, left: 36, right: 279, bottom: 720 };
            }

            scale = parseFloat(scalePercent);
            if (isNaN(scale) || scale <= 0) scale = 100;

            top = anchor.top;
            left = anchor.left;
            right = anchor.right;
            bottom = anchor.bottom;
            colW = Math.max(80, right - left);
            maxH = bottom - 8 - top;
            naturalH = Math.max(72, colW * 0.70);
            if (scale > 100 && scale < 140) naturalH = naturalH * (scale / 100);
            // Keep a visible strip when the column is full, and cut the picture to it.
            if (maxH < 36) {
                top = Math.max(bottom - 44, anchor.top);
                maxH = bottom - 4 - top;
            }
            if (maxH < 24) {
                top = Math.max(bottom - 28, anchor.top);
                maxH = Math.max(24, bottom - 4 - top);
            }
            figH = Math.min(maxH, naturalH);
            cropped = figH < naturalH - 1;
            rect = page.rectangles.add({
                geometricBounds: [top, left, top + figH, right]
            });
            try { rect.label = "FIGORTABLE"; } catch (eL) {}
            try { rect.visible = true; } catch (eV) {}
            try {
                noneSw = docRef.swatches.itemByName("None");
                if (noneSw && noneSw.isValid) rect.fillColor = noneSw;
            } catch (eFill) {}
            try { rect.strokeWeight = 0; } catch (eSt) {}
            rect.place(file, false);
            if (cropped) {
                try { rect.fit(FitOptions.FILL_PROPORTIONALLY); } catch (eFillFit) {
                    try { rect.fit(FitOptions.PROPORTIONALLY); } catch (eF1) {}
                }
                try { rect.fit(FitOptions.CENTER_CONTENT); } catch (eF2) {}
                try { rect.geometricBounds = [top, left, top + figH, right]; } catch (eCrop) {}
            } else {
                try { rect.fit(FitOptions.PROPORTIONALLY); } catch (eF1) {}
                try { rect.fit(FitOptions.CENTER_CONTENT); } catch (eF2) {}
                try {
                    rect.fit(FitOptions.FRAME_TO_CONTENT);
                    b = rect.geometricBounds;
                    nh = b[2] - b[0];
                    if (nh > maxH) nh = maxH;
                    rect.geometricBounds = [top, left, top + nh, right];
                    rect.fit(FitOptions.PROPORTIONALLY);
                    rect.fit(FitOptions.CENTER_CONTENT);
                } catch (eFit) {}
            }
            forceJumpWrap(rect);
            try { rect.textWrapPreferences.textWrapOffset = [4, 0, 6, 0]; } catch (eOff) {}
            clampFigureToLiveArea(rect, docRef);
            populated += 1;
            log("Placed JSON Image in flow => " + file.name +
                " scale=" + scale +
                " cropped=" + cropped +
                " bounds=" + rect.geometricBounds +
                " on p" + page.name +
                " afterTextTop=" + top);
            return true;
        } catch (e) {
            warnings.push("image place failed: " + e.message);
            log("image place failed: " + e.message);
            return false;
        }
    }

    /** True if a FIGORTABLE already occupies this column's live top band. */
    function columnTopHasFigure(page, left, right, top, bandH) {
        var items;
        var i;
        var b;
        var mid;
        try { items = collectByLabel(page, "FIGORTABLE"); } catch (e0) { return false; }
        mid = (left + right) / 2;
        for (i = 0; i < items.length; i++) {
            try {
                if (!items[i].graphics || !items[i].graphics.length) continue;
                b = items[i].geometricBounds;
                if (b[0] > top + bandH) continue;
                if (b[2] < top) continue;
                if (mid >= b[1] - 4 && mid <= b[3] + 4) return true;
            } catch (e1) {}
        }
        return false;
    }

    /** Keep figure fully inside the text live area (never under header rule / margin). */
    function clampFigureToLiveArea(frame, docRef) {
        var page;
        var pr;
        var cols;
        var col;
        var b;
        var topMin;
        var botMax;
        var left;
        var right;
        var h;
        var top;
        var i;
        var mid;
        var best;
        var bestDist;
        var dist;
        if (!frame) return;
        try { page = frame.parentPage; } catch (e0) { return; }
        if (!page) return;
        if (!docRef) {
            try { docRef = page.parent.parent; } catch (eD) { return; }
        }
        try { pr = pageRect(page, docRef); } catch (ePr) { return; }
        cols = columnsForPage(docRef, page) || [];
        try { b = frame.geometricBounds; } catch (eB) { return; }
        mid = (b[1] + b[3]) / 2;
        best = cols[0] || { top: 36, left: 36, bottom: 702, right: 279 };
        bestDist = 1e9;
        for (i = 0; i < cols.length; i++) {
            dist = Math.abs(pr.left + (cols[i].left + cols[i].right) / 2 - mid);
            if (dist < bestDist) {
                bestDist = dist;
                best = cols[i];
            }
        }
        col = best;
        topMin = pr.top + col.top;
        botMax = pr.top + col.bottom - 8;
        left = pr.left + col.left;
        right = pr.left + col.right;
        h = b[2] - b[0];
        if (h > botMax - topMin) h = botMax - topMin;
        if (h < 40) return;
        top = b[0];
        if (top < topMin) top = topMin;
        if (top + h > botMax) h = botMax - top;
        if (h < 40) return;
        try {
            frame.geometricBounds = [top, left, top + h, right];
            try { frame.fit(FitOptions.PROPORTIONALLY); } catch (e1) {}
            try { frame.fit(FitOptions.CENTER_CONTENT); } catch (e2) {}
        } catch (eSet) {
            log("clampFigureToLiveArea failed: " + eSet.message);
        }
    }

    function clampAllFiguresInDoc(docRef) {
        var pi;
        var page;
        var items;
        var i;
        var n = 0;
        for (pi = 0; pi < docRef.pages.length; pi++) {
            page = docRef.pages[pi];
            items = collectByLabel(page, "FIGORTABLE");
            for (i = 0; i < items.length; i++) {
                try {
                    if (items[i].graphics && items[i].graphics.length) {
                        clampFigureToLiveArea(items[i], docRef);
                        n += 1;
                    }
                } catch (e) {}
            }
        }
        log("clampAllFiguresInDoc => " + n);
    }

    /**
     * At the top of a column, InDesign still honors spaceBefore — client pages
     * do not show that extra band. Zero it for the first non-empty paragraph
     * in each body T1 frame.
     */
    function suppressSpaceBeforeAtColumnTops(docRef) {
        var pi;
        var page;
        var frames;
        var fi;
        var tf;
        var p;
        var i;
        var n = 0;
        for (pi = 0; pi < docRef.pages.length; pi++) {
            page = docRef.pages[pi];
            frames = collectByLabel(page, "T1");
            for (fi = 0; fi < frames.length; fi++) {
                tf = frames[fi];
                try {
                    for (i = 0; i < tf.paragraphs.length; i++) {
                        p = tf.paragraphs[i];
                        if (trim(p.contents) === "") continue;
                        try {
                            if (p.spaceBefore > 0) {
                                p.spaceBefore = 0;
                                n += 1;
                            }
                        } catch (eSb) {}
                        break; // only the first real paragraph in this frame
                    }
                } catch (eF) {}
            }
        }
        log("suppressSpaceBeforeAtColumnTops => " + n);
    }

    /** Prefer JUMP wrap so body text never squeezes into a 1-glyph gutter beside a figure. */
    function forceJumpWrap(item) {
        if (!item) return;
        try {
            item.textWrapPreferences.textWrapMode = TextWrapModes.JUMP_OBJECT;
            try { item.textWrapPreferences.textWrapOffset = [6, 0, 6, 0]; } catch (eOff) {}
        } catch (eW) {
            try {
                item.textWrapPreferences.textWrapMode = TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
                item.textWrapPreferences.textWrapOffset = [8, 8, 8, 8];
            } catch (eW2) {}
        }
        // Wrap belongs on the frame; clear any graphic-level wrap that can fight it.
        try {
            var g;
            var gi;
            if (item.allGraphics) {
                for (gi = 0; gi < item.allGraphics.length; gi++) {
                    g = item.allGraphics[gi];
                    try { g.textWrapPreferences.textWrapMode = TextWrapModes.NONE; } catch (eG) {}
                }
            }
        } catch (eAll) {}
    }

    /** Widen/narrow FIGORTABLE to the T1 column it sits in so JUMP wrap clears the whole column. */
    function snapFigureToNearestColumn(frame) {
        var page;
        var t1;
        var i;
        var fb;
        var tb;
        var fMid;
        var best = null;
        var bestDist = 1e9;
        var dist;
        try { page = frame.parentPage; } catch (e0) { return; }
        if (!page) return;
        try { fb = frame.geometricBounds; } catch (e1) { return; }
        fMid = (fb[1] + fb[3]) / 2;
        t1 = collectByLabel(page, "T1");
        for (i = 0; i < t1.length; i++) {
            try {
                tb = t1[i].geometricBounds;
                dist = Math.abs(((tb[1] + tb[3]) / 2) - fMid);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = tb;
                }
            } catch (e2) {}
        }
        if (!best) return;
        try {
            // Keep top; match column left/right; tighten bottom to image if possible.
            frame.geometricBounds = [fb[0], best[1], fb[2], best[3]];
            try { frame.fit(FitOptions.PROPORTIONALLY); } catch (e3) {}
            try { frame.fit(FitOptions.CENTER_CONTENT); } catch (e4) {}
            try { frame.fit(FitOptions.FRAME_TO_CONTENT); } catch (e5) {}
            // Re-assert column width after FRAME_TO_CONTENT (it may narrow the frame).
            try {
                var nb = frame.geometricBounds;
                frame.geometricBounds = [nb[0], best[1], nb[2], best[3]];
                try { frame.fit(FitOptions.PROPORTIONALLY); } catch (e6) {}
                try { frame.fit(FitOptions.CENTER_CONTENT); } catch (e7) {}
            } catch (e8) {}
            log("Snapped figure to column L=" + best[1] + " R=" + best[3]);
        } catch (e5) {}
    }

    function flattenPages(parsed) {
        if (parsed && parsed.pages) return parsed.pages;
        return [];
    }

    function blockText(data) {
        return trim(stripHtml((data && (data.text || data.caption)) || ""));
    }

    // ---- run ----
    try { if (logFile.exists) logFile.remove(); } catch (e) {}
    log("=== " + VERSION + " client=" + CLIENT_ID + " ===");
    log("Client folder: " + scriptFolder.fsName);
    log("Workspace root: " + workspaceRoot.fsName);
    log("Template: " + templateFile.fsName);
    log("JSON: " + jsonFile.fsName);

    if (!templateFile.exists) throw new Error("templates/projectX.indd missing in " + scriptFolder.fsName);
    if (!jsonFile.exists) throw new Error("tree_output.json missing in " + scriptFolder.fsName);

    doc = null;
    // Always open a fresh template copy so prior folio renames / page deletes cannot stick.
    while (app.documents.length > 0) {
        try { app.documents[0].close(SaveOptions.NO); } catch (eC) { break; }
    }
    doc = app.open(templateFile);
    log("Opened fresh projectX from disk (pages=" + doc.pages.length + ")");

    // Template ships textDefaults = INDSE3 + KTRM (magenta key-term). Reset before any paste.
    resetTextDefaults(doc);
    log("Reset textDefaults => para=" +
        (function () { try { return doc.textDefaults.appliedParagraphStyle.name; } catch (e) { return "?"; } }()) +
        " char=" +
        (function () { try { return doc.textDefaults.appliedCharacterStyle.name; } catch (e) { return "?"; } }()));

    try {
        // Keep the document's native ruler units. Converting to POINTS changes
        // geometricBounds and breaks CO-Verso geometry fingerprints (picas).
    } catch (uErr) {}

    var labeled = labelCoVersoMaster(doc);
    log("CO-Verso frames labeled => " + labeled);
    relabelTxTextColumns(doc);
    log("Footer master frames labeled => " + labelAllFooterMasters(doc));

    // Persist labels + sane textDefaults into projectX.indd (allowed).
    try {
        doc.save(templateFile);
        log("Saved projectX.indd with CO + T1 role labels");
    } catch (saveErr) {
        warnings.push("Could not save projectX labels: " + saveErr.message);
        log("SAVE WARNING: " + saveErr.message);
    }

    var raw = readUtf8(jsonFile);
    var parsed = parseJson(raw);
    var pages = flattenPages(parsed);
    log("JSON pages => " + pages.length);

    var hasOpener = jsonHasOpenerPage(pages);
    log("JSON has opener page_type => " + hasOpener);

    // Units + single-page spreads BEFORE any populate. Doing this AFTER opener
    // used to delete/replace page 0 and wipe the filled CO-Verso page.
    var savedUnits = null;
    var savedFacing = null;
    try {
        savedUnits = {
            h: doc.viewPreferences.horizontalMeasurementUnits,
            v: doc.viewPreferences.verticalMeasurementUnits
        };
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        log("Geometry units => POINTS (was h=" + savedUnits.h + " v=" + savedUnits.v + ")");
    } catch (eUnits) {
        log("Could not set POINTS units: " + eUnits.message);
    }
    try {
        savedFacing = doc.documentPreferences.facingPages;
        // CO-Verso opener geometry is authored for facing pages. Turning facing
        // off shifts CHN/CHT off the visible page. Keep facing ON when JSON has
        // an opener; body-only runs can use single-page spreads for stable T1.
        if (hasOpener) {
            doc.documentPreferences.facingPages = true;
            unlockAllSpreads(doc);
            log("Facing pages => true (opener mode; was " + savedFacing + ")");
        } else {
            doc.documentPreferences.facingPages = false;
            unlockAllSpreads(doc);
            log("Facing pages => false (body-only; was " + savedFacing + ")");
        }
    } catch (eFace) {
        log("Could not set facing pages: " + eFace.message);
    }

    var startPage = hasOpener ? findChapterStartPage(doc) : findBodyStartPage(doc);
    log("Chapter start => " + startPage.name + " master=" +
        (startPage.appliedMaster ? startPage.appliedMaster.name : "(none)") +
        " (mode=" + (hasOpener ? "opener+body" : "body-only") + ")");

    var removed = 0;
    while (doc.pages.length > 1 && doc.pages[0] !== startPage &&
        trim(String(doc.pages[0].name)) !== trim(String(startPage.name))) {
        try {
            doc.pages[0].remove();
            removed += 1;
            startPage = hasOpener ? findChapterStartPage(doc) : findBodyStartPage(doc);
        } catch (rmErr) { break; }
    }
    // Body-only: drop any leftover CO-* pages ahead of TX-Text.
    if (!hasOpener) {
        while (doc.pages.length > 1) {
            try {
                if (doc.pages[0].appliedMaster &&
                    String(doc.pages[0].appliedMaster.name).indexOf("CO-") === 0) {
                    doc.pages[0].remove();
                    removed += 1;
                    continue;
                }
            } catch (eCo) {}
            break;
        }
        startPage = findBodyStartPage(doc);
        while (doc.pages.length > 1 && doc.pages[0] !== startPage &&
            trim(String(doc.pages[0].name)) !== trim(String(startPage.name))) {
            try {
                doc.pages[0].remove();
                removed += 1;
                startPage = findBodyStartPage(doc);
            } catch (rm2) { break; }
        }
    }
    startPage = doc.pages[0];
    log("Removed front matter => " + removed + "; render starts at " + startPage.name +
        " master=" + (startPage.appliedMaster ? startPage.appliedMaster.name : "(none)"));

    // Drop leftover TX template pages so overflow adds a clean contiguous chain.
    startPage = trimToMinimalStartPages(doc, hasOpener);
    startPage = doc.pages[0];
    log("Minimal start pages => " + doc.pages.length +
        "; page0=" + startPage.name +
        " master=" + (startPage.appliedMaster ? startPage.appliedMaster.name : "(none)") +
        " bounds=" + startPage.bounds);

    // Keep CO-Verso on the left-hand side (template page 58) before fill.
    if (hasOpener) {
        startPage = ensureOpenerIsVerso(doc, startPage);
        startPage = doc.pages[0];
    }

    // Body-only: if the remaining start page still has a non-zero pasteboard
    // origin, replace it. NEVER do this when an opener was/will be populated.
    if (!hasOpener) {
        try {
            var bStart = doc.pages[0].bounds;
            if (Math.abs(bStart[1]) > 1) {
                var oldMaster = null;
                try { oldMaster = doc.pages[0].appliedMaster; } catch (eM0) {}
                var freshPage = safeAddPage(doc, doc.pages[0]);
                try {
                    if (oldMaster && oldMaster.isValid) freshPage.appliedMaster = oldMaster;
                } catch (eM1) {}
                try { doc.pages[0].remove(); } catch (eRm0) {}
                startPage = doc.pages[0];
                log("Replaced body start page; new bounds => " + startPage.bounds);
            }
        } catch (eRep) {
            log("Body start page refresh failed: " + eRep.message);
        }
    }

    // ---- Opener (only when JSON has page_type: opener) ----
    var openerPage = null;
    var openerBlocks = [];
    var pi;
    var partText = "";
    var chapterNum = "";
    var chapterTitle = "";
    var coobtLines = [];
    var coobLines = [];
    var creditLines = [];
    var openerImageUrl = "";
    var openerImageScale = 100;
    var bi;
    var block;
    var type;
    var data;
    var text;

    if (hasOpener) {
        for (pi = 0; pi < pages.length; pi++) {
            if (String(pages[pi].page_type || "") === "opener") {
                openerPage = pages[pi];
                openerBlocks = pages[pi].content || [];
                break;
            }
        }
    } else {
        log("No opener in JSON — skipping CO-Verso populate entirely");
    }

    var chpnFrame = null;
    var chpnBg = null;
    var coobtTitle = "";
    var coobtIntro = "";

    if (hasOpener) {
    for (bi = 0; bi < openerBlocks.length; bi++) {
        block = openerBlocks[bi];
        type = trim(block.type || "");
        data = block.data || {};
        text = blockText(data);
        if (type === "Image" && data.url && !openerImageUrl) {
            openerImageUrl = data.url;
            openerImageScale = data.scale_percent;
            continue;
        }
        if (type === "PartNumber") { partText = text; continue; }
        if (type === "ChapterNumber") { chapterNum = text; continue; }
        if (type === "ChapterTitle") { chapterTitle = text; continue; }
        if (type === "ChapterOverview" || type === "LearningObjectives") {
            coobtLines.push(text);
            continue;
        }
        if (type === "LessonOverview") {
            coobLines.push(text);
            continue;
        }
        if (type === "ParagraphText" || type === "Text") {
            if (/shutterstock\.com/i.test(text)) {
                creditLines.push(text);
            } else if (/after studying/i.test(text)) {
                coobtLines.push(text);
            } else if (/^\d+$/.test(text)) {
                // folio-like lone number on opener — skip
            } else {
                coobtLines.push(text);
            }
        }
    }

    log("Opener COOBT lines => " + coobtLines.length + " :: " + coobtLines.join(" | "));
    log("Opener COOB lines => " + coobLines.length);
    log("Opener credits => " + creditLines.length);

    for (bi = 0; bi < coobtLines.length; bi++) {
        if (/after studying/i.test(coobtLines[bi])) {
            coobtIntro = coobtLines[bi];
        } else if (!coobtTitle) {
            coobtTitle = coobtLines[bi];
        } else if (!coobtIntro) {
            coobtIntro = coobtLines[bi];
        }
    }

    // Part chip: text + orange background rectangle (must sit above hero image).
    chpnFrame = getOrOverrideRoleFrame(startPage, "CHPN");
    chpnBg = findLabeledAnywhere(startPage, "CHPN_BG");
    if (trim(partText)) {
        setFrameText(chpnFrame, partText, "CHPN", doc);
        if (chpnBg) {
            try { chpnBg.visible = true; } catch (eBgVis) {}
        }
    } else {
        hideItem(chpnFrame);
        hideItem(chpnBg);
        log("No PartNumber in JSON — hid CHPN + CHPN_BG");
    }

    if (trim(chapterNum)) {
        setFrameText(getOrOverrideRoleFrame(startPage, "CHN"), chapterNum, "CHN", doc);
    } else {
        hideItem(getOrOverrideRoleFrame(startPage, "CHN"));
    }
    if (trim(chapterTitle)) {
        setFrameText(getOrOverrideRoleFrame(startPage, "CHT"), chapterTitle, "CHT", doc);
    } else {
        hideItem(getOrOverrideRoleFrame(startPage, "CHT"));
    }

    if (trim(coobtTitle) || trim(coobtIntro)) {
        setOpenerCoobt(getOrOverrideRoleFrame(startPage, "COOBT"), coobtTitle, coobtIntro, doc);
    } else {
        hideItem(getOrOverrideRoleFrame(startPage, "COOBT"));
    }

    if (coobLines.length) {
        var coobText = "";
        for (bi = 0; bi < coobLines.length; bi++) {
            coobText += (bi ? "\r" : "") + withCoobEnSpace(coobLines[bi]);
        }
        setFrameText(getOrOverrideRoleFrame(startPage, "COOB"), coobText, "COOB", doc);
        shrinkFrameToContent(getOrOverrideRoleFrame(startPage, "COOB"));
    } else {
        hideItem(getOrOverrideRoleFrame(startPage, "COOB"));
        log("No LessonOverview in JSON — hid COOB");
    }

    if (creditLines.length) {
        setFrameText(
            getOrOverrideRoleFrame(startPage, "PHCR"),
            creditLines.join("\r"),
            "PHCR_white",
            doc
        );
    } else {
        hideItem(getOrOverrideRoleFrame(startPage, "PHCR"));
    }

    if (openerImageUrl) {
        var hero = findHeroFrame(startPage);
        var heroFile = resolveImage(openerImageUrl);
        if (hero && heroFile) {
            placeHeroImage(hero, heroFile, openerImageScale);
            // Hero is a full-bleed photo — never wrap body text around it.
            try { hero.textWrapPreferences.textWrapMode = TextWrapModes.NONE; } catch (eHeroW) {}
            try { usedLocalAssets[String(heroFile.name)] = true; } catch (eUsed) {}
            log("Placed opener hero => " + heroFile.name);
            // Orange part chip sits above the hero only when JSON has a PartNumber.
            if (trim(partText)) {
                if (chpnBg) {
                    try { chpnBg.visible = true; } catch (eBgOn) {}
                    bringToFront(chpnBg);
                }
                if (chpnFrame) bringToFront(chpnFrame);
                if (chpnFrame) {
                    try {
                        chpnFrame.visible = true;
                        chpnFrame.contents = trim(stripMarkers(partText));
                        applyStyleToFrame(chpnFrame, "CHPN", doc);
                        log("Reapplied CHPN after hero => \"" + String(chpnFrame.contents).substring(0, 40) + "\"");
                    } catch (eReChpn) {
                        log("Reapply CHPN failed: " + eReChpn.message);
                    }
                }
                log("Brought CHPN_BG + CHPN above hero");
            } else {
                hideItem(chpnFrame);
                hideItem(chpnBg);
            }
        } else {
            warnings.push("Opener hero image missing or no HERO frame");
            log("HERO place skipped file=" + !!heroFile + " frame=" + !!hero);
        }
    } else {
        hideItem(findHeroFrame(startPage));
    }

    // Hide unused opener leftovers (pasteboard / unlabeled empty frames).
    (function hideEmptyOpenerFurniture() {
        var items;
        var ii;
        var it;
        var lab;
        var contents;
        try { items = startPage.allPageItems; } catch (e) { return; }
        for (ii = 0; ii < items.length; ii++) {
            it = items[ii];
            lab = itemLabel(it);
            if (lab === "HERO" || lab === "CHPN" || lab === "CHPN_BG" || lab === "CHN" ||
                lab === "CHT" || lab === "COOBT" || lab === "COOB" || lab === "PHCR" || lab === "RH") {
                continue;
            }
            try {
                if (it instanceof TextFrame) {
                    contents = trim(String(it.contents || "").replace(/\uFEFF/g, ""));
                    if (!contents) {
                        it.visible = false;
                    }
                }
            } catch (eHide) {}
        }
    }());

    // Verify opener identity frames actually carry text and sit on-page.
    (function verifyOpener() {
        var roles = ["CHPN", "CHN", "CHT", "COOBT", "COOB"];
        var ri;
        var fr;
        var pb;
        try { pb = startPage.bounds; } catch (ePb) { pb = [0, 0, 783, 612]; }
        for (ri = 0; ri < roles.length; ri++) {
            fr = (roles[ri] === "CHPN" && chpnFrame) ? chpnFrame : getOrOverrideRoleFrame(startPage, roles[ri]);
            try {
                if (fr) {
                    if (roles[ri] === "CHPN" && !trim(partText)) {
                        hideItem(fr);
                    } else {
                        try { fr.visible = true; } catch (eV0) {}
                        try { fr.bringToFront(); } catch (eB0) {}
                    }
                }
                log("VERIFY " + roles[ri] + " => \"" +
                    String(fr ? fr.contents : "(null)").replace(/\r/g, "\\n").substring(0, 80) +
                    "\" bounds=" + (fr ? fr.geometricBounds : "?") +
                    " pageBounds=" + pb);
            } catch (eV) {
                log("VERIFY " + roles[ri] + " read failed");
            }
        }
        if (trim(partText) && chpnBg) {
            try { chpnBg.visible = true; chpnBg.bringToFront(); } catch (eBg) {}
            if (chpnFrame) {
                try { chpnFrame.bringToFront(); } catch (eCf) {}
            }
        } else if (chpnBg) {
            hideItem(chpnBg);
        }
    }());

    // Re-apply template CO-Verso geometry so fill/fit cannot eat the right margin.
    try {
        snapOpenerFramesToMaster(startPage, doc);
        fitOpenerCoobToContent(startPage, doc);
        log("Snapped opener frames to CO-Verso master geometry");
    } catch (eSnap) {
        log("Opener snap failed: " + eSnap.message);
    }
    } // end hasOpener

    // Body pages need stable page-local T1 columns (template 36/279 + 297/540).
    // Facing-on odd/even pages were shifting copy by ~36pt and collapsing the
    // ~72pt outer margin. After opener is filled+snapped, switch to single-page
    // spreads WITHOUT deleting page 0 (that previously wiped the opener).
    if (hasOpener) {
        try {
            doc.documentPreferences.facingPages = false;
            unlockAllSpreads(doc);
            log("Facing pages => false after opener (body margin mode)");
            startPage = doc.pages[0];
            snapOpenerFramesToMaster(startPage, doc);
            fitOpenerCoobToContent(startPage, doc);
            // Facing-off can rebuild the master chip as a visible override.
            if (!trim(partText)) {
                hideItem(findLabeledAnywhere(startPage, "CHPN_BG"));
                hideItem(getOrOverrideRoleFrame(startPage, "CHPN"));
                log("No PartNumber — kept CHPN_BG hidden after facing=false");
            }
            log("Re-snapped opener after facing=false; bounds=" + startPage.bounds +
                " side=" + (function () { try { return String(startPage.side); } catch (e) { return "?"; } }()));
        } catch (eFaceBody) {
            log("Could not switch facing off for body: " + eFaceBody.message);
        }
    }

    // Clear master footers early; folio start is applied after body layout so
    // page renumbering cannot shrink/skip TX-Text pages during rebuild.
    clearAllMasterFooters(doc);

    // ---- Body by JSON page_no (no backfill) ----
    // Each JSON page owns exactly one PDF page. Overflow is left overset.
    var bodyStartIndex = hasOpener ? 1 : 0;
    var nextDocIndex = bodyStartIndex;
    var storyHeads = [];
    var pageOwners = {}; // docIndex -> json page_no
    var jsonPageNo;
    var pageHead;
    var pageStory;
    var offs;
    var oi;
    var content;
    var bodyStyle;

    log("Body layout mode => per JSON page_no (no backfill); bodyStartIndex=" + bodyStartIndex);

    // Ensure the first body page exists and is clean.
    ensureDocPageIndex(doc, bodyStartIndex);

    for (pi = 0; pi < pages.length; pi++) {
        if (hasOpener && String(pages[pi].page_type || "") === "opener") continue;
        jsonPageNo = parseInt(pages[pi].page_no, 10);
        if (isNaN(jsonPageNo)) jsonPageNo = pi + 1;

        ensureDocPageIndex(doc, nextDocIndex);
        startPage = doc.pages[nextDocIndex];
        pageHead = createFreshT1StoryOnPage(doc, startPage);
        hideStrayBodyFrames(doc, startPage);
        pageStory = pageHead.parentStory;
        content = pages[pi].content || [];

        log("JSON page_no=" + jsonPageNo + " starts at docIndex=" + nextDocIndex +
            " (page name=" + startPage.name + ")");

        for (bi = 0; bi < content.length; bi++) {
            block = content[bi];
            type = trim(block.type || "");
            data = block.data || {};
            text = blockText(data);

            if (type === "footer" || type === "Footer" || type === "PageHeader" || type === "header") {
                continue;
            }

            if (type === "Table" || type === "TableBlock") {
                placeThemeTable(doc, startPage, pageHead, data);
                try { doc.recompose(); } catch (eTabRc) {}
                pageStory = pageHead.parentStory;
                continue;
            }

            if (type === "Image") {
                if (!trim(String(data.url || ""))) {
                    log("Image block with empty url — skipped");
                    continue;
                }
                var imgFile = resolveImage(data.url);
                if (!imgFile) {
                    warnings.push("Image asset missing: " + (data.url || ""));
                    log("Image block kept in JSON order but no file for " +
                        String(data.url || "").substring(0, 80));
                    continue;
                }
                // Place at the current end of this page's text, in JSON order.
                if (placeAnchoredImage(pageStory, imgFile, doc, data.scale_percent, startPage)) {
                    try { doc.recompose(); } catch (eRc) {}
                    ensureOverflowCapacity(pageHead, doc);
                    pageStory = pageHead.parentStory;
                    if (data.caption) {
                        appendParagraph(pageStory, data.caption, "PHCAP", doc);
                        ensureOverflowCapacity(pageHead, doc);
                        pageStory = pageHead.parentStory;
                    }
                } else {
                    warnings.push("Body image place failed: " + (data.url || ""));
                    log("Body image place failed url=" + String(data.url || "").substring(0, 80));
                }
                continue;
            }

            if (type === "Quotation" || type === "Quote" || type === "PullQuote" || type === "Extract") {
                appendQuotation(pageStory, data, doc);
                ensureOverflowCapacity(pageHead, doc);
                pageStory = pageHead.parentStory;
                continue;
            }

            if (!text) continue;
            if (isJunkBodyText(type, text)) {
                log("Skipped junk body text => " + text.substring(0, 40));
                continue;
            }

            if (type === "LessonOverview" || type === "LearningObjectives") {
                text = withCoobEnSpace(text);
            }

            bodyStyle = styleForBody(type, text, data.text);
            if (bodyStyle === "GL") {
                text = String(text).replace(/^(\uE007?[a-z][a-zA-Z0-9\/\-\s]{0,40}?\uE008?)\s+/, "$1\u2002");
            }

            var placeText = text;
            var markerColor = "";
            if (data.text && (type === "ParagraphText" || type === "Text" ||
                type === "BulletList" || type === "NumberedList")) {
                placeText = String(data.text);
                markerColor = normalizeMarkerColor(data.marker_color || data.markerColor || "");
            }

            if (type === "BulletList" || type === "NumberedList") {
                var nextType = (bi + 1 < content.length) ? trim(content[bi + 1].type || "") : "";
                var prevType = (bi > 0) ? trim(content[bi - 1].type || "") : "";
                var isFirst = prevType !== type;
                var isLast = nextType !== type;
                var listBase = 0;
                var listProbe;
                try { listBase = pageStory.contents ? pageStory.characters.length : 0; } catch (eLb) {}
                listProbe = appendParagraph(pageStory, placeText, listStyleName(type, isFirst, isLast), doc);
                if (markerColor) queueMarkerColor(doc, pageStory, listBase, listProbe, markerColor);
            } else if (type === "ParagraphText" || type === "Text" || /\n/.test(placeText)) {
                var segs = splitEmbeddedList(placeText);
                for (var si = 0; si < segs.length; si++) {
                    var sk = segs[si].kind;
                    var segStyle = si === 0 ? bodyStyle : "TX2";
                    var segBase = 0;
                    var placedProbe = "";
                    if (sk === "h1") segStyle = "H1";
                    else if (sk === "h2") segStyle = "H2";
                    else if (sk === "quote") segStyle = "EXT1";
                    else if (sk === "num" || sk === "bullet") {
                        var segType = sk === "num" ? "NumberedList" : "BulletList";
                        var segFirst = si === 0 || segs[si - 1].kind !== sk;
                        var segLast = si === segs.length - 1 || segs[si + 1].kind !== sk;
                        segStyle = listStyleName(segType, segFirst, segLast);
                    }
                    try { segBase = pageStory.contents ? pageStory.characters.length : 0; } catch (eSb) {}
                    placedProbe = appendParagraph(pageStory, segs[si].text, segStyle, doc);
                    if (sk === "num" && segs[si].number) {
                        var segRec = {
                            storyId: pageStory.id,
                            charIndex: segBase,
                            probe: placedProbe,
                            number: segs[si].number
                        };
                        if (applyListStart(doc, segRec)) listStarts.push(segRec);
                    }
                    if ((sk === "num" || sk === "bullet") && segs[si].level > 0) {
                        var levelRec = {
                            storyId: pageStory.id,
                            charIndex: segBase,
                            probe: placedProbe,
                            level: segs[si].level
                        };
                        if (applyListLevel(doc, levelRec)) listLevels.push(levelRec);
                    }
                    if ((sk === "num" || sk === "bullet") && markerColor) {
                        queueMarkerColor(doc, pageStory, segBase, placedProbe, markerColor);
                    }
                }
            } else {
                appendParagraph(pageStory, text, bodyStyle, doc);
            }
            ensureOverflowCapacity(pageHead, doc);
            pageStory = pageHead.parentStory;
        }

        ensureOverflowCapacity(pageHead, doc);
        // Re-pin geometry after paste (auto-size / compose can widen frames).
        try { refitStoryT1Frames(pageHead, doc); } catch (eRf0) {}
        ensureOverflowCapacity(pageHead, doc);
        pageOwners[nextDocIndex] = jsonPageNo;
        log("JSON page_no=" + jsonPageNo + " kept on docIndex=" + nextDocIndex +
            " (overflow trimmed)");
        storyHeads.push(pageHead);
        nextDocIndex = nextDocIndex + 1;
    }

    var head = storyHeads.length ? storyHeads[0] : null;
    var story = head ? head.parentStory : null;

    hideUnusedFigures(doc, doc.pages[bodyStartIndex] || doc.pages[0]);

    // Final pass: re-sync spacing on every per-page story, then absorb overset.
    (function reassertAllStories(heads, docRef) {
        var hi;
        var storyRef;
        var i;
        var para;
        var st;
        var n = 0;
        for (hi = 0; hi < heads.length; hi++) {
            try { storyRef = heads[hi].parentStory; } catch (e0) { continue; }
            try {
                for (i = 0; i < storyRef.paragraphs.length; i++) {
                    para = storyRef.paragraphs[i];
                    if (trim(para.contents) === "") continue;
                    try { st = para.appliedParagraphStyle; } catch (e1) { continue; }
                    if (!st || !st.isValid) continue;
                    applyParaStyleClean(para, st, docRef);
                    n += 1;
                }
            } catch (e2) {}
            ensureOverflowCapacity(heads[hi], docRef);
        }
        log("Reasserted template spacing on paragraphs => " + n + " across stories=" + heads.length);
    }(storyHeads, doc));
    reapplyInlineRuns(doc);
    reapplyListStarts(doc);
    reapplyListLevels(doc);
    reapplyMarkerColors(doc);

    for (oi = 0; oi < storyHeads.length; oi++) {
        logStoryOverset(storyHeads[oi], doc, "Story#" + oi + " after spacing");
    }

    try {
        if (story && story.paragraphs.length > 0) {
            var p0 = story.paragraphs[0];
            log("VERIFY body p0 style=" + p0.appliedParagraphStyle.name +
                " fill=" + p0.fillColor.name +
                " font=" + p0.appliedFont.name +
                " size=" + p0.pointSize +
                " sb=" + p0.spaceBefore +
                " sa=" + p0.spaceAfter +
                " leading=" + p0.leading);
            try {
                log("VERIFY baselines p0->p1 gap=" +
                    (story.paragraphs[1].lines[0].baseline - story.paragraphs[0].lines[0].baseline));
            } catch (eBl) {}
        }
    } catch (vErr) {
        log("VERIFY body style failed: " + vErr.message);
    }

    try { doc.recompose(); } catch (e) {}

    // Ensure body text isn't buried under leftover template rectangles.
    (function bringAllStoryFramesForward(heads) {
        var hi;
        var cur;
        var safety;
        for (hi = 0; hi < heads.length; hi++) {
            cur = heads[hi];
            safety = 0;
            while (cur && safety < 200) {
                safety += 1;
                try { cur.bringToFront(); } catch (eB) {}
                if (!cur.nextTextFrame) break;
                cur = cur.nextTextFrame;
            }
        }
    }(storyHeads));

    // Refit threaded columns per story, then absorb overset.
    (function refitAllStories(heads, docRef) {
        var hi;
        var n = 0;
        for (hi = 0; hi < heads.length; hi++) {
            try { n += refitStoryT1Frames(heads[hi], docRef); } catch (eR) {}
        }
        log("Refit story T1 frames => " + n);
        try {
            log("Clamped spilled T1 frames => " +
                clampAllT1FramesToPage(docRef, getMasterT1Columns(docRef)));
        } catch (eClamp) {
            log("T1 clamp failed: " + eClamp.message);
        }
        for (hi = 0; hi < heads.length; hi++) {
            ensureOverflowCapacity(heads[hi], docRef);
            // Re-mark owners if overflow added pages after a story.
            offs = storyPageOffsets(heads[hi], docRef);
            for (oi = 0; oi < offs.length; oi++) {
                if (pageOwners[offs[oi]] == null && hi < pages.length) {
                    // Keep prior owner if set; only fill gaps from this story's json page.
                }
            }
        }
    }(storyHeads, doc));

    // Refresh ownership after possible overflow growth.
    (function refreshOwners(heads, pagesArr, owners, docRef) {
        var hi;
        var jsonIdx = 0;
        var jn;
        for (hi = 0; hi < heads.length; hi++) {
            while (jsonIdx < pagesArr.length &&
                hasOpener && String(pagesArr[jsonIdx].page_type || "") === "opener") {
                jsonIdx += 1;
            }
            if (jsonIdx >= pagesArr.length) break;
            jn = parseInt(pagesArr[jsonIdx].page_no, 10);
            if (isNaN(jn)) jn = jsonIdx + 1;
            offs = storyPageOffsets(heads[hi], docRef);
            for (oi = 0; oi < offs.length; oi++) owners[offs[oi]] = jn;
            jsonIdx += 1;
        }
    }(storyHeads, pages, pageOwners, doc));

    if (head) {
        // Keep every page owned by any JSON story; only strip true trailing empties.
        (function removeTrailingAfterAllStories(docRef, heads, keepFirst) {
            var maxKeep = keepFirst ? 0 : -1;
            var hi;
            var localOffs;
            var j;
            var i;
            var page;
            var removed = 0;
            for (hi = 0; hi < heads.length; hi++) {
                localOffs = storyPageOffsets(heads[hi], docRef);
                for (j = 0; j < localOffs.length; j++) {
                    if (localOffs[j] > maxKeep) maxKeep = localOffs[j];
                }
            }
            for (i = 0; i < docRef.pages.length; i++) {
                if (pageHasPlacedGraphics(docRef.pages[i]) && i > maxKeep) maxKeep = i;
            }
            if (maxKeep < 0) maxKeep = 0;
            log("Keeping through docIndex=" + maxKeep + " (stories=" + heads.length + ")");
            for (i = docRef.pages.length - 1; i > maxKeep; i--) {
                if (docRef.pages.length <= 1) break;
                try {
                    page = docRef.pages[i];
                    log("Removing trailing empty page => name=" + page.name);
                    page.remove();
                    removed += 1;
                } catch (eR) {}
            }
            log("Removed trailing empty pages => " + removed + "; pages kept => " + docRef.pages.length);
        }(doc, storyHeads, hasOpener));
    }
    for (oi = 0; oi < storyHeads.length; oi++) {
        ensureOverflowCapacity(storyHeads[oi], doc);
        logStoryOverset(storyHeads[oi], doc, "Final story#" + oi);
    }

    // Log page_no → doc page map for verification.
    (function logOwnerMap(owners, docRef) {
        var i;
        var keys = [];
        for (i = 0; i < docRef.pages.length; i++) {
            keys.push(i + ":json" + (owners[i] != null ? owners[i] : "?"));
        }
        log("DocIndex→JSON page_no map => " + keys.join(", "));
    }(pageOwners, doc));

    // Apply printed folio start now (after geometry), then JSON-driven footers.
    (function setSectionFolioStart() {
        var folioStart = firstFooterFolio(pages);
        try {
            if (folioStart !== null && doc.sections.length > 0) {
                doc.sections[0].continueNumbering = false;
                if (hasOpener && folioStart > 1) {
                    doc.sections[0].pageNumberStart = folioStart - 1;
                } else {
                    doc.sections[0].pageNumberStart = folioStart;
                }
                log("Section pageNumberStart => " + doc.sections[0].pageNumberStart +
                    " (first JSON footer folio=" + folioStart + ")");
            }
        } catch (eSec) {
            log("Section page number set failed: " + eSec.message);
        }
    }());

    try { doc.recompose(); } catch (eRf) {}

    // Final pass: process sage on every EXT paragraph before PDF/INDD save.
    // (Do not mutate EXT styles on a live story — that can hang InDesign recomposing.)
    (function reinforceExtractGreen(docRef) {
        var si;
        var pi;
        var story;
        var para;
        var sn;
        var n = 0;
        ensureProcessSageGreen(docRef);
        try {
            for (si = 0; si < docRef.stories.length; si++) {
                story = docRef.stories[si];
                for (pi = 0; pi < story.paragraphs.length; pi++) {
                    para = story.paragraphs[pi];
                    try { sn = String(para.appliedParagraphStyle.name || ""); } catch (eN) { sn = ""; }
                    if (!/^EXT/i.test(sn)) continue;
                    ensureExtractGreenShading(para, docRef, sn);
                    n += 1;
                }
            }
        } catch (eR) {
            log("reinforceExtractGreen failed: " + eR.message);
        }
        log("reinforceExtractGreen paragraphs => " + n);
    }(doc));
    try { doc.recompose(); } catch (eRf2) {}
    suppressSpaceBeforeAtColumnTops(doc);
    try { doc.recompose(); } catch (eRf2b) {}
    applyGlossaryDividers(doc);
    try { doc.recompose(); } catch (eRf2c) {}
    clampAllFiguresInDoc(doc);
    try { doc.recompose(); } catch (eRf3) {}

    // Drop blank pages left by reflow, then keep the PDF at one page per JSON page.
    // Overflow stays overset on its own page and is not given a new page.
    removeInteriorEmptyPages(doc);
    try { doc.recompose(); } catch (eRf4) {}
    for (oi = 0; oi < storyHeads.length; oi++) {
        ensureOverflowCapacity(storyHeads[oi], doc);
    }
    removeInteriorEmptyPages(doc);
    try { doc.recompose(); } catch (eRf5) {}
    (function lockPageCountToJson(docRef, expected) {
        var removed = 0;
        var page;
        if (expected < 1) expected = 1;
        while (docRef.pages.length > expected) {
            if (docRef.pages.length <= 1) break;
            try {
                page = docRef.pages[docRef.pages.length - 1];
                log("Trimming extra page past JSON count => name=" + page.name);
                page.remove();
                removed += 1;
            } catch (eLock) {
                log("Could not trim extra page: " + eLock.message);
                break;
            }
        }
        log("Page count locked => " + docRef.pages.length + " expected=" + expected +
            " trimmed=" + removed);
    }(doc, bodyStartIndex + storyHeads.length));
    applyPerPageFootersFromJson(doc, pages);

    try { if (pdfFile.exists) pdfFile.remove(); } catch (e) {}
    try {
        // Clear any leftover pageRange from inspect scripts (e.g. single-page tests).
        try { app.pdfExportPreferences.pageRange = ""; } catch (ePr) {}
        // Prefer process colors in the PDF so browser viewers paint the green band.
        try { app.pdfExportPreferences.spotColorAsProcess = true; } catch (eSp) {}
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
        log("Exported PDF => " + pdfFile.fsName + " exists=" + pdfFile.exists);
    } catch (pdfErr) {
        throw new Error("PDF export failed: " + pdfErr.message);
    }

    // Save filled document as output.indd (alongside output.pdf). Template stays clean.
    try {
        if (inddOutFile.exists) {
            try { inddOutFile.remove(); } catch (eRmIndd) {}
        }
        doc.saveACopy(inddOutFile);
        log("Saved filled INDD => " + inddOutFile.fsName + " exists=" + inddOutFile.exists);
    } catch (inddErr) {
        warnings.push("Could not save output.indd: " + inddErr.message);
        log("INDD save warning: " + inddErr.message);
    }

    // Close WITHOUT saving content into template — reopen clean next time.
    // Labels already saved earlier; discard content fill from the open template.
    try {
        doc.close(SaveOptions.NO);
        log("Closed projectX without saving filled content into template (labels already baked)");
    } catch (closeErr) {
        log("Close warning: " + closeErr.message);
    }

    try {
        renderStatusFile.encoding = "UTF-8";
        if (renderStatusFile.open("w")) {
            renderStatusFile.write(
                "Render log status: success\n" +
                "Client: " + CLIENT_ID + "\n" +
                "Script version: " + VERSION + "\n" +
                "Populated units: " + populated + "\n" +
                "PDF: " + pdfFile.fsName + "\n" +
                "INDD: " + inddOutFile.fsName + "\n" +
                "Warnings: " + warnings.length + "\n" +
                warnings.join("\n") + "\n"
            );
            renderStatusFile.close();
        }
    } catch (e) {}

    log("DONE populated=" + populated + " warnings=" + warnings.length);
}());
