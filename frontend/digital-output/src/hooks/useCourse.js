import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchCourseData } from '../features/course/courseThunks';
import { applyTheme } from '../themes/theme';

export const useCourse = () => {
  const dispatch = useDispatch();
  const { loading, error, courseData, selectedBook, selectedChapter, selectedLesson } =
    useSelector((state) => state.course);

  const contextKey = `${window.location.pathname}|${window.location.search}`;

  useEffect(() => {
    // Let service resolve route + session context, so navigation keeps tenant/doc state.
    dispatch(fetchCourseData());
  }, [dispatch, contextKey]);

  useEffect(() => {
    if (courseData?.templateId) {
      applyTheme(document.documentElement, courseData.templateId, courseData.typography);
    }
  }, [courseData?.templateId, courseData?.typography]);

  return { loading, error, courseData, selectedBook, selectedChapter, selectedLesson };
};
