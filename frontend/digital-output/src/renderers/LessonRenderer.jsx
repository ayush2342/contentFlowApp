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

/**
 * PDF-like page body height for column switching only (not a forced visual box).
 * Letter content area ≈ 648pt → ~864 CSS px; use viewport when smaller.
 */
const DEFAULT_COLUMN_PAGE_HEIGHT_PX = 864;
const RESERVED_CHROME_PX = 180;
const COLUMN_CHARS_PER_LINE = 42;
const LINE_HEIGHT_PX = 22;
const IMAGE_BLOCK_HEIGHT_PX = 240; // image + caption
const HEADING_HEIGHT_PX = 36;
const BLOCK_GAP_PX = 12;

const computeColumnPageHeight = (viewportHeight) => {
  const fromViewport = (Number.isFinite(viewportHeight) ? viewportHeight : 900) - RESERVED_CHROME_PX;
  return Math.max(480, Math.min(DEFAULT_COLUMN_PAGE_HEIGHT_PX, fromViewport));
};

const estimateTextHeight = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / COLUMN_CHARS_PER_LINE)) * LINE_HEIGHT_PX;
};

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
 * Same flow as PDF ensureLayoutSpace:
 * fill column 1, then column 2, then a new sheet. Whole blocks only.
 */
const buildPdfLikeColumnPages = (components = [], pageHeightPx = DEFAULT_COLUMN_PAGE_HEIGHT_PX) => {
  const sheets = [];
  let left = [];
  let right = [];
  let leftHeight = 0;
  let rightHeight = 0;
  let column = 0;

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

    placeInColumn(component, key);
  });

  flushSheet();
  return sheets;
};

const LessonRenderer = ({ page }) => {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 900
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
  const columnPageHeight = computeColumnPageHeight(viewportHeight);
  const pageStyleVars = {
    ...generateAllCssVariables(scopedTypography),
    ...(sectionColor
      ? { '--heading-color': sectionColor, '--primary-color': sectionColor }
      : {}),
    ...(paragraphColor
      ? { '--paragraph-color': paragraphColor, '--body-color': paragraphColor }
      : {}),
  };

  if (page.layout === 'two-column') {
    const sheets = buildPdfLikeColumnPages(page.components || [], columnPageHeight);

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
