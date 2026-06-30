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

const Paragraph = ({ text }) => {
  const intro = splitIntroductionPrefix(text);

  if (intro) {
    return (
      <p className={styles.paragraph}>
        <strong className={styles.leadLabel}>{intro.label}</strong>{' '}
        {renderWithLinks(intro.rest)}
      </p>
    );
  }

  return <p className={styles.paragraph}>{renderWithLinks(text)}</p>;
};

export default Paragraph;
