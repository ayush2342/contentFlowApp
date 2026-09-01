import styles from './IconLabel.module.scss';

const IconLabel = ({ src, text }) => (
  <div className={styles.iconLabel}>
    {src ? (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={styles.icon}
        // A logo that fails to load should not hold its slot open.
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    ) : null}
    <span className={styles.text}>{text}</span>
  </div>
);

export default IconLabel;
