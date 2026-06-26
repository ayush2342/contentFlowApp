import { useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCourse } from '../../hooks/useCourse';
import { findBook } from '../../utils/findInCourse';
import { setSelectedBook } from '../../features/course/courseSlice';
import styles from './BookPage.module.scss';

const BookPage = () => {
  const { bookId } = useParams();
  const location = useLocation();
  const search = location.search || '';
  const dispatch = useDispatch();
  const { loading, error, courseData } = useCourse();

  const book = findBook(courseData, bookId);

  useEffect(() => {
    if (book) {
      dispatch(setSelectedBook(book));
    }
  }, [book, dispatch]);

  if (loading) return <p className={styles.status}>Loading...</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!book) return <p className={styles.error}>Book not found.</p>;

  return (
    <div className={styles.book}>
      <Link to={{ pathname: '/', search }} className={styles.back}>&larr; Back to Library</Link>
      <h1 className={styles.title}>{book.title}</h1>
      <p className={styles.description}>{book.description}</p>
      <h2 className={styles.sectionTitle}>Chapters</h2>
      <ul className={styles.list}>
        {book.chapters?.map((chapter) => (
          <li key={chapter.id}>
            <Link to={{ pathname: `/chapter/${chapter.id}`, search }} className={styles.link}>
              <span className={styles.linkTitle}>{chapter.title}</span>
              <span className={styles.linkDesc}>{chapter.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BookPage;
