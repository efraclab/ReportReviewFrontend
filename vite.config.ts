import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


export default defineConfig({
  plugins: [react(), 
    tailwindcss(),
    ],
  server: {
    allowedHosts: [
      'spotty-dogs-worry.loca.lt',
    ],
    host: true,
    port:5179
  }
})