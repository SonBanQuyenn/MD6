import axios from 'axios';

/** Một axios instance dùng chung: mọi request đi qua đường dẫn /api cùng domain. */
export const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
});
