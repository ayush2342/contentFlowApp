import styles from './Activity.module.scss';

const Activity = ({ title, instructions, questions = [] }) => (
  <div className={styles.activity}>
    <h4 className={styles.title}>{title}</h4>
    {instructions && <p className={styles.instructions}>{instructions}</p>}
    <ol className={styles.questions}>
      {questions.map((question, index) => (
        <li key={index}>{question}</li>
      ))}
    </ol>
  </div>
);

export default Activity;
