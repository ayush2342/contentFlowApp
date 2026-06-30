import { useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCourse } from '../../hooks/useCourse';
import { findChapter } from '../../utils/findInCourse';
import {
  setSelectedChapter,
  setSelectedLesson,
} from '../../features/course/courseSlice';
import LessonRenderer from '../../renderers/LessonRenderer';
import styles from './ChapterPage.module.scss';

const ChapterPage = () => {
  const { chapterId } = useParams();
  const location = useLocation();
  const search = location.search || '';
  const dispatch = useDispatch();
  const { loading, error, courseData } = useCourse();

  const result = findChapter(courseData, chapterId);
  const chapter = result?.chapter;

  useEffect(() => {
    if (chapter) {
      dispatch(setSelectedChapter(chapter));
      dispatch(setSelectedLesson(null));
    }
  }, [chapter, dispatch]);

  if (loading) return <p className={styles.status}>Loading...</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!chapter) return <p className={styles.error}>Chapter not found.</p>;

  return (
    <div className={styles.page}>
      <div className={styles.backRow}>
        <Link to={{ pathname: '/', search }} className={styles.back}>
          &larr; Back to Chapter Library
        </Link>
      </div>

      <div className={styles.chapter}>
        {chapter.chapterNumber != null && (
          <p className={styles.meta}>Chapter {chapter.chapterNumber}</p>
        )}
        {chapter.title ? <h1 className={styles.title}>{chapter.title}</h1> : null}
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
    </div>
  );
};

export default ChapterPage;
