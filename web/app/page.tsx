"use client";

import { useEffect } from "react";
import { initTelegramWebApp, isTelegramWebApp, getTelegramUser } from "@/lib/telegram-webapp";
import { useAuthStore } from "@/store/auth-store";

export default function Home() {
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    // Initialize Telegram Web App if running inside Telegram
    if (isTelegramWebApp()) {
      const webApp = initTelegramWebApp();
      if (webApp) {
        // Set theme based on Telegram theme
        webApp.onEvent("themeChanged", () => {
          const isDark = webApp.colorScheme === "dark";
          document.documentElement.classList.toggle("dark", isDark);
        });

        // Get Telegram user data
        const tgUser = getTelegramUser();
        if (tgUser) {
          console.log("Telegram User:", tgUser);
          // You can use this to authenticate the user
        }
      }
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <main className="w-full max-w-4xl space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">
            InterviewAI Pro
          </h1>
          <p className="text-lg text-muted-foreground">
            AI-powered interview preparation platform
          </p>
        </div>

        {isTelegramWebApp() ? (
          <div className="rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Running inside Telegram Web App
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Open this app from Telegram bot to get started
            </p>
          </div>
        )}

        {isAuthenticated && user ? (
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold mb-2">Welcome back!</h2>
            <p className="text-sm text-muted-foreground">
              {user.name || user.email || "User"}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Please sign in to continue
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
