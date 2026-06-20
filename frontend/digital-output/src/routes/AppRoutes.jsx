import { Routes, Route } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import HomePage from '../pages/HomePage';
import BookPage from '../pages/BookPage';
import ChapterPage from '../pages/ChapterPage';
import LessonPage from '../pages/LessonPage';

const AppRoutes = () => (
  <Routes>
    <Route element={<MainLayout />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/output/:outputId" element={<HomePage />} />
      <Route path="/book/:bookId" element={<BookPage />} />
      <Route path="/chapter/:chapterId" element={<ChapterPage />} />
      <Route path="/lesson/:lessonId" element={<LessonPage />} />
    </Route>
  </Routes>
);

export default AppRoutes;
