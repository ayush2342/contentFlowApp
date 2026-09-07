import { renderInlineHtml } from '../../utils/inlineHtml.jsx';
import styles from './PageHeader.module.scss';

const PageHeader = ({ text }) => {
  if (!text) return null;

  return (
    <header className={styles.pageHeader}>
      <p className={styles.text}>{renderInlineHtml(text)}</p>
    </header>
  );
};

export default PageHeader;
