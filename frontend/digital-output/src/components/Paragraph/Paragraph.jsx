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

const Paragraph = ({ text, items, listType = 'bullet' }) => {
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
