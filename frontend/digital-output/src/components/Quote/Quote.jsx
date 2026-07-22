import styles from './Quote.module.scss';

const Quote = ({ text, author, children }) => {
  const quoteText = text || (typeof children === 'string' ? children : '');
  if (!quoteText && !author) return null;

  return (
    <blockquote className={styles.quote}>
      {quoteText ? <p className={styles.text}>{quoteText}</p> : null}
      {author ? <cite className={styles.author}>{author}</cite> : null}
    </blockquote>
  );
};

export default Quote;
