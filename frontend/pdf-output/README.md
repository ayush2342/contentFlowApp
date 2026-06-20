# Adobe InDesign Automation Demo

Backend JSON (`4_Pages_word_template_class.json` format) → InDesign → PDF.

## Pipeline

```
tree_output.json  (backend — read only)
        ↓
populate-indesign.jsx  (v9)
        ↓
dedicated labeled frames (lessonNumber1, text1…, imageFrame1…)
        ↓
output.pdf
```

## New JSON block types

| `type` | `data` | Style | InDesign target |
|--------|--------|-------|-----------------|
| `LessonNumber` | `text` | 14pt blue | `lessonNumber1` |
| `Image` | `url`, `caption` | image + 10pt italic caption | `imageFrame1`…`imageFrame5` + captions |
| `ChapterOverview` | `text` | 11pt blue | `chapterOverview1`…`chapterOverview10` |
| `Topic` | `text` | 11pt bold | `topic1`…`topic3` |
| `Text` | `text` | 12pt body | `text1`…`text14` |
| `SectionTitle` | `text` | 18pt blue | `sectionTitle1` |

See **[INDESIGN_TEMPLATE_MAPPING.md](INDESIGN_TEMPLATE_MAPPING.md)** for the full template mapping document.

`tree_output.json` is now synced from backend API using `npm run sync`.

## InDesign template setup

Create **one labeled frame per JSON block** in visual order. The script maps each occurrence to `{prefix}{index}` (e.g. `text3` for the third `Text` block).

| Prefix | Sample count | Frame type |
|--------|--------------|------------|
| `lessonNumber` | 1 | Text Frame |
| `chapterOverview` | 10 | Text Frame |
| `topic` | 3 | Text Frame |
| `text` | 14 | Text Frame |
| `sectionTitle` | 1 | Text Frame |
| `imageFrame` / `imageCaption` | 5 each | Image + Text Frame |

Full label list, styles, and examples: **[INDESIGN_TEMPLATE_MAPPING.md](INDESIGN_TEMPLATE_MAPPING.md)**.

### 3. Files in Scripts folder

```
populate-indesign.jsx
tree_output.json
assets/
  img_0001.png … img_0005.png
```

To sync from API:

```bash
API_BASE_URL=http://localhost:4000 TENANT_ID=<tenant-id> DOCUMENT_ID=<doc-id> npm run sync
```

This downloads latest JSON and image assets through backend API before running InDesign script.

## Image URL resolution (no JSON changes)

Backend sends paths like `assets/img_0001.png`. The script also tries:

1. Path as-is
2. `assets/` + filename
3. Fallback by image order: `img_0001.png`, `img_0002.png`, …

## Run

1. Open `.indd` template with all dedicated frames labeled
2. Run `populate-indesign.jsx` from the Scripts panel
3. PDF saved as `output.pdf` next to `tree_output.json`

## Node.js sync / preview

```bash
npm run sync
```

Writes the latest backend JSON to `tree_output.json` and downloads image files into `assets/`.
