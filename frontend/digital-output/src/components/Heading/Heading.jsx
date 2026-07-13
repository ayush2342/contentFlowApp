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
};

const Heading = ({ text, level = 1, variant }) => {
  const Tag = `h${level}`;
  const variantClass = variant ? variantClassMap[variant] : '';
  const className = [styles.heading, variantClass].filter(Boolean).join(' ');
  
  return <Tag className={className}>{text}</Tag>;
};

export default Heading;
