import { useEffect, useState } from 'react';
import componentRegistry from '../constants/componentRegistry';
import styles from './LessonRenderer.module.scss';
import { generateAllCssVariables, resolveTypographyStyles } from '../../../../shared/typography-styles.js';

const DynamicComponent = ({ component }) => {
  if (component.type === '__unsupported__') {
    return (
      <div className={styles.unsupported} role="note">
        Unsupported content type: {component.props.originalType}
      </div>
    );
  }

  const Component = componentRegistry[component.type];
  if (!Component) return null;
  return <Component {...component.props} />;
};

/** Usable page height ~ PDF page body (viewport minus chrome). */
const DEFAULT_PAGE_HEIGHT_PX = 720;
const RESERVED_VERTICAL_SPACE = 180;
const COLUMN_CHARS_PER_LINE = 42;
const LINE_HEIGHT_PX = 22;
const IMAGE_BLOCK_HEIGHT_PX = 220;
const HEADING_HEIGHT_PX = 36;
const BLOCK_GAP_PX = 12;

const computePageHeightFromViewport = (viewportHeight) => {
  const safeHeight = Number.isFinite(viewportHeight) ? viewportHeight : DEFAULT_PAGE_HEIGHT_PX + RESERVED_VERTICAL_SPACE;
  return Math.max(420, safeHeight - RESERVED_VERTICAL_SPACE);
};

const estimateTextHeight = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const lines = Math.max(1, Math.ceil(text.length / COLUMN_CHARS_PER_LINE));
  return lines * LINE_HEIGHT_PX;
};

/** Whole-block height estimate (no mid-paragraph splitting — same idea as PDF frames). */
const estimateBlockHeight = (component) => {
  if (!component) return 0;
  if (component.type === 'Paragraph') {
    return estimateTextHeight(component.props?.text) + BLOCK_GAP_PX;
  }
  if (component.type === 'LearningObjective') {
    const intro = estimateTextHeight(component.props?.introText);
    const objectives = Array.isArray(component.props?.objectives) ? component.props.objectives : [];
    const objectiveHeight = objectives.reduce(
      (sum, item) => sum + Math.max(LINE_HEIGHT_PX, estimateTextHeight(item)),
      0
    );
    return Math.max(HEADING_HEIGHT_PX, intro + objectiveHeight + HEADING_HEIGHT_PX) + BLOCK_GAP_PX;
  }
  if (component.type === 'Heading') return HEADING_HEIGHT_PX + BLOCK_GAP_PX;
  if (component.type === 'ImageBlock' || component.type === 'IconLabel') {
    return IMAGE_BLOCK_HEIGHT_PX + BLOCK_GAP_PX;
  }
  return HEADING_HEIGHT_PX + BLOCK_GAP_PX;
};

/**
 * PDF-like layout for one JSON page:
 * fill column 1 top→bottom, then column 2, then a new visual page sheet.
 * Blocks stay whole (no height-budget text splitting).
 */
const buildPdfLikeColumnPages = (components = [], pageHeightPx = DEFAULT_PAGE_HEIGHT_PX) => {
  const sheets = [];
  let left = [];
  let right = [];
  let leftHeight = 0;
  let rightHeight = 0;
  let column = 0; // 0 = left, 1 = right

  const flushSheet = () => {
    if (!left.length && !right.length) return;
    sheets.push({ left, right });
    left = [];
    right = [];
    leftHeight = 0;
    rightHeight = 0;
    column = 0;
  };

  const placeInColumn = (component, key) => {
    const entry = { key, component };
    if (column === 0) {
      left.push(entry);
      leftHeight += estimateBlockHeight(component);
    } else {
      right.push(entry);
      rightHeight += estimateBlockHeight(component);
    }
  };

  components.forEach((component, index) => {
    if (!component) return;
    const height = estimateBlockHeight(component);
    const key = component.id || `block-${index}`;

    // Mirror PDF ensureLayoutSpace: try current column, else other column, else new page.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const used = column === 0 ? leftHeight : rightHeight;
      const fits = used + height <= pageHeightPx || used === 0;
      if (fits) {
        placeInColumn(component, key);
        return;
      }
      if (column === 0) {
        column = 1;
        continue;
      }
      flushSheet();
    }

    // Oversized block after flush — still place on a fresh sheet left column.
    placeInColumn(component, key);
  });

  flushSheet();
  return sheets;
};

const LessonRenderer = ({ page }) => {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : DEFAULT_PAGE_HEIGHT_PX + RESERVED_VERTICAL_SPACE
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!page) {
    return null;
  }

  const scopedTypography = resolveTypographyStyles();
  const sectionColor =
    scopedTypography.sectionTitle?.color ||
    scopedTypography.sectionTitle?.text?.color ||
    undefined;
  const paragraphColor = scopedTypography.paragraphText?.color;
  const pageHeightPx = computePageHeightFromViewport(viewportHeight);
  const pageStyleVars = {
    ...generateAllCssVariables(scopedTypography),
    '--page-column-height': `${pageHeightPx}px`,
    ...(sectionColor
      ? { '--heading-color': sectionColor, '--primary-color': sectionColor }
      : {}),
    ...(paragraphColor
      ? { '--paragraph-color': paragraphColor, '--body-color': paragraphColor }
      : {}),
  };

  // non-opener → two-column (same rule as PDF). opener → single column.
  if (page.layout === 'two-column') {
    const sheets = buildPdfLikeColumnPages(page.components || [], pageHeightPx);

    return (
      <article className={`${styles.lesson} ${styles.twoColumnLesson}`} style={pageStyleVars}>
        {sheets.map((sheet, sheetIndex) => (
          <div key={`sheet-${sheetIndex}`} className={styles.pageSheet}>
            <div className={styles.columns}>
              <div className={styles.column}>
                {sheet.left.map((item) => (
                  <DynamicComponent key={item.key} component={item.component} />
                ))}
              </div>
              <div className={styles.column}>
                {sheet.right.map((item) => (
                  <DynamicComponent key={item.key} component={item.component} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </article>
    );
  }

  return (
    <article className={styles.lesson} style={pageStyleVars}>
      {page.components?.map((component, index) => (
        <DynamicComponent key={component.id || index} component={component} />
      ))}
    </article>
  );
};

export default LessonRenderer;
