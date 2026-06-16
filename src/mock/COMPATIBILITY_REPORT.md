# output.json Compatibility Report

Generated after integrating Transformation Team `output.json` into ContentFlow.

## Source of Truth

- **File:** `src/mock/output.json`
- **Status:** Unmodified — all keys and fields preserved exactly as received.

## JSON Structure vs. Previous Mock Model

| output.json field | Previous mock field | Adapter handling |
|---|---|---|
| `bookId` | `books[].id` | Mapped to `books[0].id` via `jsonMapper.js` |
| `media` | _(none)_ | Preserved on course model; used to resolve `image` blocks |
| `chapters[].chapterNumber` | `chapters[].id` | Mapped to `chapter-{number}` id; surfaced on Chapter page |
| `chapters[].introduction` | `chapters[].description` | Mapped to chapter `description` |
| `chapters[].outline` | _(none)_ | Preserved; rendered as Chapter Outline list |
| `chapters[].sections` | `chapters[].lessons` | Each section mapped to a lesson |
| `sections[].sectionNumber` | `lessons[].id` | Mapped to `section-{number}` id; shown in navigation |
| `sections[].learningObjectives` | component block | Injected as `LearningObjective` before section content |
| `sections[].content` | `pages[].components` | Mapped to renderer-ready component blocks |

## Content Types in output.json

| JSON `type` | React component | Status |
|---|---|---|
| `heading` | `Heading` | Supported via mapper |
| `paragraph` | `Paragraph` | Supported via mapper |
| `image` | `ImageBlock` | Supported via mapper (`mediaId` → `media` catalog) |

## New Fields Found

| Field | Rendered in UI |
|---|---|
| `bookId` | Book route id (`/book/biology-101`) |
| `media` | Resolved into `ImageBlock` src/caption/alt |
| `chapterNumber` | Chapter page metadata |
| `outline` | Chapter page outline list |
| `introduction` | Chapter page intro paragraph |
| `sectionNumber` | Section navigation label + lesson heading |
| `learningObjectives` | `LearningObjective` component at top of section |
| `mediaId` | Resolved through `media` lookup |
| `fileName` | Image src (`/media/{fileName}`) |
| `caption` | Image caption and alt text |

## Missing React Support

| Item | Notes |
|---|---|
| Image asset files | JSON references `fig-1-1.jpg` and `fig-1-2.jpg`. Place files in `public/media/` for images to display. Paths are wired; assets were not included in the delivery package. |
| `outline` second item | "The Process of Science" is listed in outline but has no matching `section` in this payload yet. Rendered in outline only — no section page until backend adds it. |

## New Component Types Found

None. All three content types (`heading`, `paragraph`, `image`) map to existing components.

## Registry Components Not Used by output.json

`SubHeading`, `ReadingStrategy`, `Callout`, `Quote`, `TableBlock`, `Activity`, `Assessment` remain registered for future payloads.

## Renderer Updates Performed

1. **`src/utils/jsonMapper.js`** — transforms `output.json` into internal book/chapter/lesson/page/component model.
2. **`src/services/courseService.js`** — loads only `output.json` through the mapper.
3. **`src/renderers/LessonRenderer.jsx`** — added unsupported-type fallback with TODO comment for future types.
4. **`src/pages/ChapterPage.jsx`** — surfaces `chapterNumber`, `introduction`, and `outline`.
5. **`src/pages/HomePage.jsx`** — removed multi-course selector; single book from `output.json`.

## Removed Dependencies

- `src/mock/biologyCourse.json`
- `src/mock/mathCourse.json`
- `src/mock/historyCourse.json`
- `src/constants/courses.js`

## Data Flow (unchanged architecture)

```
output.json
  → courseService.js (via jsonMapper.js)
  → Redux
  → LessonRenderer
  → componentRegistry
  → React Components
```

## Navigation Routes for Current Payload

| Page | Route |
|---|---|
| Home | `/` |
| Book | `/book/biology-101` |
| Chapter | `/chapter/chapter-1` |
| Section (lesson) | `/lesson/section-1-1` |
