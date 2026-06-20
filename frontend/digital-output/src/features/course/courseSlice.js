import { createSlice } from '@reduxjs/toolkit';
import { fetchCourseData } from './courseThunks';

const initialState = {
  loading: false,
  error: null,
  selectedBook: null,
  selectedChapter: null,
  selectedLesson: null,
  courseData: null,
};

const courseSlice = createSlice({
  name: 'course',
  initialState,
  reducers: {
    setSelectedBook: (state, action) => {
      state.selectedBook = action.payload;
    },
    setSelectedChapter: (state, action) => {
      state.selectedChapter = action.payload;
    },
    setSelectedLesson: (state, action) => {
      state.selectedLesson = action.payload;
    },
    clearSelection: (state) => {
      state.selectedBook = null;
      state.selectedChapter = null;
      state.selectedLesson = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCourseData.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCourseData.fulfilled, (state, action) => {
        state.loading = false;
        state.courseData = action.payload;
      })
      .addCase(fetchCourseData.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to load course data';
      });
  },
});

export const { setSelectedBook, setSelectedChapter, setSelectedLesson, clearSelection } =
  courseSlice.actions;

export default courseSlice.reducer;
