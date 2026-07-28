"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken, clearToken } from "@/lib/api";

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const googleToken = params.get("token");
    if (googleToken) {
      setToken(googleToken);
      router.replace("/dashboard");
      return;
    }

    const existing = localStorage.getItem("auth_token");
    if (!existing) {
      router.replace("/login");
      return;
    }

    // Verify token is still valid by calling /auth/me
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${apiUrl}/auth/me`, {
      headers: { "Authorization": `Bearer ${existing}` },
    })
      .then((res) => {
        if (res.ok) {
          router.replace("/dashboard");
        } else {
          clearToken();
          router.replace("/login");
        }
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [router, params]);

  return null;
}

export default function RootPage() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
