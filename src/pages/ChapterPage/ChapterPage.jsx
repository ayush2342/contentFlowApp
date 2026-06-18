import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCourse } from '../../hooks/useCourse';
import { findChapter } from '../../utils/findInCourse';
import {
  setSelectedBook,
  setSelectedChapter,
  setSelectedLesson,
} from '../../features/course/courseSlice';
import LessonRenderer from '../../renderers/LessonRenderer';
import styles from './ChapterPage.module.scss';

const ChapterPage = () => {
  const { chapterId } = useParams();
  const dispatch = useDispatch();
  const { loading, error, courseData } = useCourse();

  const result = findChapter(courseData, chapterId);
  const book = result?.book;
  const chapter = result?.chapter;

  useEffect(() => {
    if (book && chapter) {
      dispatch(setSelectedBook(book));
      dispatch(setSelectedChapter(chapter));
      dispatch(setSelectedLesson(null));
    }
  }, [book, chapter, dispatch]);

  if (loading) return <p className={styles.status}>Loading...</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!chapter) return <p className={styles.error}>Chapter not found.</p>;

  return (
    <div className={styles.chapter}>
      <Link to={`/book/${book.id}`} className={styles.back}>
        &larr; Back to {book.title}
      </Link>
      {chapter.chapterNumber != null && (
        <p className={styles.meta}>Chapter {chapter.chapterNumber}</p>
      )}
      <h1 className={styles.title}>{chapter.title}</h1>
      {chapter.description && (
        <p className={styles.description}>{chapter.description}</p>
      )}
      {chapter.outline?.length > 0 && (
        <div className={styles.outline}>
          <h2 className={styles.sectionTitle}>Chapter Outline</h2>
          <ul className={styles.outlineList}>
            {chapter.outline.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <h2 className={styles.sectionTitle}>Chapter Content</h2>
      {chapter.lessons?.length ? (
        <div className={styles.contentStack}>
          {chapter.lessons.map((lesson) => (
            <section key={lesson.id} className={styles.lessonSection}>
              <LessonRenderer page={lesson.pages?.[0]} />
            </section>
          ))}
        </div>
      ) : (
        <p className={styles.emptyState}>No chapter content available yet.</p>
      )}
    </div>
  );
};

export default ChapterPage;
