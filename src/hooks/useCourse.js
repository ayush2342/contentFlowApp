import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchCourseData } from '../features/course/courseThunks';

export const useCourse = () => {
  const dispatch = useDispatch();
  const { loading, error, courseData, selectedBook, selectedChapter, selectedLesson } =
    useSelector((state) => state.course);

  useEffect(() => {
    if (!courseData) {
      dispatch(fetchCourseData());
    }
  }, [dispatch, courseData]);

  return { loading, error, courseData, selectedBook, selectedChapter, selectedLesson };
};
