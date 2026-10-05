import { getTypographyBorderStyle } from '../../../../../shared/typography-styles.js';
import { renderInlineHtml } from '../../utils/inlineHtml.jsx';
import styles from './LearningObjective.module.scss';

const LearningObjective = ({ title = 'LEARNING OBJECTIVES', introText = '', objectives = [] }) => (
  <div className={styles.objective}>
    <h4 className={styles.title} style={getTypographyBorderStyle('learningObjectives')}>
      {renderInlineHtml(title)}
    </h4>
    {introText ? <p className={styles.intro}>{renderInlineHtml(introText)}</p> : null}
    <ul className={styles.list}>
      {objectives.map((item, index) => (
        <li key={index}>{renderInlineHtml(item)}</li>
      ))}
    </ul>
  </div>
);

export default LearningObjective;
