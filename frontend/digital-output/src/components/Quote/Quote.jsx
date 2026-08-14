import styles from './Quote.module.scss';

const Quote = ({ text, author, children }) => {
  const quoteText = text || (typeof children === 'string' ? children : '');
  if (!quoteText && !author) return null;

  // Do not use getTypographyBorderStyle here — its paddingBlock:0 inline style
  // overrides SCSS vertical padding and collapses the quote box.
  return (
    <blockquote
      className={styles.quote}
      style={{
        borderTop: 'var(--typography-quotation-border-top, none)',
        borderBottom: 'var(--typography-quotation-border-bottom, none)',
      }}
    >
      {quoteText ? <p className={styles.text}>{quoteText}</p> : null}
      {author ? <cite className={styles.author}>{author}</cite> : null}
    </blockquote>
  );
};

export default Quote;
