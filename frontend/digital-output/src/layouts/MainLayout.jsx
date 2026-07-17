import { Outlet } from 'react-router-dom';
import styles from './MainLayout.module.scss';

const MainLayout = () => (
  <div className={styles.layout}>
    <main className={styles.main}>
      <Outlet />
    </main>
  </div>
);

export default MainLayout;
