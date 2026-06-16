import styles from './Paragraph.module.scss';

const Paragraph = ({ text }) => (
  <p className={styles.paragraph}>{text}</p>
);

export default Paragraph;
