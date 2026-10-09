import axios from "axios";

// Every request in the app goes through this client, so every one of them gets
// the same error message below.
export const http = axios.create({ baseURL: "/api" });

// Turn the server's { error } body into a normal Error message.
http.interceptors.response.use(
  (r) => r,
  (err: unknown) => {
    if (axios.isAxiosError<{ error?: string }>(err)) {
      const msg = err.response?.data?.error ?? (err.response ? err.message : "Cannot reach the server. Is it running?");
      return Promise.reject(new Error(msg));
    }
    return Promise.reject(err);
  },
);
