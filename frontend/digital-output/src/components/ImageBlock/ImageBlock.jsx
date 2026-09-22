import { looksLikeInlineHtml, renderInlineHtml, stripInlineHtml } from '../../utils/inlineHtml.jsx';
import styles from './ImageBlock.module.scss';

const captionParts = (caption) => {
  const text = String(caption ?? '').trim();
  // PDF captions use FIGURE or EXHIBIT prefixes
  const match = text.match(/^((?:FIGURE|EXHIBIT)\s+\d+(?:\.\d+)?)([\s\S]*)$/i);
  if (!match) return null;
  return {
    prefix: match[1],
    rest: match[2] || '',
  };
};

const resolveScalePercent = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace(/%/g, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return Math.min(100, Math.max(5, percent));
};

const ImageBlock = ({ src, alt, caption, partNumberOverlay, scalePercent, fullBleed }) => {
  // The figure prefix is styled from the theme, so match against tag-free text.
  const rawCaption = String(caption ?? '').trim();
  const captionText = stripInlineHtml(rawCaption).trim();
  const captionIsHtml = looksLikeInlineHtml(rawCaption);
  const parsedCaption = captionIsHtml ? null : captionParts(captionText);
  const overlayText = String(partNumberOverlay ?? '').trim();
  const scale = resolveScalePercent(scalePercent);
  const figureClass = [
    styles.imageBlock,
    overlayText ? styles.imageBlockFlush : '',
    fullBleed ? styles.imageBlockBleed : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <figure className={figureClass}>
      <div
        className={`${styles.imageFrame}${fullBleed ? ` ${styles.imageFrameInset}` : ''}`}
        style={scale ? { width: `${scale}%`, marginInline: 'auto' } : undefined}
      >
        <img src={src} alt={stripInlineHtml(alt)} className={styles.image} />
        {overlayText ? (
          <div className={styles.partNumberOverlay} aria-label={stripInlineHtml(overlayText)}>
            {renderInlineHtml(overlayText, { ignoreColors: true })}
          </div>
        ) : null}
      </div>
      {captionText ? (
        <figcaption
          className={`${styles.caption}${fullBleed ? ` ${styles.captionBand}` : ''}`}
        >
          {captionIsHtml ? (
            renderInlineHtml(rawCaption)
          ) : parsedCaption ? (
            <>
              <span className={styles.figurePrefix}>{parsedCaption.prefix}</span>
              {parsedCaption.rest}
            </>
          ) : (
            captionText
          )}
        </figcaption>
      ) : null}
    </figure>
  );
};

export default ImageBlock;
