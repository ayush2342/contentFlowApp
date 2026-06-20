export const findBook = (courseData, bookId) =>
  courseData?.books?.find((book) => book.id === bookId) ?? null;

export const findChapter = (courseData, chapterId) => {
  for (const book of courseData?.books ?? []) {
    const chapter = book.chapters?.find((ch) => ch.id === chapterId);
    if (chapter) return { book, chapter };
  }
  return null;
};

export const findLesson = (courseData, lessonId) => {
  for (const book of courseData?.books ?? []) {
    for (const chapter of book.chapters ?? []) {
      const lesson = chapter.lessons?.find((ls) => ls.id === lessonId);
      if (lesson) return { book, chapter, lesson };
    }
  }
  return null;
};
