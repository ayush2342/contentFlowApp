import { useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCourse } from '../../hooks/useCourse';
import { findBook } from '../../utils/findInCourse';
import { setSelectedBook } from '../../features/course/courseSlice';
import LessonRenderer from '../../renderers/LessonRenderer';
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
      {book.chapters?.length ? (
        <div className={styles.contentStack}>
          {book.chapters.map((chapter, chapterIndex) => (
            <section key={chapter.id} className={styles.chapterSection}>
              <h2 className={styles.sectionTitle}>
                {chapter.chapterNumber ? `Chapter ${chapter.chapterNumber}: ` : ''}
                {chapter.title || `Chapter ${chapterIndex + 1}`}
              </h2>
              {chapter.description ? <p className={styles.linkDesc}>{chapter.description}</p> : null}
              {chapter.outline?.length ? (
                <ul className={styles.list}>
                  {chapter.outline.map((item) => (
                    <li key={`${chapter.id}-${item}`} className={styles.linkDesc}>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}

              {chapter.lessons?.length ? (
                <div className={styles.lessonStack}>
                  {chapter.lessons.map((lesson) => (
                    <section key={lesson.id} className={styles.lessonSection}>
                      <LessonRenderer page={lesson.pages?.[0]} />
                    </section>
                  ))}
                </div>
              ) : (
                <p className={styles.linkDesc}>No section/lesson details provided for this chapter.</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <p className={styles.linkDesc}>No chapters provided in this payload.</p>
      )}
    </div>
  );
};

export default BookPage;
