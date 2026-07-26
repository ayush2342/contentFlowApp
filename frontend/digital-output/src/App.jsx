import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './app/store';
import AppRoutes from './routes/AppRoutes';
import { applyTheme, DEFAULT_THEME_ID } from './themes/theme';

// Boot with configured default until /document returns the session templateId.
// DEFAULT_THEME_ID comes from shared themes (not hardcoded theme1/theme2).
applyTheme(document.documentElement, DEFAULT_THEME_ID);

const App = () => (
  <Provider store={store}>
    <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASENAME || '/api'}>
      <AppRoutes />
    </BrowserRouter>
  </Provider>
);

export default App;
