import styles from './Heading.module.scss';

const variantClassMap = {
  chapterTitle: styles.chapterTitle,
  lessonTitle: styles.lessonTitle,
  sectionTitle: styles.sectionTitle,
  subSectionTitle: styles.subSectionTitle,
  chapterOverview: styles.chapterOverview,
};

const Heading = ({ text, level = 1, variant }) => {
  const Tag = `h${level}`;
  const variantClass = variant ? variantClassMap[variant] : '';
  const className = [styles.heading, variantClass].filter(Boolean).join(' ');
  
  return <Tag className={className}>{text}</Tag>;
};

export default Heading;
