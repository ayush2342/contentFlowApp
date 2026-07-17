import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './app/store';
import AppRoutes from './routes/AppRoutes';
import { applyTheme } from './themes/theme';

// Default theme until /document returns session templateId.
applyTheme(document.documentElement, 'theme2');

const App = () => (
  <Provider store={store}>
    <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASENAME || '/api'}>
      <AppRoutes />
    </BrowserRouter>
  </Provider>
);

export default App;
