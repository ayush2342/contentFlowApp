import { getTypographyBorderStyle } from '../../../../../shared/typography-styles.js';
import styles from './Paragraph.module.scss';

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const renderWithLinks = (text) => {
  const value = String(text ?? '');
  const parts = value.split(URL_REGEX);

  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <a
          key={`link-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          {part}
        </a>
      );
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
};

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
          <li key={`list-${index}`}>{renderWithLinks(item)}</li>
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
        {renderWithLinks(intro.rest)}
      </p>
    );
  }

  return (
    <p className={styles.paragraph} style={borderStyle}>
      {renderWithLinks(text)}
    </p>
  );
};

export default Paragraph;
