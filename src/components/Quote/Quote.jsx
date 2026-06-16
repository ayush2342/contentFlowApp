import styles from './Quote.module.scss';

const Quote = ({ text, author }) => (
  <blockquote className={styles.quote}>
    <p className={styles.text}>&ldquo;{text}&rdquo;</p>
    {author && <cite className={styles.author}>— {author}</cite>}
  </blockquote>
);

export default Quote;
