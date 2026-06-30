import { typographyStyles, generateAllCssVariables } from '../../../../shared/typography-styles.js';

export const theme = {
  primaryColor: typographyStyles.chapterTitle.color === '#000000' 
    ? typographyStyles.sectionTitle.color 
    : typographyStyles.chapterTitle.color,
  secondaryColor: '#EAF3FF',
  fontFamily: `${typographyStyles.paragraphText.font}, sans-serif`,
};

export const applyTheme = (root = document.documentElement) => {
  // Base theme variables
  root.style.setProperty('--primary-color', typographyStyles.sectionTitle.color);
  root.style.setProperty('--secondary-color', theme.secondaryColor);
  root.style.setProperty('--font-family', theme.fontFamily);
  root.style.setProperty('--heading-color', typographyStyles.sectionTitle.color);
  root.style.setProperty('--paragraph-color', typographyStyles.paragraphText.color);
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
  root.style.setProperty('--body-color', typographyStyles.paragraphText.color);
  root.style.setProperty('--body-bg', '#ffffff');
  root.style.setProperty('--card-shadow', '0 4px 12px rgba(0, 85, 170, 0.15)');

  // Apply all typography CSS variables
  const typographyVars = generateAllCssVariables();
  Object.entries(typographyVars).forEach(([varName, value]) => {
    root.style.setProperty(varName, value);
  });
};

// Export typography styles for direct access if needed
export { typographyStyles };
