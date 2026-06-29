import { Link, useLocation } from 'react-router-dom';
import { useCourse } from '../../hooks/useCourse';
import styles from './HomePage.module.scss';

const HomePage = () => {
  const { loading, error, courseData } = useCourse();
  const location = useLocation();

  const chapterCards =
    courseData?.books?.flatMap((book) =>
      (book.chapters ?? []).map((chapter, index) => {
        const chapterTitle =
          `${chapter.chapterNumber ? `Chapter ${chapter.chapterNumber}` : `Chapter ${index + 1}`}${
            chapter.title ? `: ${chapter.title}` : ''
          }`;

        return {
          id: chapter.id,
          title: chapterTitle,
          description: chapter.description || '',
          search: location.search || '',
        };
      })
    ) ?? [];

  if (loading) return <p className={styles.status}>Loading course...</p>;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.home}>
      <h1 className={styles.title}>Chapter Library</h1>
      <p className={styles.subtitle}>Select a chapter to open full details.</p>

      <div className={styles.grid}>
        {chapterCards.map((chapter) => (
          <Link
            key={chapter.id}
            to={{ pathname: `/chapter/${chapter.id}`, search: chapter.search }}
            className={styles.card}
          >
            <h2>{chapter.title}</h2>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default HomePage;
