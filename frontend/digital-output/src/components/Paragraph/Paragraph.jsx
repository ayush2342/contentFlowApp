import { getTypographyBorderStyle } from '../../../../../shared/typography-styles.js';
import { renderInlineHtml } from '../../utils/inlineHtml';
import styles from './Paragraph.module.scss';

const splitIntroductionPrefix = (text) => {
  const value = String(text ?? '');
  const match = value.match(/^\s*(INTRODUCTION)\s+(.+)$/i);
  if (!match) return null;
  return {
    label: match[1].toUpperCase(),
    rest: match[2],
  };
};

const groupRichText = (entries) => {
  const groups = [];
  (entries || []).forEach((entry) => {
    if (entry?.kind === 'bullet' || entry?.kind === 'number') {
      const last = groups[groups.length - 1];
      if (last?.kind === entry.kind) {
        last.items.push(entry);
        return;
      }
      groups.push({ kind: entry.kind, items: [entry] });
      return;
    }
    groups.push(entry);
  });
  return groups;
};

const RichTextBlock = ({ richText }) => {
  const groups = groupRichText(richText);
  const borderStyle = getTypographyBorderStyle('paragraphText');

  return (
    <div className={styles.richText} style={borderStyle}>
      {groups.map((entry, index) => {
        if (entry.kind === 'h1') {
          return (
            <h2 key={`md-h1-${index}`} className={styles.mdH1}>
              {renderInlineHtml(entry.html)}
            </h2>
          );
        }
        if (entry.kind === 'h2') {
          return (
            <h3 key={`md-h2-${index}`} className={styles.mdH2}>
              {renderInlineHtml(entry.html)}
            </h3>
          );
        }
        if (entry.kind === 'quote') {
          return (
            <blockquote key={`md-quote-${index}`} className={styles.mdQuote}>
              {renderInlineHtml(entry.html)}
            </blockquote>
          );
        }
        if (entry.kind === 'bullet' || entry.kind === 'number') {
          const isNumbered = entry.kind === 'number';
          const ListTag = isNumbered ? 'ol' : 'ul';
          const listClass = isNumbered ? styles.numberedList : styles.bulletList;
          return (
            <ListTag key={`md-list-${index}`} className={listClass}>
              {entry.items.map((item, itemIndex) => (
                <li key={`md-li-${itemIndex}`}>{renderInlineHtml(item.html)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={`md-p-${index}`} className={styles.paragraph}>
            {renderInlineHtml(entry.html)}
          </p>
        );
      })}
    </div>
  );
};

const Paragraph = ({ text, items, listType = 'bullet', richText }) => {
  if (Array.isArray(richText) && richText.length) {
    return <RichTextBlock richText={richText} />;
  }

  if (Array.isArray(items) && items.length) {
    const isNumbered = listType === 'numbered' || listType === 'ordered';
    const ListTag = isNumbered ? 'ol' : 'ul';
    const listClass = isNumbered ? styles.numberedList : styles.bulletList;
    const styleKey = isNumbered ? 'numberedList' : 'bulletList';
    return (
      <ListTag className={listClass} style={getTypographyBorderStyle(styleKey)}>
        {items.map((item, index) => (
          <li key={`list-${index}`}>{renderInlineHtml(item)}</li>
        ))}
      </ListTag>
    );
  }

  const intro = splitIntroductionPrefix(text);
  const borderStyle = getTypographyBorderStyle('paragraphText');

  if (intro) {
    return (
      <p className={styles.paragraph} style={borderStyle}>
        <strong className={styles.leadLabel}>{intro.label}</strong>{' '}
        {renderInlineHtml(intro.rest)}
      </p>
    );
  }

  return (
    <p className={styles.paragraph} style={borderStyle}>
      {renderInlineHtml(text)}
    </p>
  );
};

export default Paragraph;
