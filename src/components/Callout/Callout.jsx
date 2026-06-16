import styles from './Callout.module.scss';

const Callout = ({ variant = 'info', title, text }) => (
  <div className={`${styles.callout} ${styles[variant]}`}>
    {title && <strong className={styles.title}>{title}</strong>}
    <p className={styles.text}>{text}</p>
  </div>
);

export default Callout;
