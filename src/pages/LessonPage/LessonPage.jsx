import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useCourse } from '../../hooks/useCourse';
import { findLesson } from '../../utils/findInCourse';
import {
  setSelectedBook,
  setSelectedChapter,
  setSelectedLesson,
} from '../../features/course/courseSlice';
import LessonRenderer from '../../renderers/LessonRenderer';
import styles from './LessonPage.module.scss';

const LessonPage = () => {
  const { lessonId } = useParams();
  const dispatch = useDispatch();
  const { loading, error, courseData } = useCourse();

  const result = findLesson(courseData, lessonId);
  const book = result?.book;
  const chapter = result?.chapter;
  const lesson = result?.lesson;
  const page = lesson?.pages?.[0];

  useEffect(() => {
    if (book && chapter && lesson) {
      dispatch(setSelectedBook(book));
      dispatch(setSelectedChapter(chapter));
      dispatch(setSelectedLesson(lesson));
    }
  }, [book, chapter, lesson, dispatch]);

  if (loading) return <p className={styles.status}>Loading...</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!lesson) return <p className={styles.error}>Lesson not found.</p>;

  return (
    <div className={styles.lesson}>
      <Link to={`/chapter/${chapter.id}`} className={styles.back}>
        &larr; Back to {chapter.title}
      </Link>
      <LessonRenderer page={page} />
    </div>
  );
};

export default LessonPage;
