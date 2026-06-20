import componentRegistry from '../constants/componentRegistry';
import styles from './LessonRenderer.module.scss';

const DynamicComponent = ({ component }) => {
  if (component.type === '__unsupported__') {
    return (
      <div className={styles.unsupported} role="note">
        {/* TODO: Add renderer support when requirements for "{component.props.originalType}" are defined */}
        Unsupported content type: {component.props.originalType}
      </div>
    );
  }

  const Component = componentRegistry[component.type];

  if (!Component) {
    return null;
  }

  return <Component {...component.props} />;
};

const LessonRenderer = ({ page }) => {
  if (!page) {
    return null;
  }

  return (
    <article className={styles.lesson}>
      {page.components?.map((component, index) => (
        <DynamicComponent key={component.id || index} component={component} />
      ))}
    </article>
  );
};

export default LessonRenderer;
