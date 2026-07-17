import { Routes, Route } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';
import ChapterPage from '../pages/ChapterPage';

const AppRoutes = () => (
  <Routes>
    <Route element={<MainLayout />}>
      <Route path="/" element={<ChapterPage />} />
      <Route path="/output/:outputId" element={<ChapterPage />} />
      <Route path="/chapter/:chapterId" element={<ChapterPage />} />
    </Route>
  </Routes>
);

export default AppRoutes;
