import styles from './ReadingStrategy.module.scss';

const ReadingStrategy = ({ title, description, steps = [] }) => (
  <div className={styles.strategy}>
    <h4 className={styles.title}>{title}</h4>
    {description && <p className={styles.description}>{description}</p>}
    <ol className={styles.steps}>
      {steps.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  </div>
);

export default ReadingStrategy;
