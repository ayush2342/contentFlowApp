import styles from './Assessment.module.scss';

const Assessment = ({ title, questions = [] }) => (
  <div className={styles.assessment}>
    <h4 className={styles.title}>{title}</h4>
    <div className={styles.questions}>
      {questions.map((q, index) => (
        <div key={index} className={styles.question}>
          <p className={styles.questionText}>
            {index + 1}. {q.question}
          </p>
          <ul className={styles.options}>
            {q.options.map((option, optIndex) => (
              <li key={optIndex}>
                <label>
                  <input type="radio" name={`q-${index}`} value={optIndex} />
                  {option}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </div>
);

export default Assessment;
