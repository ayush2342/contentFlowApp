import { createAsyncThunk } from '@reduxjs/toolkit';
import { getCourseData } from '../../services/courseService';

export const fetchCourseData = createAsyncThunk(
  'course/fetchCourseData',
  async (_, { rejectWithValue }) => {
    try {
      const data = await getCourseData();
      return data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);
