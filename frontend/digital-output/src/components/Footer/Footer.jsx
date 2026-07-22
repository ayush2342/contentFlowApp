import styles from './Footer.module.scss';

const Footer = ({ text, left, right, center }) => {
  const main = text || center || '';
  if (!main && !left && !right) return null;

  return (
    <footer className={styles.footer}>
      {left || right ? (
        <div className={styles.row}>
          <span className={styles.side}>{left || ''}</span>
          <span className={styles.center}>{main}</span>
          <span className={styles.side}>{right || ''}</span>
        </div>
      ) : (
        <p className={styles.text}>{main}</p>
      )}
    </footer>
  );
};

export default Footer;
