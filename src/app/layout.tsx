import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIS · Project InSight",
  description: "项目计划制定与追踪：WBS 分解、依赖排期、初验点冲击分析",
};

const PRIMARY_NAV: ReadonlyArray<{ label: string; href?: string; active?: boolean }> = [
  { label: "项目", href: "/", active: true },
  { label: "资源" },
  { label: "审计" },
  { label: "用户" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/85 backdrop-blur">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <Link href="/" className="shrink-0 transition hover:opacity-95">
                  <Logo />
                </Link>

                <div className="min-w-0 shrink-0 leading-tight">
                  <div className="text-sm font-semibold tracking-[0.06em] text-fg">
                    Project <span className="text-[#ef6f08]">In</span>Sight
                  </div>
                  <div className="mt-1 text-[11px] text-faint">目标为中心</div>
                </div>

                <nav aria-label="一级功能区" className="flex min-w-0 flex-wrap items-center gap-2">
                  {PRIMARY_NAV.map((item) =>
                    item.href ? (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                          item.active
                            ? "border-accent/40 bg-gradient-to-r from-accent/20 to-accent-2/10 text-accent shadow-[0_0_20px_-10px_rgba(56,189,248,0.9)]"
                            : "border-line bg-elevated/55 text-muted hover:border-accent/30 hover:text-fg"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span
                        key={item.label}
                        className="inline-flex items-center rounded-lg border border-line bg-elevated/45 px-3 py-1.5 text-sm font-medium text-muted"
                      >
                        {item.label}
                      </span>
                    ),
                  )}
                </nav>
              </div>

              <div className="flex items-center justify-end">
                <details className="group relative">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-line bg-panel/70 px-3 py-1.5 text-left transition hover:border-accent/30 hover:bg-panel">
                    <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-accent/25 to-accent-2/20 font-semibold text-accent">
                      ZG
                    </div>
                    <div className="leading-tight">
                      <div className="text-sm font-medium text-fg">zhenggsh</div>
                      <div className="text-[11px] text-faint">SSO / PMO 管理员</div>
                    </div>
                    <span className="text-[11px] text-faint transition group-open:rotate-180">▼</span>
                  </summary>

                  <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-64 rounded-xl border border-line bg-panel/95 p-2 shadow-[0_18px_48px_-18px_rgba(0,0,0,0.75)] backdrop-blur">
                    <div className="rounded-lg border border-line-soft bg-elevated/55 px-3 py-2">
                      <div className="text-sm font-medium text-fg">zhenggsh</div>
                      <div className="mt-0.5 text-[11px] text-faint">Single Sign-On / PMO 管理员</div>
                    </div>

                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted">
                        <span>登录状态</span>
                        <span className="pis-chip border-ok/30 bg-ok/10 text-ok">SSO 已登录</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted">
                        <span>组织</span>
                        <span className="text-fg">PIS Workspace</span>
                      </div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-elevated/70 hover:text-fg"
                      >
                        <span>用户信息</span>
                        <span className="text-faint">查看</span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-elevated/70 hover:text-fg"
                      >
                        <span>个人设置</span>
                        <span className="text-faint">进入</span>
                      </button>
                    </div>

                    <div className="mt-2 border-t border-line-soft pt-2">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-danger transition hover:bg-danger/10"
                      >
                        <span>退出</span>
                        <span className="text-danger/70">Sign out</span>
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-5">
          {children}
        </main>
      </body>
    </html>
  );
}
