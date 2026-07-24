import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCourse } from '../../hooks/useCourse';
import { findChapter } from '../../utils/findInCourse';
import {
  setSelectedChapter,
  setSelectedLesson,
} from '../../features/course/courseSlice';
import LessonRenderer from '../../renderers/LessonRenderer';
import styles from './ChapterPage.module.scss';

const getFirstChapter = (courseData) => {
  for (const book of courseData?.books ?? []) {
    const chapter = book?.chapters?.[0];
    if (chapter) return { book, chapter };
  }
  return null;
};

const ChapterPage = () => {
  const { chapterId } = useParams();
  const dispatch = useDispatch();
  const { loading, error, courseData } = useCourse();

  const result = useMemo(() => {
    if (chapterId) return findChapter(courseData, chapterId);
    return getFirstChapter(courseData);
  }, [courseData, chapterId]);

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
      <div className={styles.chapter}>
        {chapter.lessons?.length ? (
          <div className={styles.contentStack}>
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
        ) : (
          <p className={styles.emptyState}>No chapter content available yet.</p>
        )}
      </div>
    </div>
  );
};

export default ChapterPage;
