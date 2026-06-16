import { Outlet, Link } from 'react-router-dom';
import styles from './MainLayout.module.scss';

const MainLayout = () => (
  <div className={styles.layout}>
    <header className={styles.header}>
      <Link to="/" className={styles.logo}>
        ContentFlow
      </Link>
      <nav className={styles.nav}>
        <Link to="/">Home</Link>
      </nav>
    </header>
    <main className={styles.main}>
      <Outlet />
    </main>
    <footer className={styles.footer}>
      <p>&copy; 2026 ContentFlow Biology Course</p>
    </footer>
  </div>
);

export default MainLayout;
