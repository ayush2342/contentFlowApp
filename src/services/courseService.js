import outputJson from '../mock/output.json';
import { mapOutputJson } from '../utils/jsonMapper';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const getCourseData = async () => {
  await delay(300);
  return mapOutputJson(outputJson);
};

export const getBookById = (courseData, bookId) =>
  courseData?.books?.find((book) => book.id === bookId) ?? null;

export const getChapterById = (courseData, chapterId) => {
  for (const book of courseData?.books ?? []) {
    const chapter = book.chapters?.find((ch) => ch.id === chapterId);
    if (chapter) return { book, chapter };
  }
  return null;
};

export const getLessonById = (courseData, lessonId) => {
  for (const book of courseData?.books ?? []) {
    for (const chapter of book.chapters ?? []) {
      const lesson = chapter.lessons?.find((ls) => ls.id === lessonId);
      if (lesson) return { book, chapter, lesson };
    }
  }
  return null;
};
