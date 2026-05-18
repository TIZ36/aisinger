import "./globals.css";
import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";

export const metadata = {
  title: "aisinger",
  description: "AI 歌手复刻 — 单人本地工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body>
        <div className="grid h-screen grid-cols-[220px_1fr]">
          <Sidebar />
          <main className="overflow-y-auto bg-(--color-bg)">{children}</main>
        </div>
      </body>
    </html>
  );
}
