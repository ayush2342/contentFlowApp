# InDesign Template Mapping Document

**Project:** PDF Output Demo  
**Source data:** `tree_output2.json` (backend — read only)  
**Automation script:** `populate-indesign.jsx`  
**Document version:** 1.0 — dedicated-frame layout

---

## Overview

The backend delivers an ordered JSON array of content blocks. Each block has a `type` and a `data` object. The InDesign template must expose **one labeled frame per block occurrence**, in the same order as the JSON array.

The populate script walks the array top to bottom, increments a per-type counter for each block, and writes into the matching Script Label (e.g. `text3` for the third `Text` block).

> **Important:** Frame positions and threading are defined in the InDesign template. The script only fills content and applies inline formatting; it does not create or move frames.

---

## Content Block Types

Analysis of the sample `tree_output.json` identifies **six** block types:

| Block type | Occurrences (sample) | Frame kind |
|------------|---------------------|------------|
| `LessonNumber` | 1 | Text Frame |
| `Image` | 5 | Image Frame + Text Frame (caption) |
| `ChapterOverview` | 10 | Text Frame |
| `Topic` | 3 | Text Frame |
| `Text` | 14 | Text Frame |
| `SectionTitle` | 1 | Text Frame |

**Total labeled frames required (sample):** 39 (29 text + 5 image + 5 caption)

---

## Frame Mapping Reference

### 1. LessonNumber

| Property | Value |
|----------|-------|
| **Script Label** | `lessonNumber1` (fallback: `lessonNumber`) |
| **Frame type** | Text Frame |
| **Recommended style** | Paragraph: *Lesson Number* — 14 pt, RGB 46/116/181, regular weight, left-aligned |
| **JSON field** | `data.text` |
| **Example content** | `CHAPTER 1` |

---

### 2. Image

| Property | Value |
|----------|-------|
| **Script Label (image)** | `imageFrame1` … `imageFrame5` (fallback for 1st: `imageFrame`) |
| **Script Label (caption)** | `imageCaption1` … `imageCaption5` (fallback for 1st: `imageCaption`) |
| **Frame type** | Rectangle / graphic frame (image) + Text Frame (caption) |
| **Recommended style** | Image: fit proportionally inside frame. Caption: *Figure Caption* — 10 pt, italic, RGB 64/64/64 |
| **JSON fields** | `data.url`, `data.caption` |
| **Example content** | Image: `assets/img_0001.png` — Caption: `FIGURE 1.1 This NASA image is a composite of several satellite-based views of Earth…` |

---

### 3. ChapterOverview

| Property | Value |
|----------|-------|
| **Script Label** | `chapterOverview1` … `chapterOverview10` (sample count) |
| **Frame type** | Text Frame |
| **Recommended style** | Paragraph: *Chapter Overview* — 11 pt, RGB 46/116/181, regular weight |
| **JSON field** | `data.text` |
| **Example content** | `CHAPTER OUTLINE` |
| **Other examples in sample** | `LEARNING OBJECTIVES`, `Properties of Life`, `Order`, `Reproduction` |

Used for chapter-level headings, learning-objective labels, and subsection titles within the chapter body.

---

### 4. Topic

| Property | Value |
|----------|-------|
| **Script Label** | `topic1` … `topic3` (sample count) |
| **Frame type** | Text Frame |
| **Recommended style** | Paragraph: *Topic* — 11 pt, bold, RGB 31/31/31 |
| **JSON field** | `data.text` |
| **Example content** | `1.1 Themes and Concepts of Biology` |
| **Other examples in sample** | `1.2 The Process of Science`, `LINK TO LEARNING` |

---

### 5. Text

| Property | Value |
|----------|-------|
| **Script Label** | `text1` … `text14` (sample count) |
| **Frame type** | Text Frame |
| **Recommended style** | Paragraph: *Body Text* — 12 pt, RGB 31/31/31, regular weight, justified or left-aligned per design |
| **JSON field** | `data.text` |
| **Example content** | `Introduction Viewed from space, Earth (Figure 1.1) offers few clues about the diversity of life forms that reside there…` |

---

### 6. SectionTitle

| Property | Value |
|----------|-------|
| **Script Label** | `sectionTitle1` (fallback: `sectionTitle`) |
| **Frame type** | Text Frame |
| **Recommended style** | Paragraph: *Section Title* — 18 pt, RGB 46/116/181, regular weight |
| **JSON field** | `data.text` |
| **Example content** | `1.1 Themes and Concepts of Biology` |

---

## Script Label Naming Convention

```
{typePrefix}{occurrenceIndex}
```

| JSON `type` | Label prefix | Sample labels |
|-------------|--------------|---------------|
| `LessonNumber` | `lessonNumber` | `lessonNumber1` |
| `ChapterOverview` | `chapterOverview` | `chapterOverview1` … `chapterOverview10` |
| `Topic` | `topic` | `topic1` … `topic3` |
| `Text` | `text` | `text1` … `text14` |
| `SectionTitle` | `sectionTitle` | `sectionTitle1` |
| `Image` (graphic) | `imageFrame` | `imageFrame1` … `imageFrame5` |
| `Image` (caption) | `imageCaption` | `imageCaption1` … `imageCaption5` |

**Single-block fallback:** For `LessonNumber`, `SectionTitle`, and the first `Image`, an unnumbered label (`lessonNumber`, `sectionTitle`, `imageFrame`, `imageCaption`) is accepted if the numbered label is missing.

---

## Template Setup Checklist

1. **Create frames** on the master page or document pages in visual reading order matching the Word/reference layout.
2. **Assign Script Labels** via *Window → Utilities → Scripts* panel label field, or *Object → Script Label*.
3. **Do not thread** text frames across block types unless your design intentionally combines stories; the script writes to each label independently.
4. **Size image frames** to the intended figure area; the script places the file and fits proportionally.
5. **Place assets** in `assets/` next to the script (`img_0001.png`, `img_0002.png`, …).
6. **Verify label count** — if the backend sends more blocks than frames, the script logs a warning and skips missing labels.

---

## Recommended InDesign Paragraph Styles

Create these paragraph styles in the template for manual refinement after population (the script applies equivalent character formatting inline):

| Style name | Used for | Key attributes |
|------------|----------|----------------|
| Lesson Number | `LessonNumber` | 14 pt, blue |
| Chapter Overview | `ChapterOverview` | 11 pt, blue |
| Topic | `Topic` | 11 pt, bold |
| Body Text | `Text` | 12 pt, black |
| Section Title | `SectionTitle` | 18 pt, blue |
| Figure Caption | `Image` captions | 10 pt, italic, dark gray |

---

## Sample JSON → Frame Sequence

First ten blocks in `tree_output.json`:

| # | JSON type | Script Label |
|---|-----------|--------------|
| 1 | LessonNumber | `lessonNumber1` |
| 2 | Image | `imageFrame1`, `imageCaption1` |
| 3 | ChapterOverview | `chapterOverview1` |
| 4 | Topic | `topic1` |
| 5 | Topic | `topic2` |
| 6 | Text | `text1` |
| 7 | SectionTitle | `sectionTitle1` |
| 8 | ChapterOverview | `chapterOverview2` |
| 9 | Text | `text2` |
| 10 | Text | `text3` |

---

## Files and Execution

```
populate-indesign.jsx
tree_output.json
assets/
  img_0001.png … img_0005.png
```

1. Open the `.indd` template with all labeled frames.
2. Run `populate-indesign.jsx` from the Scripts panel.
3. PDF exports to `output.pdf` beside `tree_output.json` (or Desktop/Documents if that folder is not writable).

---

## Maintenance

When the backend JSON grows (more text blocks or figures), add corresponding numbered frames to the InDesign template. Preview block order locally with:

```bash
npm run generate
```

This writes all blocks in JSON order to `output.txt`.
