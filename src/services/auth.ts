import axios from "axios";


const API_BASE_URL = 'http://192.168.2.220:5079/api';

export async function login(filters = {}) {
  console.log(filters)
  const response = await axios.post(`${API_BASE_URL}/auth/login`, filters, {
    headers: { "Content-Type": "application/json" },
  });
  console.log(response.data)
  return response.data;
}