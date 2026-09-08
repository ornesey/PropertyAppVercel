"use client";

import Sidebar from "@/components/Sidebar";
import { clearToken } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const redirecting = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      const token = localStorage.getItem("auth_token");
      if (!token) {
        clearToken();
        router.replace("/login");
        return;
      }

      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (!response.ok) throw new Error("Session expired");
        if (mounted) setChecking(false);
      } catch {
        if (!redirecting.current) {
          redirecting.current = true;
          clearToken();
          window.location.replace("/login");
        }
      }
    }

    checkSession();
    const interval = window.setInterval(checkSession, 60_000);
    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", checkSession);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, [router]);

  if (checking) return null;
  return <>{children}</>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGuard>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-8 py-8 pt-16 md:pt-8">
            {children}
          </div>
        </main>
      </div>
    </SessionGuard>
  );
}
