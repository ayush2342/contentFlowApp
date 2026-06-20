import { createAsyncThunk } from '@reduxjs/toolkit';
import { getCourseData } from '../../services/courseService';

export const fetchCourseData = createAsyncThunk(
  'course/fetchCourseData',
  async (context, { rejectWithValue }) => {
    try {
      const data = await getCourseData(context);
      return data;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);
