"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface TeamMember {
  user_id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
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

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function AddMemberForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen]         = useState(false);
  const [email, setEmail]       = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole]         = useState("owner");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !fullName || !password) { setError("All fields are required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setSaving(true);
    setError("");
    try {
      const params = new URLSearchParams({ email, full_name: fullName, password, role });
      await api("POST", `/auth/create-user?${params}`);
      setOpen(false);
      setEmail(""); setFullName(""); setPassword("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Team Member
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-gray-700">New Team Member</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Full Name" value={fullName} onChange={setFullName} placeholder="Jane Smith" />
        <Input label="Email" value={email} onChange={setEmail} type="email" placeholder="jane@example.com" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Password" value={password} onChange={setPassword} type="password" />
        <Select label="Role" value={role} onChange={setRole}
          options={[{ value: "owner", label: "Owner" }, { value: "member", label: "Member" }]} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Creating…" : "Create User"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

export default function TeamPage() {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  async function load() {
    try {
      const m = await api<TeamMember[]>("GET", "/auth/users");
      setMembers(m);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;

  if (error) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-sm text-red-600">{error}</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <span className="text-sm text-gray-400">{members.length} member{members.length !== 1 ? "s" : ""}</span>
      </div>

      <AddMemberForm onAdded={load} />

      <div className="space-y-3">
        {members.map((m) => (
          <div key={m.user_id}
            className="flex items-center justify-between px-5 py-4 bg-white border border-gray-100 rounded-xl shadow-sm">
            <div>
              <p className="font-medium text-gray-900">{m.full_name}</p>
              <p className="text-sm text-gray-500">{m.email}</p>
              {m.last_login && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Last login: {new Date(m.last_login).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!m.is_active && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-400">Inactive</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded font-medium uppercase ${
                m.role === "owner" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
              }`}>
                {m.role}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Only owners can access this page. To remove a member, contact support.
      </p>
    </div>
  );
}
