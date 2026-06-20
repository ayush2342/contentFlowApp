import { Link, useLocation } from 'react-router-dom';
import { useCourse } from '../../hooks/useCourse';
import styles from './HomePage.module.scss';

const HomePage = () => {
  const { loading, error, courseData } = useCourse();
  const location = useLocation();
  const search = location.search || '';

  if (loading) return <p className={styles.status}>Loading course...</p>;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.home}>
      <h1 className={styles.title}>Course Library</h1>
      <p className={styles.subtitle}>Select a book to begin your learning journey.</p>

      <div className={styles.grid}>
        {courseData?.books?.map((book) => (
          <Link
            key={book.id}
            to={{ pathname: `/book/${book.id}`, search }}
            className={styles.card}
          >
            <h2>{book.title}</h2>
            <p>{book.description}</p>
            <span className={styles.chapters}>
              {book.chapters?.length} chapters
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default HomePage;
