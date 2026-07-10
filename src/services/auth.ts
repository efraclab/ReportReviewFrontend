import axios from "axios";
import { FRONTEND_URL } from "../config";

const API_BASE_URL = `${FRONTEND_URL}/api`;

export async function login(filters = {}) {
  console.log(filters)
  const response = await axios.post(`${API_BASE_URL}/auth/login`, filters, {
    headers: { "Content-Type": "application/json" },
  });
  console.log(response.data)
  return response.data;
}