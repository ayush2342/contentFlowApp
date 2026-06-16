import styles from './Heading.module.scss';

const Heading = ({ text, level = 1 }) => {
  const Tag = `h${level}`;
  return <Tag className={styles.heading}>{text}</Tag>;
};

export default Heading;
