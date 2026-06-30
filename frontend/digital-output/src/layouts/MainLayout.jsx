import { Outlet, Link, useLocation } from 'react-router-dom';
import styles from './MainLayout.module.scss';

const MainLayout = () => {
  const location = useLocation();
  const search = location.search || '';

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <Link to={{ pathname: '/', search }} className={styles.logo}>
          ContentFlow
        </Link>
        <nav className={styles.nav}>
          <Link to={{ pathname: '/', search }}>Home</Link>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
};

export default MainLayout;
