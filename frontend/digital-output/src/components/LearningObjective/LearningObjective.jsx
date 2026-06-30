import styles from './LearningObjective.module.scss';

const LearningObjective = ({ title = 'Learning Objectives', objectives = [] }) => (
  <div className={styles.objective}>
    <h4 className={styles.title}>{title}</h4>
    <ul className={styles.list}>
      {objectives.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  </div>
);

export default LearningObjective;
