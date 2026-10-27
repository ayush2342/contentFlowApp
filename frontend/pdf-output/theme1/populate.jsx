#target "InDesign"
// Fills templates/projectX.indd from tree_output.json.
// The PDF job writes that JSON from the same S3 document used by theme2 and the generic script.
// Exports output.pdf and output.indd next to this script. Images are read from assets/.

(function () {
    var prev = app.scriptPreferences.userInteractionLevel;
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    app.scriptPreferences.measurementUnit = MeasurementUnits.POINTS;

    var scriptFolder = File($.fileName).parent;
    var templateFile = new File(scriptFolder.fsName + "/templates/projectX.indd");
    var jsonFile = new File(scriptFolder.fsName + "/tree_output.json");
    var pdfFile = new File(scriptFolder.fsName + "/output.pdf");
    var inddOutFile = new File(scriptFolder.fsName + "/output.indd");

    var log = [];
    function note(s) { log.push(String(s)); }
    function writeLog() {
        var f = new File(scriptFolder.fsName + "/render.log");
        f.encoding = "UTF-8";
        f.open("w");
        f.write(log.join("\r\n"));
        f.close();
    }

    function readText(file) {
        file.encoding = "UTF-8";
        if (!file.open("r")) throw new Error("Cannot open " + file.fsName);
        var raw = file.read();
        file.close();
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.substring(1);
        return raw;
    }

    function decode(s) {
        return String(s)
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
            .replace(/&ldquo;|&rdquo;/gi, "\"")
            .replace(/&mdash;/gi, "\u2014")
            .replace(/&ndash;/gi, "\u2013");
    }

    function parseRuns(raw) {
        var s = decode(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var runs = [];
        var buf = "";
        var bold = false;
        var italic = false;
        var link = false;
        var figure = false;
        var i = 0;
        function push() {
            if (!buf) return;
            runs.push({ text: buf, bold: bold, italic: italic, link: link, figure: figure });
            buf = "";
        }
        while (i < s.length) {
            if (s.substring(i, i + 2) === "**") {
                push();
                bold = !bold;
                i += 2;
                continue;
            }
            if (s.charAt(i) === "<") {
                var end = s.indexOf(">", i);
                if (end < 0) { buf += s.charAt(i); i++; continue; }
                var tag = s.substring(i + 1, end);
                var low = tag.toLowerCase();
                push();
                if (low.indexOf("br") === 0) buf += "\n";
                else if (low.indexOf("/b") === 0 || low.indexOf("/strong") === 0) bold = false;
                else if (low === "b" || low.indexOf("b ") === 0 || low.indexOf("strong") === 0) bold = true;
                else if (low.indexOf("/i") === 0 || low.indexOf("/em") === 0) italic = false;
                else if (low === "i" || low.indexOf("i ") === 0 || low.indexOf("em") === 0) italic = true;
                else if (low.indexOf("/span") === 0) { link = false; figure = false; italic = false; }
                else if (low.indexOf("span") === 0) {
                    if (/c31427/i.test(tag)) figure = true;
                    if (/027eb5/i.test(tag) || /underline/i.test(tag)) link = true;
                    if (/italic/i.test(tag)) italic = true;
                }
                i = end + 1;
                continue;
            }
            buf += s.charAt(i);
            i++;
        }
        push();
        return runs;
    }

    function plain(raw) {
        var runs = parseRuns(raw);
        var t = "";
        var i;
        for (i = 0; i < runs.length; i++) t += runs[i].text;
        return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    }

    function firstSize(raw) {
        var m = String(raw).match(/font-size:\s*([0-9.]+)pt/i);
        return m ? parseFloat(m[1]) : 0;
    }
    function firstFamily(raw) {
        var m = String(raw).match(/font-family:\s*'([^']+)'/i);
        return m ? m[1] : "";
    }

    function storyBlank(story) {
        var c = story.contents;
        return c === "" || c === "\r";
    }

    var pendingPageStart = false;
    function takePageStart(paraRef) {
        var where = pendingPageStart ? StartParagraph.NEXT_PAGE : StartParagraph.ANYWHERE;
        pendingPageStart = false;
        try { paraRef.startParagraph = where; } catch (eStart) { note("page-start " + eStart.message); }
    }

    function appendPlain(doc, story, styleName, text, overrides) {
        var styleObj = doc.paragraphStyles.itemByName(styleName);
        if (storyBlank(story)) story.contents = text;
        else story.insertionPoints[-1].contents = "\r" + text;
        var paraRef = story.paragraphs[-1];
        try { paraRef.applyParagraphStyle(styleObj, true); } catch (e) { paraRef.appliedParagraphStyle = styleObj; }
        takePageStart(paraRef);
        try { paraRef.clearOverrides(OverrideType.CHARACTER_ONLY); } catch (eOv) {}
        try {
            paraRef.appliedFont = styleObj.appliedFont;
            paraRef.fontStyle = styleObj.fontStyle;
            paraRef.pointSize = styleObj.pointSize;
            paraRef.fillColor = styleObj.fillColor;
        } catch (eForce) {}
        try {
            if (paraRef.characters.length > 0) {
                paraRef.characters.everyItem().appliedCharacterStyle = doc.characterStyles.itemByName("[None]");
            }
        } catch (eClear) {}
        if (overrides) {
            if (overrides.spaceBefore !== undefined && overrides.spaceBefore !== null) paraRef.spaceBefore = overrides.spaceBefore;
            if (overrides.spaceAfter !== undefined && overrides.spaceAfter !== null) paraRef.spaceAfter = overrides.spaceAfter;
            if (overrides.leading !== undefined && overrides.leading !== null) paraRef.leading = overrides.leading;
            if (overrides.leftIndent !== undefined && overrides.leftIndent !== null) paraRef.leftIndent = overrides.leftIndent;
            if (overrides.firstLine !== undefined && overrides.firstLine !== null) paraRef.firstLineIndent = overrides.firstLine;
        }
        return paraRef;
    }

    function paintRuns(doc, paraRef, runs) {
        var cursor = 0;
        var i, run, from, to, styleName, cs;
        for (i = 0; i < runs.length; i++) {
            run = runs[i];
            if (!run.text) continue;
            from = cursor;
            to = cursor + run.text.length - 1;
            cursor += run.text.length;
            styleName = null;
            var paraName = "";
            var paraFamily = "";
            try { paraName = String(paraRef.appliedParagraphStyle.name); } catch (eName) {}
            try { paraFamily = String(paraRef.appliedParagraphStyle.appliedFont.fontFamily).toLowerCase(); } catch (eFam) {}
            if (run.figure) styleName = "FigureLabel";
            else if (run.link) styleName = "Link";
            else if (run.italic && paraName === "Caption") styleName = "CaptionItalic";
            else if (run.italic && paraFamily.indexOf("plex") !== -1) styleName = "Italic";
            else if (run.bold && paraFamily.indexOf("plex") !== -1) styleName = "Bold";
            if (!styleName || to < from) continue;
            try {
                cs = doc.characterStyles.itemByName(styleName);
                paraRef.characters.itemByRange(from, to).appliedCharacterStyle = cs;
            } catch (e) { note("paint " + styleName + " " + e.message); }
        }
    }

    function appendRich(doc, story, styleName, raw, overrides) {
        var text = plain(raw);
        if (!text) return null;
        var paraRef = appendPlain(doc, story, styleName, text, overrides);
        paintRuns(doc, paraRef, parseRuns(raw));
        return paraRef;
    }

    function startParagraph(doc, story, styleName) {
        story.insertionPoints[-1].contents = "\r\u00A0";
        var paraRef = story.paragraphs[-1];
        var styleObj = doc.paragraphStyles.itemByName(styleName);
        try { paraRef.applyParagraphStyle(styleObj, true); } catch (e) { paraRef.appliedParagraphStyle = styleObj; }
        return paraRef;
    }

    function dropPlaceholder(paraRef) {
        var i;
        try {
            for (i = paraRef.characters.length - 1; i >= 0; i--) {
                if (String(paraRef.characters[i].contents) === "\u00A0") paraRef.characters[i].remove();
            }
        } catch (e) {}
    }

    function ensureStoryComposed(doc, story) {
        try { if (story && story.recompose) story.recompose(); } catch (eComp) {}
    }

    function placeInline(doc, paraRef, w, h, objectStyleName, label) {
        var step = "compose";
        var rect = null;
        try {
            ensureStoryComposed(doc, paraRef.parentStory);
            step = "add";
            rect = paraRef.insertionPoints[0].rectangles.add();
            step = "style";
            rect.strokeWeight = 0;
            rect.strokeColor = "None";
            rect.fillColor = "None";
            rect.contentType = ContentType.GRAPHIC_TYPE;
            try { rect.appliedObjectStyle = doc.objectStyles.itemByName(objectStyleName); } catch (eOs) {}
            step = "bounds";
            try {
                rect.geometricBounds = ["0pt", "0pt", h + "pt", w + "pt"];
            } catch (eBounds) {
                ensureStoryComposed(doc, paraRef.parentStory);
                rect.geometricBounds = ["0pt", "0pt", h + "pt", w + "pt"];
            }
            rect.label = label;
            return rect;
        } catch (e) {
            note("inline-fail " + step + " | " + e.message + " | " + w + "x" + h);
            try { if (rect) rect.remove(); } catch (eRm) {}
            return null;
        }
    }

    function applyRule(doc, paraRef, pf) {
        if (!pf || !pf.bottom_border_color) return;
        var hex = String(pf.bottom_border_color).replace("#", "").toUpperCase();
        var map = {
            "0074BC": "Theme 2 Blue",
            "78B042": "Theme 2 Green",
            "F37541": "Theme 2 Orange",
            "B05E36": "Theme 2 Brown",
            "C31427": "Theme 2 Figure Red"
        };
        paraRef.ruleBelow = true;
        paraRef.ruleBelowLineWeight = pf.bottom_border_width_pt || 1.75;
        paraRef.ruleBelowColor = map[hex] || "Theme 2 Blue";
        paraRef.ruleBelowOffset = pf.bottom_border_space_pt || 5;
        paraRef.ruleBelowWidth = RuleWidth.COLUMN_WIDTH;
    }

    function overridesFrom(pf) {
        if (!pf) return null;
        var o = {};
        if (pf.space_before_pt !== undefined && pf.space_before_pt !== null) o.spaceBefore = pf.space_before_pt;
        if (pf.space_after_pt !== undefined && pf.space_after_pt !== null) o.spaceAfter = pf.space_after_pt;
        if (pf.line_spacing_pt) o.leading = pf.line_spacing_pt;
        if (pf.left_indent_pt !== undefined && pf.left_indent_pt !== null) o.leftIndent = pf.left_indent_pt;
        if (pf.hanging_indent_pt !== undefined && pf.hanging_indent_pt !== null) o.firstLine = -pf.hanging_indent_pt;
        return o;
    }

    function findFlow(doc) {
        var p, i, tf;
        for (p = 0; p < doc.pages.length; p++) {
            for (i = 0; i < doc.pages[p].textFrames.length; i++) {
                tf = doc.pages[p].textFrames[i];
                if (tf.label === "proto:flow" && tf.parentPage === doc.pages[p]) {
                    if (p === 0) return tf;
                }
            }
        }
        return null;
    }

    function clearStory(doc, story) {
        var items = doc.allPageItems;
        var i;
        for (i = items.length - 1; i >= 0; i--) {
            try {
                if (items[i].parent && items[i].parent.constructor.name === "Character") {
                    if (items[i].label === "proto:image" || items[i].label === "proto:heroImage" || items[i].label === "proto:logo") {
                        items[i].remove();
                    }
                } else if ((items[i].label === "proto:heroBackdrop" || items[i].label === "proto:captionBand") &&
                        items[i].parent.constructor.name === "Spread" && items[i].parentPage && items[i].parentPage.isValid) {
                    items[i].remove();
                }
            } catch (eItem) {}
        }
        story.contents = "";
    }

    function resolveImage(url) {
        if (!url) return null;
        var slash = Math.max(String(url).lastIndexOf("/"), String(url).lastIndexOf("\\"));
        var name = String(url).substring(slash + 1);
        var file = new File(scriptFolder.fsName + "/assets/" + name);
        if (file.exists) return file;
        return null;
    }

    function placeIntoFrame(doc, rect, file, story) {
        try {
            rect.frameFittingOptions.fittingOnEmptyFrame = EmptyFrameFittingOptions.PROPORTIONALLY;
            rect.frameFittingOptions.fittingAlignment = AnchorPoint.CENTER_ANCHOR;
        } catch (eOpt) {}
        var attempt, placed = false;
        for (attempt = 0; attempt < 2 && !placed; attempt++) {
            if (attempt === 1) ensureStoryComposed(doc, story);
            try {
                rect.place(file);
                rect.fit(FitOptions.PROPORTIONALLY);
                placed = true;
            } catch (eDirect) {
                try {
                    while (rect.graphics.length > 0) rect.graphics[0].remove();
                } catch (eClr) {}
                if (attempt === 1) throw eDirect;
            }
        }
    }

    function addHeroChrome(doc, rect) {
        var page = null;
        try { page = rect.parentPage; } catch (ePage) {}
        if (!page || !page.isValid) page = doc.pages[0];
        var b = rect.geometricBounds;
        var pb = page.bounds;
        var layer = doc.layers[0];
        var fi;
        for (fi = 0; fi < page.textFrames.length; fi++) {
            if (page.textFrames[fi].label === "proto:flow") layer = page.textFrames[fi].itemLayer;
        }
        var blue = page.rectangles.add(layer);
        blue.geometricBounds = [b[0] + "pt", pb[1] + "pt", b[2] + "pt", pb[3] + "pt"];
        blue.strokeWeight = 0;
        blue.strokeColor = "None";
        blue.fillColor = "Theme 2 Blue";
        try { blue.appliedObjectStyle = doc.objectStyles.itemByName("HeroBackdrop"); } catch (eOs) {}
        blue.fillColor = "Theme 2 Blue";
        blue.label = "proto:heroBackdrop";
        try { blue.textWrapPreferences.textWrapMode = TextWrapModes.NONE; } catch (eTw) {}
        var band = page.rectangles.add(layer);
        band.geometricBounds = [b[2] + "pt", pb[1] + "pt", (b[2] + 30.72) + "pt", pb[3] + "pt"];
        band.strokeWeight = 0;
        band.strokeColor = "None";
        band.fillColor = "Theme 2 Cream";
        try { band.appliedObjectStyle = doc.objectStyles.itemByName("CaptionBand"); } catch (eBand) {}
        band.fillColor = "Theme 2 Cream";
        band.label = "proto:captionBand";
        try { band.textWrapPreferences.textWrapMode = TextWrapModes.NONE; } catch (eTw2) {}
        blue.sendToBack();
        band.sendToBack();
        for (fi = 0; fi < page.textFrames.length; fi++) {
            if (page.textFrames[fi].label === "proto:flow") page.textFrames[fi].bringToFront();
        }
    }

    function heroHeightFromJson(data) {
        var v = data.hero_height_pt || data.display_height_pt;
        v = parseFloat(v);
        return (v > 0) ? v : 0;
    }

    function addImage(doc, story, data, isHero) {
        var w = data.display_width_pt || 243.75;
        var holder = (data.alignment === "center") ? "ImageHolderCenter" : "ImageHolderLeft";
        var paraRef;
        try {
            paraRef = appendPlain(doc, story, holder, " ");
        } catch (eHold) {
            note("holder-fail " + holder + " | " + eHold.message);
            return;
        }
        var h = w * 0.64;
        var rect = placeInline(doc, paraRef, w, h, "Image", "proto:image");
        if (!rect) return;
        ensureStoryComposed(doc, story);
        try { rect.insertLabel("display_width_pt", String(w)); } catch (eLab) { note("label-fail " + w + " " + eLab.message); }
        if (data.scale_percent !== undefined && data.scale_percent !== null) {
            try { rect.insertLabel("scale_percent", String(data.scale_percent)); } catch (eLab2) {}
        }
        var file = resolveImage(data.url);
        if (file) {
            try {
                placeIntoFrame(doc, rect, file, story);
                ensureStoryComposed(doc, story);
                var g = rect.graphics[0];
                var scaleX = g.horizontalScale;
                var scaleY = g.verticalScale;
                var gb = g.geometricBounds;
                var gw = gb[3] - gb[1];
                var gh = gb[2] - gb[0];
                var aspect = 0;
                if (gw > 1 && scaleX > 0 && scaleY > 0) {
                    aspect = (gh / (scaleY / 100)) / (gw / (scaleX / 100));
                    var newH = w * aspect;
                    var rb = rect.geometricBounds;
                    try {
                        rect.geometricBounds = [rb[0] + "pt", rb[1] + "pt", (rb[0] + newH) + "pt", (rb[1] + w) + "pt"];
                    } catch (eResize) {
                        note("resize-keep " + w + " x " + newH);
                    }
                    rect.fit(FitOptions.FILL_PROPORTIONALLY);
                }
                if (isHero) {
                    var heroPage = null;
                    try { heroPage = rect.parentPage; } catch (eHp) {}
                    if (!heroPage || !heroPage.isValid) heroPage = doc.pages[0];
                    var hb = rect.geometricBounds;
                    var heroRight = heroPage.bounds[3];
                    var heroW = heroRight - hb[1];
                    var heroH = heroHeightFromJson(data) || ((gw > 1 && aspect) ? heroW * aspect : (hb[2] - hb[0]));
                    rect.geometricBounds = [hb[0] + "pt", hb[1] + "pt", (hb[0] + heroH) + "pt", heroRight + "pt"];
                    rect.fit(FitOptions.FILL_PROPORTIONALLY);
                    rect.label = "proto:heroImage";
                    addHeroChrome(doc, rect);
                }
            } catch (eG) { note("image-file " + w + " " + eG.message); }
        } else if (isHero) {
            try {
                var emptyPage = doc.pages[0];
                var emptyB = rect.geometricBounds;
                var emptyRight = emptyPage.bounds[3];
                var emptyH = heroHeightFromJson(data) || 185;
                note("hero image missing, height " + emptyH);
                rect.geometricBounds = [emptyB[0] + "pt", emptyB[1] + "pt", (emptyB[0] + emptyH) + "pt", emptyRight + "pt"];
                rect.fillColor = "None";
                rect.label = "proto:heroImage";
                addHeroChrome(doc, rect);
            } catch (eFill) { note("hero-fail " + eFill.message); }
        } else {
            try { rect.fillColor = "Theme 2 Cream"; } catch (eFill2) { note("fill-fail " + w + " " + eFill2.message); }
        }
        dropPlaceholder(paraRef);
        if (data.caption) {
            var cap = null;
            try {
                ensureStoryComposed(doc, story);
                cap = appendRich(doc, story, "Caption", data.caption, {
                    spaceBefore: data.caption_space_before_pt,
                    spaceAfter: data.caption_space_after_pt,
                    leading: data.caption_line_spacing_pt || 9
                });
            } catch (eCapAdd) { note("cap-fail " + w + " " + eCapAdd.message); }
            if (cap) {
                try {
                    var label = plain(data.caption).match(/FIGURE\s+[0-9.]+/i);
                    if (label) {
                        var idx = String(cap.contents).indexOf(label[0]);
                        if (idx >= 0) {
                            cap.characters.itemByRange(idx, idx + label[0].length - 1).appliedCharacterStyle = doc.characterStyles.itemByName("FigureLabel");
                        }
                    }
                } catch (eCap) {}
                if (isHero) fitCaptionBand(doc, story, cap);
            }
        }
    }

    function fitCaptionBand(doc, story, cap) {
        var minHeight = 30.72;
        try {
            ensureStoryComposed(doc, story);
            var lines = cap.lines;
            if (lines.length < 2) return;
            var extra = lines[lines.length - 1].baseline - lines[1].baseline;
            if (extra <= 0) return;
            var page = cap.parentTextFrames[0].parentPage;
            var i, band, gb;
            for (i = 0; i < page.rectangles.length; i++) {
                band = page.rectangles[i];
                if (band.label !== "proto:captionBand") continue;
                gb = band.geometricBounds;
                band.geometricBounds = [gb[0] + "pt", gb[1] + "pt", (gb[0] + minHeight + extra) + "pt", gb[3] + "pt"];
                note("caption band " + (minHeight + extra) + " for " + lines.length + " lines");
            }
        } catch (eBand) { note("band-resize " + eBand.message); }
    }

    function addLogo(doc, story, data) {
        var pf = data.paragraph_format || {};
        var styleName = "LinkToLearning";
        var hex = pf.bottom_border_color ? String(pf.bottom_border_color).toUpperCase() : "";
        if (hex === "0074BC") styleName = "LinkToLearningBlue";
        else if (hex === "F37541") styleName = "LinkToLearningOrange";
        else if (hex === "B05E36") styleName = "LinkToLearningBrown";
        var paraRef = appendPlain(doc, story, styleName, " ");
        var size = data.display_width_pt || 11.201;
        var icon = placeInline(doc, paraRef, size, size, "LogoIcon", "proto:logo");
        if (!icon) return;
        icon.fillColor = "Theme 2 Green";
        icon.insertLabel("display_width_pt", String(size));
        var file = resolveImage(data.url);
        if (file) {
            icon.place(file);
            try { icon.fit(FitOptions.PROPORTIONALLY); } catch (eP) {}
        }
        var text = plain(data.text || "");
        paraRef.insertionPoints[-1].contents = "  " + text;
        dropPlaceholder(paraRef);
        applyRule(doc, paraRef, pf);
        if (pf.space_after_pt !== undefined && pf.space_after_pt !== null) paraRef.spaceAfter = pf.space_after_pt;
        if (pf.line_spacing_pt) paraRef.leading = pf.line_spacing_pt;
    }

    function styleFor(node) {
        var type = node.type;
        var data = node.data || {};
        var pf = data.paragraph_format || {};
        var text = data.text || "";
        if (type === "LessonOverview" && pf.bottom_border_color) return "LessonOverviewRule";
        if (type === "SubSectionTitle") {
            var family = firstFamily(text);
            var size = firstSize(text);
            if (/Medium/i.test(family) && !/0074bc/i.test(text)) return "SubSectionTitlePlain";
            if (size && size < 10) return "SubSectionTitleMinor";
            return "SubSectionTitle";
        }
        if (type === "ParagraphText") {
            if (pf.bottom_border_color && String(pf.bottom_border_color).toUpperCase() === "78B042") return "CalloutBodyRule";
            if (pf.list_type === "bullet") return "BulletList";
            if (pf.list_type === "number") {
                var marker = String(pf.marker || "");
                if (/[a-z]\./i.test(marker)) return "NumberedListAlpha";
                return "NumberedList";
            }
            return "ParagraphText";
        }
        if (type === "FigureCaption") return "Caption";
        return type;
    }

    function cellFont(info) {
        var family = info.font_family || "IBM Plex Sans";
        var style = "Regular";
        if (info.bold) style = "Bold";
        else if (info.italic) style = "Italic";
        try {
            var f = app.fonts.itemByName(family + "\t" + style);
            if (f.isValid) return f;
        } catch (eF) {}
        return null;
    }

    function fillCell(cell, info) {
        var text = String(info && info.text ? info.text : "").replace(/\r\n/g, "\r").replace(/\n/g, "\r");
        cell.contents = text;
        var para = cell.paragraphs[0];
        var f = cellFont(info || {});
        try {
            if (f) {
                para.appliedFont = f;
                para.fontStyle = f.fontStyleName;
            }
        } catch (eFont) {}
        if (info && info.font_size_pt) para.pointSize = info.font_size_pt;
        try { para.leading = ((info && info.font_size_pt) || 9) + 2.4; } catch (eLead) {}
        var align = info && info.horizontal_alignment ? String(info.horizontal_alignment) : "left";
        if (align === "center") para.justification = Justification.CENTER_ALIGN;
        else if (align === "right") para.justification = Justification.RIGHT_ALIGN;
        else para.justification = Justification.LEFT_ALIGN;
        try { para.hyphenation = false; } catch (eH) {}
        if (info && info.vertical_alignment === "center") {
            try { cell.verticalJustification = VerticalJustification.CENTER_ALIGN; } catch (eV) {}
        }
    }

    function relaxCell(cell) {
        var steps = [4, 2, 1];
        var i;
        try { if (!cell.overflows) return; } catch (e0) { return; }
        for (i = 0; i < steps.length; i++) {
            try {
                cell.leftInset = steps[i];
                cell.rightInset = steps[i];
                cell.topInset = 1;
                cell.bottomInset = 1;
            } catch (eIn) {}
            try { if (!cell.overflows) return; } catch (e1) { return; }
        }
    }

    function addTable(doc, story, data) {
        var rows = data.rows || [];
        if (!rows.length || !rows[0] || !rows[0].length) return;
        ensureStoryComposed(doc, story);
        var cols = rows[0].length;
        var headerCount = data.header_row_count || 0;
        if (headerCount >= rows.length) headerCount = 0;
        var bodyCount = rows.length - headerCount;
        if (!storyBlank(story)) story.insertionPoints[-1].contents = "\r";
        var table = story.insertionPoints[-1].tables.add({
            headerRowCount: headerCount,
            bodyRowCount: bodyCount,
            columnCount: cols
        });
        var widths = data.column_widths_pt || [];
        var heights = data.row_heights_pt || [];
        var c, r, stroke;
        for (c = 0; c < cols; c++) {
            if (widths[c]) {
                try { table.columns[c].width = widths[c]; } catch (eW) {}
            }
        }
        for (r = 0; r < rows.length; r++) {
            try {
                table.rows[r].autoGrow = true;
                if (heights[r]) table.rows[r].minimumHeight = heights[r];
            } catch (eHt) {}
            for (c = 0; c < cols && c < rows[r].length; c++) {
                fillCell(table.rows[r].cells[c], rows[r][c]);
            }
        }
        stroke = data.border_width_pt || 0.25;
        try {
            var all = table.cells.everyItem();
            all.topEdgeStrokeWeight = stroke;
            all.bottomEdgeStrokeWeight = stroke;
            all.leftEdgeStrokeWeight = stroke;
            all.rightEdgeStrokeWeight = stroke;
            all.topEdgeStrokeColor = "Black";
            all.bottomEdgeStrokeColor = "Black";
            all.leftEdgeStrokeColor = "Black";
            all.rightEdgeStrokeColor = "Black";
            all.leftInset = data.cell_margin_left_pt != null ? data.cell_margin_left_pt : 4;
            all.rightInset = data.cell_margin_right_pt != null ? data.cell_margin_right_pt : 4;
            all.topInset = 2;
            all.bottomInset = 2;
            all.verticalJustification = VerticalJustification.CENTER_ALIGN;
        } catch (eStroke) { note("table stroke " + eStroke.message); }
        try { story.recompose(); } catch (eComp) {}
        for (r = 0; r < table.rows.length; r++) {
            for (c = 0; c < table.columns.length; c++) {
                relaxCell(table.rows[r].cells[c]);
            }
        }
        try {
            var holder = table.storyOffset.paragraphs[0];
            takePageStart(holder);
            holder.spaceBefore = 6;
            holder.spaceAfter = 2;
            if (data.alignment === "center") holder.justification = Justification.CENTER_ALIGN;
        } catch (eHold) {}
        note("table " + rows.length + "x" + cols);
    }

    var calloutSwatches = { "0074BC": "Theme 2 Blue", "F37541": "Theme 2 Orange", "B05E36": "Theme 2 Brown", "78B042": "Theme 2 Green" };

    function isFlowNode(n) {
        return n && n.data && n.type !== "PageHeader" && n.type !== "Footer";
    }

    function endsCalloutSection(n) {
        if (n.type === "LogoWithText" || n.type === "LessonTitle" || n.type === "ChapterOverview" || n.type === "Table") return true;
        if (n.type === "SubSectionTitle") return styleFor(n) !== "SubSectionTitlePlain";
        return false;
    }

    // Returns { end: index of the last node inside the callout, swatch } for the LogoWithText at index.
    function calloutRange(content, index) {
        var logo = content[index];
        var pf = logo.data.paragraph_format || {};
        var label = plain(logo.data.text || "").toUpperCase();
        var hex = pf.bottom_border_color ? String(pf.bottom_border_color).toUpperCase() : "";
        var swatch = calloutSwatches[hex] || "Theme 2 Green";
        var end = index;
        var j;
        if (label.indexOf("LINK TO LEARNING") !== -1 || label.indexOf("VISUAL CONNECTION") !== -1) {
            for (j = index + 1; j < content.length; j++) {
                if (!isFlowNode(content[j])) continue;
                if (content[j].type === "ParagraphText") { end = j; break; }
                if (content[j].type !== "Image") break;
                end = j;
            }
        } else {
            for (j = index + 1; j < content.length; j++) {
                if (!isFlowNode(content[j])) continue;
                if (endsCalloutSection(content[j])) break;
                end = j;
            }
        }
        return { end: end, swatch: swatch };
    }

    function closeCallout(story, swatch) {
        var p = story.paragraphs[-1];
        try {
            p.ruleBelow = true;
            p.ruleBelowLineWeight = 1.75;
            p.ruleBelowColor = swatch;
            p.ruleBelowOffset = 5;
            p.ruleBelowWidth = RuleWidth.COLUMN_WIDTH;
            p.ruleBelowLeftIndent = 0;
            p.ruleBelowRightIndent = 0;
            p.ruleBelowTint = 100;
            if (p.spaceAfter < 22.3) p.spaceAfter = 22.3;
        } catch (eRule) { note("callout-end " + eRule.message); }
    }

    function headerFrameFor(page) {
        var i, master, mpage, tf;
        for (i = 0; i < page.textFrames.length; i++) {
            if (page.textFrames[i].label === "proto:pageHeader") return page.textFrames[i];
        }
        master = page.appliedMaster;
        if (!master || !master.isValid) return null;
        mpage = (master.pages.length > 1 && page.side === PageSideOptions.RIGHT_HAND) ? master.pages[1] : master.pages[0];
        for (i = 0; i < mpage.textFrames.length; i++) {
            tf = mpage.textFrames[i];
            if (tf.label === "proto:pageHeader") return tf.override(page);
        }
        return null;
    }

    // A PageHeader with a printed page number goes on that page. A page without one
    // reuses the header from two pages earlier, so verso and recto keep their own running heads.
    function applyPageHeaders(doc, story, pageHeaders, pageStartPara, fallback, headerByNumber, startPage) {
        var variable = doc.textVariables.itemByName("proto:runningHeader");
        var byOffset = {};
        var pi, para, offset, i, current, tf, inst, k, num, done = 0;
        var used = [];
        var numbered = false;
        for (num in headerByNumber) { if (headerByNumber.hasOwnProperty(num)) numbered = true; }
        try { story.recompose(); } catch (eRc) {}
        for (pi = 0; pi < pageHeaders.length && !numbered; pi++) {
            if (pageHeaders[pi] === undefined) continue;
            offset = (pageStartPara && pageStartPara[pi] !== undefined) ? pageStartPara[pi] : -1;
            if (offset < 0) continue;
            if (byOffset[offset] === undefined) byOffset[offset] = pageHeaders[pi];
        }
        for (num in headerByNumber) {
            if (headerByNumber.hasOwnProperty(num)) byOffset[parseInt(num, 10) - startPage] = headerByNumber[num];
        }
        for (i = 0; i < doc.pages.length; i++) {
            current = byOffset[i];
            if (current === undefined && i >= 2) current = used[i - 2];
            if (current === undefined) current = fallback;
            used[i] = current;
            if (!current) continue;
            try {
                tf = headerFrameFor(doc.pages[i]);
                if (!tf) continue;
                variable.variableOptions.contents = current;
                inst = tf.parentStory.textVariableInstances;
                for (k = inst.length - 1; k >= 0; k--) {
                    if (inst[k].associatedTextVariable.name === "proto:runningHeader") inst[k].convertToText();
                }
                done++;
            } catch (eHdr) { note("page-header " + (i + 1) + " " + eHdr.message); }
        }
        if (fallback) variable.variableOptions.contents = fallback;
        note("page headers set on " + done + " pages");
    }

    function nextIsType(content, index, type) {
        var j;
        for (j = index + 1; j < content.length; j++) {
            if (!content[j] || content[j].type === "PageHeader" || content[j].type === "Footer") continue;
            return content[j].type === type;
        }
        return false;
    }

    // ParagraphText markdown arrives as data.rich_text (b/i/u/s/sub/sup/mark/a and list items).
    function parseMarkup(raw) {
        var text = decode(String(raw || ""));
        var plain = "";
        var runs = [];
        var stack = [];
        var i = 0;
        function pushRun(start, end) {
            var f, s, prev;
            if (end <= start) return;
            f = { start: start, end: end, bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, highlight: false, href: "" };
            for (s = 0; s < stack.length; s++) {
                if (stack[s].bold) f.bold = true;
                if (stack[s].italic) f.italic = true;
                if (stack[s].underline) f.underline = true;
                if (stack[s].strike) f.strike = true;
                if (stack[s].sup) f.sup = true;
                if (stack[s].sub) f.sub = true;
                if (stack[s].highlight) f.highlight = true;
                if (stack[s].href) f.href = stack[s].href;
            }
            prev = runs.length ? runs[runs.length - 1] : null;
            if (prev && prev.end === f.start && prev.bold === f.bold && prev.italic === f.italic && prev.underline === f.underline && prev.strike === f.strike && prev.sup === f.sup && prev.sub === f.sub && prev.highlight === f.highlight && prev.href === f.href) {
                prev.end = f.end;
            } else if (f.bold || f.italic || f.underline || f.strike || f.sup || f.sub || f.highlight || f.href) {
                runs.push(f);
            }
        }
        while (i < text.length) {
            if (text.charAt(i) !== "<") { plain += text.charAt(i); i++; continue; }
            var close = text.indexOf(">", i);
            if (close < 0) { plain += text.substring(i); break; }
            var tag = text.substring(i + 1, close);
            var low = tag.toLowerCase();
            var name = low.replace(/^\//, "").replace(/\s.*$/, "").replace(/\/$/, "");
            var isClose = low.charAt(0) === "/";
            if (name === "br") {
                plain += "\u0001";
            } else if (!isClose && (name === "b" || name === "strong" || name === "i" || name === "em" || name === "u" || name === "s" || name === "strike" || name === "del" || name === "sub" || name === "sup" || name === "mark" || name === "a" || name === "span")) {
                var href = "";
                var hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
                if (hrefMatch) href = hrefMatch[1];
                stack.push({
                    name: name,
                    start: plain.length,
                    bold: name === "b" || name === "strong",
                    italic: name === "i" || name === "em" || /font-style\s*:\s*italic/i.test(tag),
                    underline: name === "u" || /underline/i.test(tag),
                    strike: name === "s" || name === "strike" || name === "del" || /line-through/i.test(tag),
                    sup: name === "sup",
                    sub: name === "sub",
                    highlight: name === "mark" || /background-color/i.test(tag),
                    href: name === "a" ? href : ""
                });
            } else if (isClose) {
                var s, opened;
                for (s = stack.length - 1; s >= 0; s--) {
                    if (stack[s].name === name) {
                        opened = stack[s];
                        stack.splice(s, 1);
                        stack.push(opened);
                        pushRun(opened.start, plain.length);
                        stack.pop();
                        break;
                    }
                }
            }
            i = close + 1;
        }
        while (stack.length) {
            var open = stack[stack.length - 1];
            pushRun(open.start, plain.length);
            stack.pop();
        }
        return { plain: plain, runs: runs };
    }

    function paintMarkup(doc, paraRef, runs) {
        var i, run, range;
        runs.sort(function (a, b) { return (b.end - b.start) - (a.end - a.start); });
        for (i = 0; i < runs.length; i++) {
            run = runs[i];
            if (!run || run.end <= run.start) continue;
            try {
                range = paraRef.characters.itemByRange(run.start, run.end - 1);
            } catch (eRange) { continue; }
            try {
                if (run.bold && run.italic) range.fontStyle = "Bold Italic";
                else if (run.bold) range.appliedCharacterStyle = doc.characterStyles.itemByName("Bold");
                else if (run.italic) range.appliedCharacterStyle = doc.characterStyles.itemByName("Italic");
            } catch (eFace) {}
            if (run.href) {
                try { range.appliedCharacterStyle = doc.characterStyles.itemByName("Link"); } catch (eLink) {}
                try { range.underline = true; } catch (eU) {}
            } else if (run.underline) {
                try { range.underline = true; } catch (eU2) {}
            }
            if (run.strike) {
                try { range.strikeThru = true; } catch (eS) {}
            }
            if (run.highlight) {
                try {
                    range.underline = true;
                    range.underlineWeight = 8;
                    range.underlineOffset = -3;
                    range.underlineColor = "Theme 2 Cream";
                } catch (eH) {}
            }
            if (run.sup) {
                try { range.position = Position.SUPERSCRIPT; } catch (eSup) {}
            } else if (run.sub) {
                try { range.position = Position.SUBSCRIPT; } catch (eSub) {}
            }
        }
    }

    function appendMarkdownParagraph(doc, story, node) {
        var entries = node.data.rich_text || [];
        var pf = node.data.paragraph_format;
        var blockStyle = styleFor(node);
        var overrides = overridesFrom(pf);
        var i, j, entry, kind, styleName, parsed, paraRef, followedByList, laterBullet;
        for (i = 0; i < entries.length; i++) {
            entry = entries[i] || {};
            kind = entry.kind || "paragraph";
            if (kind === "blank") continue;
            parsed = parseMarkup(entry.html || "");
            if (!parsed.plain) continue;
            followedByList = false;
            if (i + 1 < entries.length && entries[i + 1] && (entries[i + 1].kind === "bullet" || entries[i + 1].kind === "number")) followedByList = true;
            if (kind === "bullet") {
                laterBullet = false;
                for (j = i + 1; j < entries.length; j++) {
                    if (entries[j] && entries[j].kind === "bullet") { laterBullet = true; break; }
                }
                styleName = (!laterBullet && doc.paragraphStyles.itemByName("BulletListLast").isValid) ? "BulletListLast" : "BulletList";
            } else if (kind === "number") {
                styleName = "NumberedList";
            } else if (followedByList) {
                styleName = "ListIntro";
            } else if (kind === "h1" || kind === "h2") {
                styleName = doc.paragraphStyles.itemByName("SubSectionTitle").isValid ? "SubSectionTitle" : "ParagraphText";
            } else if (blockStyle === "CalloutBodyRule") {
                styleName = "CalloutBodyRule";
            } else {
                styleName = "ParagraphText";
            }
            paraRef = appendPlain(doc, story, styleName, parsed.plain, i === 0 ? overrides : null);
            try {
                var k;
                for (k = paraRef.characters.length - 1; k >= 0; k--) {
                    if (paraRef.characters[k].contents === "\u0001") {
                        paraRef.characters[k].contents = SpecialCharacters.FORCED_LINE_BREAK;
                    }
                }
            } catch (eBr) {}
            paintMarkup(doc, paraRef, parsed.runs);
            if (kind !== "bullet" && kind !== "number") applyRule(doc, paraRef, pf);
        }
    }

    function appendBlock(doc, story, styleName, raw, pf) {
        var text = plain(raw);
        var dashList = /(^|\n)\s*-\s+/.test(text);
        if ((pf && (pf.list_type === "bullet" || pf.list_type === "number")) || dashList) {
            pf = pf || {};
            var parts = text.split(/\n+/);
            var items = [];
            var i, line, introDone = false;
            for (i = 0; i < parts.length; i++) {
                line = parts[i].replace(/^\s*-\s+/, "").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1$2").replace(/^\s+|\s+$/g, "");
                if (!line) continue;
                if (!introDone && items.length === 0 && i === 0 && !/^\s*-\s+/.test(parts[i])) {
                    appendPlain(doc, story, "ListIntro", line, pf.list_intro_format ? overridesFrom(pf.list_intro_format) : null);
                    introDone = true;
                    continue;
                }
                items.push(line);
            }
            var itemStyle = (styleName === "ParagraphText") ? "BulletList" : styleName;
            var itemOverrides = pf.list_type ? overridesFrom(pf) : null;
            for (i = 0; i < items.length; i++) {
                var lastStyle = itemStyle;
                if (itemStyle === "BulletList" && i === items.length - 1 && doc.paragraphStyles.itemByName("BulletListLast").isValid) lastStyle = "BulletListLast";
                appendPlain(doc, story, lastStyle, items[i], itemOverrides);
            }
            return;
        }
        var paraRef = appendRich(doc, story, styleName, raw, overridesFrom(pf));
        if (paraRef) applyRule(doc, paraRef, pf);
    }

    function pinFace(doc, styleName, fontName) {
        var styleObj = doc.paragraphStyles.itemByName(styleName);
        if (!styleObj.isValid) styleObj = doc.characterStyles.itemByName(styleName);
        if (!styleObj.isValid) return;
        try {
            var f = app.fonts.itemByName(fontName);
            styleObj.appliedFont = f;
            styleObj.fontStyle = f.fontStyleName;
        } catch (eFont) { note("font pin " + styleName + " " + eFont.message); }
    }

    function pinStaticFonts(doc) {
        var light = "IBM Plex Sans\tLight";
        var bold = "IBM Plex Sans\tBold";
        var regular = "IBM Plex Sans\tRegular";
        var italic = "IBM Plex Sans\tItalic";
        pinFace(doc, "ChapterTitle", light);
        pinFace(doc, "LessonOverview", bold);
        pinFace(doc, "LessonOverviewRule", bold);
        pinFace(doc, "Bold", bold);
        pinFace(doc, "ParagraphText", regular);
        pinFace(doc, "ListIntro", regular);
        pinFace(doc, "BulletList", regular);
        pinFace(doc, "BulletListLast", regular);
        pinFace(doc, "NumberedList", regular);
        pinFace(doc, "NumberedListAlpha", regular);
        pinFace(doc, "CalloutBody", regular);
        pinFace(doc, "CalloutBodyRule", regular);
        pinFace(doc, "Caption", regular);
        pinFace(doc, "PageHeader", regular);
        pinFace(doc, "Footer", regular);
        pinFace(doc, "Link", regular);
        pinFace(doc, "BulletMarker", regular);
        pinFace(doc, "Italic", italic);
        pinFace(doc, "CaptionItalic", italic);
    }

    function severThread(frame) {
        try { frame.nextTextFrame = Nothing; } catch (e) {}
    }

    // One JSON page owns one PDF page. The flow frame is not threaded onward,
    // so text that does not fit stays overset and is left out of the PDF.
    function addUnthreadedBodyPage(doc) {
        var body = doc.masterSpreads.itemByName("B-Body");
        var pg = doc.pages.add(LocationOptions.AT_END);
        var hand, src, i, frame;
        pg.appliedMaster = body;
        hand = (pg.side === PageSideOptions.LEFT_HAND) ? body.pages[0] : body.pages[1];
        src = null;
        for (i = 0; i < hand.textFrames.length; i++) {
            if (hand.textFrames[i].label === "proto:flow") src = hand.textFrames[i];
        }
        if (!src) return null;
        frame = src.override(pg);
        severThread(frame);
        try { frame.parentStory.contents = ""; } catch (eClear) {}
        return frame;
    }

    function noteTrimmedOverflow(story, label) {
        var containers, tail;
        try { if (story && story.recompose) story.recompose(); } catch (e0) {}
        try {
            containers = story.textContainers;
            tail = containers[containers.length - 1];
            if (tail && tail.overflows) note("trimmed overflow on " + label);
        } catch (e1) {}
    }

    try {
        var openDocs;
        for (openDocs = app.documents.length - 1; openDocs >= 0; openDocs--) {
            try { app.documents[openDocs].close(SaveOptions.NO); } catch (eOd) { break; }
        }
        if (!templateFile.exists) throw new Error("Template missing: " + templateFile.fsName);
        if (!jsonFile.exists) throw new Error("JSON missing: " + jsonFile.fsName);
        var data = eval("(" + readText(jsonFile) + ")");
        if (data && data.data && data.data.pages) data = data.data;
        if (data && !data.pages && data.length) data = { pages: data };
        if (!data.pages) throw new Error("JSON has no pages array");

        var doc = app.open(templateFile);
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
        try { doc.textPreferences.smartTextReflow = false; } catch (eReflow) {}
        pinStaticFonts(doc);

        var flow = findFlow(doc);
        if (!flow) throw new Error("proto:flow frame not found on page 1");
        clearStory(doc, flow.parentStory);
        severThread(flow);
        var dropPi;
        for (dropPi = doc.pages.length - 1; dropPi >= 1; dropPi--) {
            try { doc.pages[dropPi].remove(); } catch (eDrop) { note("drop template page " + eDrop.message); }
        }

        var headerText = "";
        var footerText = "";
        var startPage = 1;
        var pageHeaders = [];
        var pageDocIndex = [];
        var headerByNumber = {};
        var pi, node, ci, page, content, headerIndex, heroPlaced, story;
        story = flow.parentStory;
        for (pi = 0; pi < data.pages.length; pi++) {
            page = data.pages[pi];
            if (pi > 0) {
                try {
                    flow = addUnthreadedBodyPage(doc);
                    if (!flow) throw new Error("proto:flow missing on new page");
                    story = flow.parentStory;
                } catch (eBreak) { note("page-break " + eBreak.message); }
            }
            pageDocIndex[pi] = doc.pages.length - 1;
            content = page.content || [];
            heroPlaced = false;
            var callout = null;
            for (ci = 0; ci < content.length; ci++) {
                node = content[ci];
                if (!node || !node.data) continue;
                if (node.type === "LogoWithText") {
                    try { callout = calloutRange(content, ci); } catch (eRange) { callout = null; }
                }
                if (node.type === "PageHeader") {
                    if (node.data.text && pageHeaders[pi] === undefined) {
                        pageHeaders[pi] = String(node.data.text);
                        if (node.data.page) headerByNumber[node.data.page] = String(node.data.text);
                    }
                    if (!headerText && node.data.text) {
                        headerText = String(node.data.text);
                        headerIndex = pi;
                        if (node.data.page) startPage = node.data.page - pi;
                    }
                    continue;
                }
                if (node.type === "Footer") {
                    if (node.data.text) footerText = String(node.data.text);
                    continue;
                }
                try {
                    if (node.type === "Image") {
                        addImage(doc, story, node.data, page.page_type === "opener" && !heroPlaced);
                        heroPlaced = true;
                    } else if (node.type === "Table") addTable(doc, story, node.data);
                    else if (node.type === "LogoWithText") addLogo(doc, story, node.data);
                    else if (node.type === "ParagraphText" && node.data.rich_text && node.data.rich_text.length) {
                        appendMarkdownParagraph(doc, story, node);
                    } else if (node.data.text) {
                        var nodeStyle = styleFor(node);
                        if (nodeStyle === "LessonOverview" && !nextIsType(content, ci, "LessonOverview")) nodeStyle = "LessonOverviewRule";
                        appendBlock(doc, story, nodeStyle, node.data.text, node.data.paragraph_format);
                    }
                } catch (eNode) {
                    note("node " + node.type + " " + eNode.message);
                }
                if (callout && ci === callout.end) {
                    if (ci > 0 && node.type !== "LogoWithText") closeCallout(story, callout.swatch);
                    note("callout end page " + (pi + 1) + " node " + ci + " " + callout.swatch);
                    callout = null;
                }
            }
            severThread(flow);
            noteTrimmedOverflow(story, "json page " + (pi + 1));
        }

        if (headerText) {
            try {
                doc.textVariables.itemByName("proto:runningHeader").variableOptions.contents = headerText;
            } catch (eH) { note("header " + eH.message); }
        }
        if (footerText) {
            var ms, mp, ti, tf;
            for (ms = 0; ms < doc.masterSpreads.length; ms++) {
                for (mp = 0; mp < doc.masterSpreads[ms].pages.length; mp++) {
                    for (ti = 0; ti < doc.masterSpreads[ms].pages[mp].textFrames.length; ti++) {
                        tf = doc.masterSpreads[ms].pages[mp].textFrames[ti];
                        if (tf.label === "proto:footer") tf.parentStory.contents = footerText;
                    }
                }
            }
        }
        try {
            doc.sections[0].continueNumbering = false;
            doc.sections[0].pageNumberStart = startPage > 0 ? startPage : 1;
        } catch (eSec) { note("section " + eSec.message); }

        applyPageHeaders(doc, flow.parentStory, pageHeaders, pageDocIndex, headerText, headerByNumber, startPage);
        var placed = 0;
        var logos = 0;
        var allItems = doc.allPageItems;
        var ai;
        for (ai = 0; ai < allItems.length; ai++) {
            try {
                if (!allItems[ai].parent || allItems[ai].parent.constructor.name !== "Character") continue;
                if (allItems[ai].label === "proto:image" || allItems[ai].label === "proto:heroImage") placed++;
                if (allItems[ai].label === "proto:logo") logos++;
            } catch (eCount) {}
        }
        note("pages " + doc.pages.length);
        note("inline images " + placed + " logos " + logos);
        note("page size " + doc.documentPreferences.pageWidth + " x " + doc.documentPreferences.pageHeight);
        try {
            var storyText = String(flow.parentStory.contents).substring(0, 80).replace(/\r/g, " | ");
            note("story " + storyText);
        } catch (eStory) {}
        var shown = 0;
        for (ai = 0; ai < allItems.length && shown < 4; ai++) {
            try {
                if (allItems[ai].label === "proto:image" && allItems[ai].parent && allItems[ai].parent.constructor.name === "Character") {
                    var ib = allItems[ai].geometricBounds;
                    note("image " + allItems[ai].extractLabel("display_width_pt") + " frame " + (ib[3] - ib[1]) + " x " + (ib[2] - ib[0]) + " scale " + allItems[ai].extractLabel("scale_percent"));
                    shown++;
                }
            } catch (eShow) {}
        }
        doc.save();
        try {
            if (pdfFile.exists) pdfFile.remove();
            app.pdfExportPreferences.pageRange = "";
            doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, app.pdfExportPresets.itemByName("[High Quality Print]"));
            note("pdf " + pdfFile.fsName);
        } catch (ePdf) { note("pdf " + ePdf.message); }
        try {
            if (inddOutFile.exists) inddOutFile.remove();
            doc.saveACopy(inddOutFile);
            note("saved " + inddOutFile.fsName);
        } catch (eIndd) { note("indd " + eIndd.message); }
        note("DONE");
        writeLog();
        doc.close(SaveOptions.YES);
    } catch (err) {
        note("FATAL " + err.message + " line " + err.line);
        writeLog();
    }
    app.scriptPreferences.userInteractionLevel = prev;
})();
