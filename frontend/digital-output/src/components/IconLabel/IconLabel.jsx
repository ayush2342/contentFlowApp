import styles from './IconLabel.module.scss';

const IconLabel = ({ src, text }) => (
  <div className={styles.iconLabel}>
    {src ? <img src={src} alt="" aria-hidden="true" className={styles.icon} /> : null}
    <span className={styles.text}>{text}</span>
  </div>
);

export default IconLabel;
