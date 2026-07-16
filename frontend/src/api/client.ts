import axios from "axios";
import { API_BASE } from "../config";

// Shared axios instance. baseURL is empty in dev (relative paths hit the Vite
// proxy) and configurable via VITE_API_BASE_URL for cross-origin deployments.
export const api = axios.create({ baseURL: API_BASE });
