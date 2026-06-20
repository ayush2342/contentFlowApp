import styles from './SubHeading.module.scss';

const SubHeading = ({ text }) => (
  <h3 className={styles.subHeading}>{text}</h3>
);

export default SubHeading;
