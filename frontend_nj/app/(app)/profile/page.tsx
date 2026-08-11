"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearToken } from "@/lib/api";

interface User {
  sub: string;
  org_id: number;
  email: string;
  role: string;
  name: string;
  theme?: string;
  company_name?: string;
  avatar_url?: string;
}

function Input({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function StatusMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  const ok = msg.startsWith("✅");
  return (
    <p className={`text-xs font-medium ${ok ? "text-green-600" : "text-red-600"}`}>{msg}</p>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser]     = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile fields
  const [name, setName]         = useState("");
  const [company, setCompany]   = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg]       = useState("");

  // Password fields
  const [newPw, setNewPw]       = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg]       = useState("");

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    api<User>("GET", "/auth/me").then((u) => {
      // JWT is minted at login and never refreshed — merge saved overrides from localStorage
      const savedName    = localStorage.getItem("profile_name");
      const savedCompany = localStorage.getItem("profile_company");
      setUser(u);
      setName(savedName    ?? u.name         ?? "");
      setCompany(savedCompany ?? u.company_name ?? "");
      setLoading(false);
    });
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg("");
    try {
      // Send each field independently to avoid the backend's "Nothing to update" 400
      // when one of the two is empty
      const payload: Record<string, string> = {};
      if (name.trim())    payload.full_name    = name.trim();
      if (company.trim()) payload.company_name = company.trim();
      if (!Object.keys(payload).length) {
        setProfileMsg("❌ Please enter a name or company.");
        return;
      }
      await api("PATCH", "/auth/profile", payload);
      if (payload.full_name)    localStorage.setItem("profile_name",    payload.full_name);
      if (payload.company_name) localStorage.setItem("profile_company", payload.company_name);
      setProfileMsg("✅ Profile updated.");
    } catch (err: unknown) {
      setProfileMsg(`❌ ${err instanceof Error ? err.message : "Failed to update profile."}`);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwMsg("❌ Passwords do not match."); return; }
    if (newPw.length < 8)    { setPwMsg("❌ Password must be at least 8 characters."); return; }
    setSavingPw(true);
    setPwMsg("");
    try {
      await api("PATCH", "/auth/profile", { password: newPw });
      setNewPw(""); setConfirmPw("");
      setPwMsg("✅ Password changed.");
    } catch (err: unknown) {
      setPwMsg(`❌ ${err instanceof Error ? err.message : "Failed to change password."}`);
    } finally {
      setSavingPw(false);
    }
  }

  function signOut() {
    clearToken();
    router.push("/login");
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>

      {/* Identity strip */}
      <div className="flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-xl shadow-sm">
        {user?.avatar_url && (
          <img src={user.avatar_url} alt="" className="w-12 h-12 rounded-full" />
        )}
        <div>
          <p className="font-semibold text-gray-900">{user?.name}</p>
          <p className="text-sm text-gray-500">{user?.email}</p>
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium uppercase">
            {user?.role}
          </span>
        </div>
      </div>

      {/* Update profile */}
      <section className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Update Profile</h2>
        <form onSubmit={saveProfile} className="space-y-3">
          <Input label="Full Name" value={name} onChange={setName} placeholder="Jane Smith" />
          <Input label="Company / Organisation Name" value={company} onChange={setCompany}
            placeholder="Acme Rentals" />
          <p className="text-xs text-gray-400">Company name appears in the sidebar and browser tab.</p>
          <StatusMsg msg={profileMsg} />
          <button type="submit" disabled={savingProfile}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {savingProfile ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      {/* Change password */}
      <section className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Change Password</h2>
        <form onSubmit={savePassword} className="space-y-3">
          <Input label="New Password" value={newPw} onChange={setNewPw} type="password" />
          <Input label="Confirm Password" value={confirmPw} onChange={setConfirmPw} type="password" />
          <StatusMsg msg={pwMsg} />
          <button type="submit" disabled={savingPw}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {savingPw ? "Saving…" : "Change Password"}
          </button>
        </form>
      </section>

      {/* Sign out */}
      <button onClick={signOut}
        className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
        🚪 Sign Out
      </button>
    </div>
  );
}
