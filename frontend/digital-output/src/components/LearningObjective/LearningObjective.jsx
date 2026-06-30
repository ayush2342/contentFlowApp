import styles from './LearningObjective.module.scss';

const LearningObjective = ({ title = 'LEARNING OBJECTIVES', introText = '', objectives = [] }) => (
  <div className={styles.objective}>
    <h4 className={styles.title}>{title}</h4>
    {introText ? <p className={styles.intro}>{introText}</p> : null}
    <ul className={styles.list}>
      {objectives.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  </div>
);

export default LearningObjective;
