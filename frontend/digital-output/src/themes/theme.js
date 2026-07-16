import {
  typographyStyles as defaultTypographyStyles,
  generateAllCssVariables,
  resolveTypographyStyles,
  DEFAULT_THEME_ID,
} from '../../../../shared/typography-styles.js';

const getSectionTitleColor = (styles) =>
  styles.sectionTitle?.color ||
  styles.sectionTitle?.text?.color ||
  styles.lessonTitle?.color ||
  '#214880';

export const theme = {
  primaryColor: getSectionTitleColor(defaultTypographyStyles),
  secondaryColor: '#EAF3FF',
  fontFamily: `${defaultTypographyStyles.paragraphText?.font || 'Arial'}, sans-serif`,
};

export const applyTheme = (root = document.documentElement, templateId = DEFAULT_THEME_ID) => {
  const typographyStyles = resolveTypographyStyles(templateId);
  const sectionTitleColor = getSectionTitleColor(typographyStyles);

  root.style.setProperty('--primary-color', sectionTitleColor);
  root.style.setProperty('--secondary-color', theme.secondaryColor);
  root.style.setProperty(
    '--font-family',
    `${typographyStyles.paragraphText?.font || 'Arial'}, sans-serif`
  );
  root.style.setProperty('--heading-color', sectionTitleColor);
  root.style.setProperty(
    '--paragraph-color',
    typographyStyles.paragraphText?.color || '#000000'
  );
  root.style.setProperty('--border-radius', '8px');
  root.style.setProperty('--surface-color', '#ffffff');
  root.style.setProperty('--on-primary-color', '#ffffff');
  root.style.setProperty('--text-muted', '#666666');
  root.style.setProperty('--text-secondary', '#555555');
  root.style.setProperty('--border-color', '#dddddd');
  root.style.setProperty('--error-color', '#cc0000');
  root.style.setProperty('--warning-bg', '#fff8e6');
  root.style.setProperty('--warning-border', '#e6a817');
  root.style.setProperty('--activity-bg', '#f9f9f9');
  root.style.setProperty('--table-stripe-bg', '#fafafa');
  root.style.setProperty('--quote-color', '#444444');
  root.style.setProperty(
    '--body-color',
    typographyStyles.paragraphText?.color || '#000000'
  );
  root.style.setProperty('--body-bg', '#ffffff');
  root.style.setProperty('--card-shadow', '0 4px 12px rgba(0, 85, 170, 0.15)');
  root.dataset.templateId = String(templateId || DEFAULT_THEME_ID);

  const typographyVars = generateAllCssVariables(typographyStyles);
  Object.entries(typographyVars).forEach(([varName, value]) => {
    root.style.setProperty(varName, value);
  });
};

export { defaultTypographyStyles as typographyStyles, DEFAULT_THEME_ID };
