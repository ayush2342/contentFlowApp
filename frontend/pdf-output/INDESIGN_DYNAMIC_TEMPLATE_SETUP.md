# InDesign Dynamic Template Setup (Option B)

Use this guide when `USE_DYNAMIC_LAYOUT = true` in `populate-indesign.jsx`.

The script **creates as many frames as JSON needs** by duplicating prototype frames labeled `proto:*`. You no longer need `lessonTitle1`, `lessonTitle2`, `text1`…`text50`, etc.

---

## How it works

```
JSON (any count)  →  duplicate proto:* frame  →  place on page  →  flow downward  →  new pages as needed
```

| JSON type | Prototype Script Label | Frame type |
|-----------|------------------------|------------|
| `LessonNumber` | `proto:lessonNumber` | Text frame |
| `LessonTitle` | `proto:lessonTitle` | Text frame |
| `ChapterOverview` | `proto:chapterOverview` | Text frame |
| `Topic` | `proto:topic` | Text frame |
| `SectionTitle` | `proto:sectionTitle` | Text frame |
| `Text` | `proto:text` | Text frame |
| `Image` (graphic) | `proto:imageFrame` | Rectangle / graphic frame |
| `Image` (caption) | `proto:imageCaption` | Text frame |

**You need exactly one prototype per row above** — not numbered copies.

---

## Step-by-step: create the template

### 1. Open or create the document

1. Open Adobe InDesign.
2. Open `frontend/pdf-output/templates/projectX.indd`, **or** create a new document:
   - **File → New → Document**
   - Suggested: Letter or A4, **1 page** to start
   - Set margins (e.g. 18 mm / 0.5 in on all sides) — these define the text column width

### 2. Layers (important — prevents blank PDF)

1. **Window → Layers**
2. Ensure there is a layer named **`Content`** that is **visible** (eye icon on) and **printable**
3. The script creates all output frames on the **Content** layer automatically
4. If you use a **Prototypes** layer for `proto:*` frames, that layer may be hidden — that is OK. Do **not** rely on duplicate; the script no longer copies prototype layers into the PDF.

**Blank PDF cause:** If dynamic frames were duplicated from prototypes on a hidden/non-printing layer, they would not appear in the exported PDF. The script now avoids this by creating new frames on **Content**.

### 3. Create text prototypes

For each text type below, draw **one** text frame on page 1:

1. Select the **Type Tool** (T)
2. Drag a frame in the margin area (width ≈ full column, height ≈ one line for small types, taller for `proto:text`)
3. With the frame selected, set its **Script Label** (see step 5)
4. Optionally apply a paragraph style for your own preview — the script still applies inline formatting from `FRAME_STYLES`

| Script Label | Suggested initial size (width × height) | Notes |
|--------------|----------------------------------------|-------|
| `proto:lessonNumber` | Full column × ~20 pt | Small label line |
| `proto:lessonTitle` | Full column × ~36 pt | Main title |
| `proto:chapterOverview` | Full column × ~18 pt | |
| `proto:topic` | Full column × ~18 pt | |
| `proto:sectionTitle` | Full column × ~28 pt | |
| `proto:text` | Full column × ~120 pt | Body; height is a hint only — script shrinks/grows to fit |

Leave placeholder text empty or use sample text for design preview.

### 4. Create image prototypes

**Image frame**

1. Select the **Rectangle Frame Tool** (F)
2. Draw a frame (e.g. full column × ~180 pt)
3. Script Label: `proto:imageFrame`

**Caption frame**

1. Select the **Type Tool**
2. Draw a narrow text frame below where captions should go
3. Script Label: `proto:imageCaption`

### 5. Assign Script Labels (critical)

Script Labels are case-sensitive and must match exactly.

**Method A — Scripts panel**

1. **Window → Utilities → Scripts**
2. Select a frame on the page
3. In the Scripts panel label field, type e.g. `proto:lessonTitle`
4. Press Enter

**Method B — Script Label menu**

1. Select the frame
2. **Object → Script Label…**
3. Enter `proto:lessonTitle`
4. OK

Repeat for all eight labels in the table above.

### 6. Remove old numbered frames (if migrating)

If your template still has `lessonNumber1`, `text1`…`text14`, `imageFrame1`, etc.:

- You can **delete them manually**, **or**
- Leave them — the script removes all **non-`proto:`** items from page 1 on each run

Delete extra content pages you no longer need; the script starts from page 1 and adds pages automatically.

### 7. Save the template

Save as:

```
frontend/pdf-output/templates/projectX.indd
```

---

## Step-by-step: run a test

1. Ensure `tree_output.json` and `assets/` images are in `frontend/pdf-output/`
2. Confirm `USE_DYNAMIC_LAYOUT = true` at the top of `populate-indesign.jsx`
3. Run the script (ExtendScript Toolkit, VS Code launch config, or backend PDF API)
4. Open `render.log`:
   - `Layout mode: dynamic (proto:*)`
   - Each block should show `Prototype found: yes` and `Status: populated (dynamic frame created)`
5. Open `output.pdf` — every JSON block should appear, regardless of count

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Warning: `Missing prototype frame "proto:…"` | Label missing or typo | Re-check Script Label spelling |
| Image not placed | Wrong frame type | Use **Rectangle Frame**, not text frame, for `proto:imageFrame` |
| Text overlaps | Margins too small / large blocks | Adjust **Document Setup → Margins** |
| Blank PDF | Frames on hidden/non-printing layer | Script now uses **Content** layer; ensure Content layer is visible and printable |
| Most blocks skipped | Missing `proto:*` labels | Add all labels below; text types can fall back to `proto:text` |
| Want old fixed layout back | — | Set `USE_DYNAMIC_LAYOUT = false` and use numbered labels again |

---

## Switching back to fixed-slot mode

In `populate-indesign.jsx`:

```javascript
var USE_DYNAMIC_LAYOUT = false;
```

Then use numbered Script Labels (`lessonTitle1`, `text1`, …) as described in [INDESIGN_TEMPLATE_MAPPING.md](INDESIGN_TEMPLATE_MAPPING.md).

---

## Tuning spacing (optional)

In `populate-indesign.jsx`:

| Setting | Location | Effect |
|---------|----------|--------|
| `DYNAMIC_LAYOUT.blockGap` | Global | Default gap between blocks (pt) |
| `registryEntry.spacingAfter` | `BLOCK_REGISTRY` | Per-type gap after each block |
| `DYNAMIC_LAYOUT.imageCaptionGap` | Global | Gap between image and caption |
| Page margins | InDesign Document Setup | Column width and top/bottom limits |

---

## Verify you are running the latest script

After each run, `render.log` must include these lines near the top:

```
Script version: dynamic-v5
Prototypes in template: proto:lessonNumber, proto:lessonTitle, ...
Content layer: Content
```

If you do **not** see `Script version: dynamic-v5`, you are running an **old** `populate-indesign.jsx`. Copy the latest file from the repo to your machine and run again.

---

## Checklist before first PDF

- [ ] All 8 `proto:*` labels exist on page 1
- [ ] `proto:imageFrame` is a **graphic** frame (Rectangle Frame Tool)
- [ ] All other prototypes are **text** frames
- [ ] Template saved to `templates/projectX.indd`
- [ ] `USE_DYNAMIC_LAYOUT = true`
- [ ] `tree_output.json` present next to the script
