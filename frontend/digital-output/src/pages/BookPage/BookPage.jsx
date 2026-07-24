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
  const searchParams = new URLSearchParams(search);
  const selectedChapterId = searchParams.get('chapterId');
  const dispatch = useDispatch();
  const { loading, error, courseData } = useCourse();

  const book = findBook(courseData, bookId);
  const chaptersToRender = selectedChapterId
    ? (book?.chapters ?? []).filter((chapter) => chapter.id === selectedChapterId)
    : (book?.chapters ?? []);

  useEffect(() => {
    if (book) {
      dispatch(setSelectedBook(book));
    }
  }, [book, dispatch]);

  if (loading) return <p className={styles.status}>Loading...</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!book) return <p className={styles.error}>Book not found.</p>;

  return (
    <div className={styles.page}>
      <div className={styles.backRow}>
        <Link to={{ pathname: '/', search }} className={styles.back}>
          &larr; Back to Chapter Library
        </Link>
      </div>
      <div className={styles.book}>
        {chaptersToRender.length ? (
          <div className={styles.contentStack}>
            {chaptersToRender.map((chapter, chapterIndex) => (
              <section key={chapter.id} className={styles.chapterSection}>
                <h2 className={styles.sectionTitle}>
                  {chapter.chapterNumber ? `Chapter ${chapter.chapterNumber}` : `Chapter ${chapterIndex + 1}`}
                  {chapter.title ? `: ${chapter.title}` : ''}
                </h2>

                {chapter.outline?.length ? (
                  <div className={styles.outlineBlock}>
                    <h3 className={styles.outlineTitle}>Chapter Outline</h3>
                    <ul className={styles.list}>
                      {chapter.outline.map((item) => (
                        <li key={`${chapter.id}-${item}`} className={styles.linkDesc}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {chapter.lessons?.length ? (
                  <div className={styles.lessonStack}>
                    {chapter.lessons.map((lesson) => (
                      <section key={lesson.id} className={styles.lessonSection}>
                        <LessonRenderer
                          page={lesson.pages?.[0]}
                          layout={courseData?.layout}
                          templateId={courseData?.templateId}
                          typography={courseData?.typography}
                        />
                      </section>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BookPage;
