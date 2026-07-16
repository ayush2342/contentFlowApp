import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import componentRegistry from '../constants/componentRegistry';
import styles from './LessonRenderer.module.scss';
import { generateAllCssVariables, resolveTypographyStyles, DEFAULT_THEME_ID } from '../../../../shared/typography-styles.js';
import { getRouteContext } from '../services/courseService';

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
 * One JSON page = one sheet.
 * Left fills to this height, then remaining blocks go to right (no extra sheets).
 * Kept tall so left takes as much of the page content as possible before switching.
 */
const PDF_PAGE_CONTENT_HEIGHT_PX = 1240;

/**
 * Split one JSON page into left/right using measured block heights
 * (same width as the real column). No guessed text heights.
 */
const TwoColumnPageSheet = ({ components = [], pageHeightPx = PDF_PAGE_CONTENT_HEIGHT_PX }) => {
  const measureRef = useRef(null);
  const [splitIndex, setSplitIndex] = useState(null);

  const blocks = useMemo(
    () =>
      (components || [])
        .filter(Boolean)
        .map((component, index) => ({
          key: component.id || `block-${index}`,
          component,
        })),
    [components]
  );

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return undefined;

    const measureSplit = () => {
      const children = Array.from(root.children);
      if (!children.length) {
        setSplitIndex(0);
        return;
      }

      const gapPx = (() => {
        const gap = getComputedStyle(root).gap || getComputedStyle(root).rowGap || '0';
        const parsed = Number.parseFloat(gap);
        return Number.isFinite(parsed) ? parsed : 0;
      })();

      let used = 0;
      let nextSplit = children.length;

      for (let i = 0; i < children.length; i += 1) {
        const height = children[i].getBoundingClientRect().height;
        const extraGap = i > 0 ? gapPx : 0;
        if (used > 0 && used + extraGap + height > pageHeightPx) {
          nextSplit = i;
          break;
        }
        used += extraGap + height;
      }

      setSplitIndex(nextSplit);
    };

    measureSplit();

    const images = root.querySelectorAll('img');
    const onAssetChange = () => measureSplit();
    images.forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', onAssetChange);
        img.addEventListener('error', onAssetChange);
      }
    });

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureSplit) : null;
    resizeObserver?.observe(root);

    return () => {
      images.forEach((img) => {
        img.removeEventListener('load', onAssetChange);
        img.removeEventListener('error', onAssetChange);
      });
      resizeObserver?.disconnect();
    };
  }, [blocks, pageHeightPx]);

  const resolvedSplit = splitIndex == null ? blocks.length : splitIndex;
  const left = blocks.slice(0, resolvedSplit);
  const right = blocks.slice(resolvedSplit);

  return (
    <div className={styles.pageSheet}>
      <div ref={measureRef} className={styles.measureColumn} aria-hidden="true">
        {blocks.map((item) => (
          <div key={`measure-${item.key}`} className={styles.measureBlock}>
            <DynamicComponent component={item.component} />
          </div>
        ))}
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          {left.map((item) => (
            <DynamicComponent key={item.key} component={item.component} />
          ))}
        </div>
        <div className={styles.column}>
          {right.map((item) => (
            <DynamicComponent key={item.key} component={item.component} />
          ))}
        </div>
      </div>
    </div>
  );
};

const LessonRenderer = ({ page }) => {
  if (!page) {
    return null;
  }

  const { templateId } = getRouteContext();
  const scopedTypography = resolveTypographyStyles(templateId || DEFAULT_THEME_ID);
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
    '--pdf-page-height': `${PDF_PAGE_CONTENT_HEIGHT_PX}px`,
  };

  if (page.layout === 'two-column') {
    return (
      <article className={`${styles.lesson} ${styles.twoColumnLesson}`} style={pageStyleVars}>
        <TwoColumnPageSheet
          components={page.components || []}
          pageHeightPx={PDF_PAGE_CONTENT_HEIGHT_PX}
        />
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
