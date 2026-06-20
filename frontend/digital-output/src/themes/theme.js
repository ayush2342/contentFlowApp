export const theme = {
  primaryColor: '#0055AA',
  secondaryColor: '#EAF3FF',
  fontFamily: 'Inter, system-ui, sans-serif',
};

export const applyTheme = (root = document.documentElement) => {
  root.style.setProperty('--primary-color', theme.primaryColor);
  root.style.setProperty('--secondary-color', theme.secondaryColor);
  root.style.setProperty('--font-family', theme.fontFamily);
  root.style.setProperty('--heading-color', theme.primaryColor);
  root.style.setProperty('--paragraph-color', '#333333');
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
  root.style.setProperty('--body-color', '#222222');
  root.style.setProperty('--body-bg', '#ffffff');
  root.style.setProperty('--card-shadow', '0 4px 12px rgba(0, 85, 170, 0.15)');
};
