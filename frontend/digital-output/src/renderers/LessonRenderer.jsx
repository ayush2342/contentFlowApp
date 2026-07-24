import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import componentRegistry from '../constants/componentRegistry';
import styles from './LessonRenderer.module.scss';
import {
  generateAllCssVariables,
  resolveTypographyStylesFromPayload,
  DEFAULT_THEME_ID,
} from '../../../../shared/typography-styles.js';
import {
  getComponentColumns,
  getLocalFormatDocument,
  getPageColumns,
} from '../../../../shared/layout-formats.js';
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

/** One JSON page = one sheet. Left fills to this height, then right. */
const PDF_PAGE_CONTENT_HEIGHT_PX = 1240;

const splitBodyAndFooters = (components = []) => {
  const body = [];
  const footers = [];
  (components || []).forEach((component) => {
    if (!component) return;
    if (component.type === 'Footer' || component.contentType === 'Footer') {
      footers.push(component);
    } else {
      body.push(component);
    }
  });
  return { body, footers };
};

/**
 * Split blocks into left/right using measured heights (same width as real column).
 * Footers are excluded from column flow and rendered fixed at the bottom.
 */
const TwoColumnPageSheet = ({
  components = [],
  footers = [],
  pageHeightPx = PDF_PAGE_CONTENT_HEIGHT_PX,
}) => {
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

      {footers.length ? (
        <div className={styles.pageFooter}>
          {footers.map((component, index) => (
            <DynamicComponent key={component.id || `footer-${index}`} component={component} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * On a 1-column page, consecutive blocks with component columns=2 are packed
 * into a 2-column region (e.g. opener.LessonOverview.columns = 2).
 */
const buildLayoutSegments = (components, formatDoc, pageType) => {
  const list = (components || []).filter(Boolean);
  const segments = [];
  let index = 0;

  while (index < list.length) {
    const columns = getComponentColumns(formatDoc, pageType, list[index].contentType);
    if (columns === 2) {
      const group = [];
      while (index < list.length) {
        const nextColumns = getComponentColumns(formatDoc, pageType, list[index].contentType);
        if (nextColumns !== 2) break;
        group.push(list[index]);
        index += 1;
      }
      segments.push({ columns: 2, components: group });
    } else {
      const group = [];
      while (index < list.length) {
        const nextColumns = getComponentColumns(formatDoc, pageType, list[index].contentType);
        if (nextColumns === 2) break;
        group.push(list[index]);
        index += 1;
      }
      segments.push({ columns: 1, components: group });
    }
  }

  return segments;
};

const LessonRenderer = ({
  page,
  layout: layoutOverride,
  templateId: templateIdProp,
  typography: typographyProp,
}) => {
  if (!page) {
    return null;
  }

  const { templateId: routeTemplateId } = getRouteContext();
  const templateId = templateIdProp || routeTemplateId || DEFAULT_THEME_ID;
  const formatDoc =
    layoutOverride || getLocalFormatDocument(templateId);
  const pageType = page.pageType || 'opener';
  const pageColumns = page.pageColumns || getPageColumns(formatDoc, pageType);
  const { body, footers } = splitBodyAndFooters(page.components || []);

  const scopedTypography = resolveTypographyStylesFromPayload(typographyProp, templateId);
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

  // Page-level 2 columns (e.g. format2 non-opener): fill left then right.
  if (pageColumns === 2 || page.layout === 'two-column') {
    return (
      <article className={`${styles.lesson} ${styles.twoColumnLesson}`} style={pageStyleVars}>
        <TwoColumnPageSheet
          components={body}
          footers={footers}
          pageHeightPx={PDF_PAGE_CONTENT_HEIGHT_PX}
        />
      </article>
    );
  }

  // Page-level 1 column: full width, with optional 2-col component runs.
  const segments = buildLayoutSegments(body, formatDoc, pageType);

  return (
    <article className={`${styles.lesson} ${styles.pageSheet}`} style={pageStyleVars}>
      <div className={styles.pageBody}>
        {segments.map((segment, segmentIndex) => {
          if (segment.columns === 2) {
            return (
              <div key={`segment-${segmentIndex}`} className={styles.twoColumnLesson}>
                <TwoColumnPageSheet
                  components={segment.components}
                  pageHeightPx={PDF_PAGE_CONTENT_HEIGHT_PX}
                />
              </div>
            );
          }

          return (
            <div key={`segment-${segmentIndex}`} className={styles.singleColumnSegment}>
              {segment.components.map((component, index) => (
                <DynamicComponent key={component.id || index} component={component} />
              ))}
            </div>
          );
        })}
      </div>

      {footers.length ? (
        <div className={styles.pageFooter}>
          {footers.map((component, index) => (
            <DynamicComponent key={component.id || `footer-${index}`} component={component} />
          ))}
        </div>
      ) : null}
    </article>
  );
};

export default LessonRenderer;
