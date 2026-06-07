import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 本地开发时,Vite 自带的 dev server 不会跑 /api 下的 serverless function。
// 所以本地调试有两种方式(部署指南里会讲):
//   方式A(推荐):用 `vercel dev` 启动,它会同时跑前端和 /api 函数
//   方式B:只跑前端 `npm run dev`,但 /api 调用会失败 —— 仅用于看 UI
export default defineConfig({
  plugins: [react()],
});
