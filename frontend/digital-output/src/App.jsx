import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './app/store';
import AppRoutes from './routes/AppRoutes';
import { applyTheme } from './themes/theme';
import { getRouteContext } from './services/courseService';

const App = () => {
  useEffect(() => {
    const { templateId } = getRouteContext();
    applyTheme(document.documentElement, templateId || 'theme2');
  }, []);

  return (
    <Provider store={store}>
      <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASENAME || '/api'}>
        <AppRoutes />
      </BrowserRouter>
    </Provider>
  );
};

export default App;
