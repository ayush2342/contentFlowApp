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

const Paragraph = ({ text }) => (
  <p className={styles.paragraph}>{renderWithLinks(text)}</p>
);

export default Paragraph;
