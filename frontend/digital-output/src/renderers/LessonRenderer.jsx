import componentRegistry from '../constants/componentRegistry';
import styles from './LessonRenderer.module.scss';
import { generateAllCssVariables, resolveTypographyStyles } from '../../../../shared/typography-styles.js';

const DynamicComponent = ({ component }) => {
  if (component.type === '__unsupported__') {
    return (
      <div className={styles.unsupported} role="note">
        {/* TODO: Add renderer support when requirements for "{component.props.originalType}" are defined */}
        Unsupported content type: {component.props.originalType}
      </div>
    );
  }

  const Component = componentRegistry[component.type];

  if (!Component) {
    return null;
  }

  return <Component {...component.props} />;
};

// Mirror PDF Letter fallback (612×792 pt, 72 pt margins) at 96 CSS px/in.
// 1 pt = 96/72 px → page 816×1056 px; content height 648 pt → 864 px.
const PAGE_WIDTH_PX = 816;
const PAGE_HEIGHT_PX = 1056;
const PAGE_MARGIN_PX = 96;
const PAGE_GUTTER_PX = 24;
const PAGE_CONTENT_HEIGHT_PX = PAGE_HEIGHT_PX - PAGE_MARGIN_PX * 2;
const APPROX_CHARS_PER_LINE = 88;
const APPROX_LINE_HEIGHT_PX = 24;
const PAGE_LINE_BUDGET = Math.max(
  10,
  Math.floor(PAGE_CONTENT_HEIGHT_PX / APPROX_LINE_HEIGHT_PX)
);

const isFullWidthComponent = () => false;

const computeLineBudgetFromPageHeight = (contentHeightPx = PAGE_CONTENT_HEIGHT_PX) => {
  const safeHeight = Number.isFinite(contentHeightPx) ? contentHeightPx : PAGE_CONTENT_HEIGHT_PX;
  return Math.max(10, Math.floor(safeHeight / APPROX_LINE_HEIGHT_PX));
};

const estimateTextLines = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_LINE));
};

const estimateComponentLines = (component) => {
  if (!component) return 0;
  if (component.type === 'Paragraph') return estimateTextLines(component.props?.text);
  if (component.type === 'LearningObjective') {
    const intro = estimateTextLines(component.props?.introText);
    const objectives = Array.isArray(component.props?.objectives) ? component.props.objectives : [];
    const objectiveLines = objectives.reduce((sum, item) => sum + Math.max(1, estimateTextLines(item)), 0);
    return Math.max(2, intro + objectiveLines + 1);
  }
  if (component.type === 'Heading') return 2;
  return 3;
};

const splitTextByLineBudget = (value, leftBudgetLines) => {
  const text = String(value ?? '').trim();
  if (!text) return ['', ''];
  if (leftBudgetLines <= 0) return ['', text];

  const totalLines = estimateTextLines(text);
  if (totalLines <= leftBudgetLines) return [text, ''];

  const sentenceParts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length > 1) {
    let usedLines = 0;
    const leftSentences = [];
    let sentenceIndex = 0;
    while (sentenceIndex < sentenceParts.length) {
      const lineCount = estimateTextLines(sentenceParts[sentenceIndex]);
      if (leftSentences.length > 0 && usedLines + lineCount > leftBudgetLines) break;
      leftSentences.push(sentenceParts[sentenceIndex]);
      usedLines += lineCount;
      sentenceIndex += 1;
    }

    if (leftSentences.length > 0) {
      const rightSentences = sentenceParts.slice(leftSentences.length);
      return [leftSentences.join(' '), rightSentences.join(' ')];
    }
  }

  const words = text.split(/\s+/).filter(Boolean);
  const leftWordCount = Math.max(1, Math.floor((leftBudgetLines / totalLines) * words.length));
  return [words.slice(0, leftWordCount).join(' '), words.slice(leftWordCount).join(' ')];
};

const cloneComponentWithText = (component, text) => ({
  ...component,
  props: {
    ...component.props,
    text,
  },
});

const createSpread = () => ({
  kind: 'spread',
  left: [],
  right: [],
  leftLines: 0,
  rightLines: 0,
});

const buildTwoColumnRows = (components = [], lineBudget = PAGE_LINE_BUDGET) => {
  const rows = [];
  let currentSpread = createSpread();
  let activeSide = 'left';

  const finalizeSpreadIfUsed = () => {
    if (!currentSpread.left.length && !currentSpread.right.length) return;
    rows.push(currentSpread);
    currentSpread = createSpread();
    activeSide = 'left';
  };

  const pushFullWidth = (component, key) => {
    finalizeSpreadIfUsed();
    rows.push({ kind: 'full', key, component });
  };

  const placeIntoSide = (entry, side) => {
    if (side === 'left') {
      currentSpread.left.push(entry);
      currentSpread.leftLines += estimateComponentLines(entry.component);
    } else {
      currentSpread.right.push(entry);
      currentSpread.rightLines += estimateComponentLines(entry.component);
    }
  };

  const ensureCapacity = (neededLines = 1) => {
    if (activeSide === 'left') {
      if (currentSpread.leftLines + neededLines <= lineBudget) return;
      activeSide = 'right';
    }

    if (activeSide === 'right') {
      if (currentSpread.rightLines + neededLines <= lineBudget) return;
      finalizeSpreadIfUsed();
    }
  };

  const placeGeneric = (component, key) => {
    const lines = estimateComponentLines(component);
    ensureCapacity(lines);
    placeIntoSide({ key, component }, activeSide);
  };

  let index = 0;
  while (index < components.length) {
    const component = components[index];
    if (!component) {
      index += 1;
      continue;
    }

    if (isFullWidthComponent(component)) {
      pushFullWidth(component, `${component.id || index}-full`);
      index += 1;
      continue;
    }

    if (component.type === 'LearningObjective') {
      placeGeneric(component, `${component.id || index}-objective`);
      index += 1;
      continue;
    }

    if (component.type === 'Paragraph') {
      let remainingText = String(component.props?.text || '').trim();
      if (!remainingText) {
        index += 1;
        continue;
      }

      while (remainingText) {
        const usedLines = activeSide === 'left' ? currentSpread.leftLines : currentSpread.rightLines;
        let remainingBudget = lineBudget - usedLines;
        if (remainingBudget <= 0) {
          ensureCapacity(1);
          remainingBudget = lineBudget - (activeSide === 'left' ? currentSpread.leftLines : currentSpread.rightLines);
        }

        const [fitText, overflowText] = splitTextByLineBudget(remainingText, Math.max(1, remainingBudget));
        if (!fitText) {
          ensureCapacity(1);
          activeSide = activeSide === 'left' ? 'right' : 'left';
          continue;
        }

        placeIntoSide(
          {
            key: `${component.id || index}-${activeSide}-${Math.abs(remainingText.length - fitText.length)}`,
            component: cloneComponentWithText(component, fitText),
          },
          activeSide
        );
        remainingText = overflowText;

        if (remainingText) {
          if (activeSide === 'left') {
            activeSide = 'right';
          } else {
            finalizeSpreadIfUsed();
            activeSide = 'left';
          }
        }
      }

      index += 1;
      continue;
    }

    placeGeneric(component, `${component.id || index}-generic`);
    index += 1;
  }

  finalizeSpreadIfUsed();
  return rows;
};

const LessonRenderer = ({ page }) => {
  if (!page) {
    return null;
  }

  const scopedTypography = resolveTypographyStyles();
  const sectionColor =
    scopedTypography.sectionTitle?.color ||
    scopedTypography.sectionTitle?.text?.color ||
    undefined;
  const paragraphColor = scopedTypography.paragraphText?.color;
  const pageStyleVars = {
    ...generateAllCssVariables(scopedTypography),
    ...(sectionColor
      ? { '--heading-color': sectionColor, '--primary-color': sectionColor }
      : {}),
    ...(paragraphColor
      ? { '--paragraph-color': paragraphColor, '--body-color': paragraphColor }
      : {}),
    '--page-width': `${PAGE_WIDTH_PX}px`,
    '--page-height': `${PAGE_HEIGHT_PX}px`,
    '--page-margin': `${PAGE_MARGIN_PX}px`,
    '--page-gutter': `${PAGE_GUTTER_PX}px`,
    '--page-content-height': `${PAGE_CONTENT_HEIGHT_PX}px`,
  };

  const twoColumnRows =
    page.layout === 'two-column'
      ? buildTwoColumnRows(page.components || [], computeLineBudgetFromPageHeight())
      : [];

  if (page.layout === 'two-column') {
    return (
      <article className={`${styles.lesson} ${styles.twoColumnLesson}`} style={pageStyleVars}>
        {twoColumnRows.map((row, rowIndex) => (
          <div key={`row-${rowIndex}`} className={styles.pageSheet}>
            {row.kind === 'full' ? (
              <div className={styles.fullWidthRow}>
                <DynamicComponent component={row.component} />
              </div>
            ) : (
              <div className={`${styles.columns} ${row.right.length ? '' : styles.singleColumnSpread}`}>
                <div className={styles.column}>
                  {row.left.map((item) => (
                    <DynamicComponent key={item.key} component={item.component} />
                  ))}
                </div>
                {row.right.length ? (
                  <div className={styles.column}>
                    {row.right.map((item) => (
                      <DynamicComponent key={item.key} component={item.component} />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
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
