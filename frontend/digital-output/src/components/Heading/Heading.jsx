import { getTypographyBorderStyle } from '../../../../../shared/typography-styles.js';
import styles from './Heading.module.scss';

const variantClassMap = {
  partNumber: styles.partNumber,
  chapterNumber: styles.chapterNumber,
  chapterHeading: styles.chapterHeading,
  chapterTitle: styles.chapterTitle,
  lessonTitle: styles.lessonTitle,
  sectionTitle: styles.sectionTitle,
  subSectionTitle: styles.subSectionTitle,
  greenSubSectionTitle: styles.greenSubSectionTitle,
  subTitle: styles.subTitle,
  subTitlesList: styles.subTitlesList,
  chapterOverview: styles.chapterOverview,
  lessonOverview: styles.lessonOverview,
};

/** Same split as PDF populate-indesign.jsx splitNumberAndText */
const splitNumberAndText = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { number: '', text: '' };
  const match = trimmed.match(/^(\d+(?:[.\-]\w*)*)\s+(.+)$/);
  if (match) return { number: match[1], text: match[2] };
  return { number: '', text: trimmed };
};

const COMPOSITE_VARIANTS = new Set(['subTitlesList', 'sectionTitle', 'lessonOverview']);

const Heading = ({ text, level = 1, variant }) => {
  const Tag = `h${level}`;
  const variantClass = variant ? variantClassMap[variant] : '';
  const className = [styles.heading, variantClass].filter(Boolean).join(' ');
  // Theme-driven borders for any heading variant (e.g. sectionTitle in theme 2).
  const borderStyle = getTypographyBorderStyle(variant);

  if (COMPOSITE_VARIANTS.has(variant)) {
    const parts = splitNumberAndText(text);
    if (parts.number) {
      return (
        <Tag className={className} style={borderStyle}>
          <span className={styles.compositeNumber}>{parts.number}</span>{' '}
          <span className={styles.compositeText}>{parts.text}</span>
        </Tag>
      );
    }
  }

  return (
    <Tag className={className} style={borderStyle}>
      {text}
    </Tag>
  );
};

export default Heading;
