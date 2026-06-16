# ContentFlow App

ContentFlow is a React + Vite learning-content viewer that renders course data from JSON into book/chapter/lesson pages.

## Tech Stack

- React
- Vite
- Redux Toolkit
- React Router
- Sass

## Prerequisites

- Node.js 20+ (recommended)
- npm 10+

## Getting Started

```bash
npm install
npm run dev
```

Open the local URL shown in terminal (usually `http://localhost:5173`).

## Available Scripts

- `npm run dev` - start development server
- `npm run build` - create production build
- `npm run preview` - preview production build
- `npm run lint` - run ESLint

## Project Data Source

The app currently uses:

- `src/mock/tree_output.json`

Data loading entry:

- `src/services/courseService.js`

Tree data mapper:

- `src/utils/jsonMapper.js` (`mapTreeOutputJson`)

## Images / Media

Tree JSON image nodes use paths like `assets/img_0001.png`.
For images to render in browser, place files under:

- `public/assets/`

Example:

- `public/assets/img_0001.png`
- `public/assets/img_0002.png`

If backend has not provided media yet, image blocks may appear broken until those files are added.

## High-Level App Flow

`tree_output.json` -> `courseService` -> `jsonMapper` -> Redux store -> routed pages -> lesson renderer/components

## Folder Notes

- `src/mock/` - mock JSON inputs
- `src/services/` - data-loading layer
- `src/utils/` - mapping/transformation logic
- `src/pages/` - route pages
- `src/components/` - reusable content components
- `src/renderers/` - lesson content renderer

## Onboarding Tip

When onboarding a new developer, start by reading:

1. `src/services/courseService.js`
2. `src/utils/jsonMapper.js`
3. `src/renderers/LessonRenderer.jsx`
