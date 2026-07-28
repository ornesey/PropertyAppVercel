"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface RefItem { id: number; name: string; }
interface NoticeType { notice_type_id: number; code: string; description: string; }

// ─── Generic name-only ref section ───────────────────────────────────────────

function RefSection({ title, items, onAdd, onRename, onDelete }: {
  title: string;
  items: RefItem[];
  onAdd: (name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [newName, setNewName]       = useState("");
  const [adding, setAdding]         = useState(false);
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [editName, setEditName]     = useState("");
  const [confirmId, setConfirmId]   = useState<number | null>(null);
  const [error, setError]           = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError("");
    try {
      await onAdd(newName.trim());
      setNewName("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  async function rename(id: number) {
    if (!editName.trim()) return;
    try {
      await onRename(id, editName.trim());
      setEditingId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to rename");
    }
  }

  async function remove(id: number) {
    try {
      await onDelete(id);
      setConfirmId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cannot delete — item may be in use");
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>

      <form onSubmit={add} className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="New item name…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={adding}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-2 gap-3">
            {editingId === item.id ? (
              <div className="flex items-center gap-2 flex-1">
                <input value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => rename(item.id)} className="text-xs text-blue-600 hover:underline">Save</button>
                <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <>
                <span className="text-sm text-gray-700">{item.name}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => { setEditingId(item.id); setEditName(item.name); setError(""); }}
                    className="text-xs text-blue-600 hover:underline">Rename</button>
                  {confirmId === item.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <span className="text-red-600">Delete?</span>
                      <button onClick={() => remove(item.id)} className="text-red-700 font-semibold hover:underline">Yes</button>
                      <button onClick={() => setConfirmId(null)} className="text-gray-400 hover:underline">No</button>
                    </span>
                  ) : (
                    <button onClick={() => { setConfirmId(item.id); setError(""); }}
                      className="text-xs text-red-500 hover:underline">Delete</button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="py-2 text-sm text-gray-400">None yet.</li>}
      </ul>
    </div>
  );
}

// ─── Notice types section (code + description, inline edit) ──────────────────

function NoticeTypeSection({ items, onRefresh }: { items: NoticeType[]; onRefresh: () => void }) {
  const [newCode, setNewCode]   = useState("");
  const [newDesc, setNewDesc]   = useState("");
  const [adding, setAdding]     = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError]       = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newDesc.trim()) { setError("Code and description are required."); return; }
    setAdding(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/ref/notice-types", { code: newCode.trim(), description: newDesc.trim() });
      setNewCode(""); setNewDesc("");
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  async function save(id: number) {
    if (!editCode.trim() || !editDesc.trim()) { setError("Code and description are required."); return; }
    setError("");
    try {
      await api("PATCH", `/api/v1/rental/ref/notice-types/${id}`, { code: editCode.trim(), description: editDesc.trim() });
      setEditingId(null);
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: number) {
    setError("");
    try {
      await api("DELETE", `/api/v1/rental/ref/notice-types/${id}`);
      setConfirmId(null);
      onRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cannot delete — item may be in use");
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Notice Types</h2>
      <form onSubmit={add} className="grid grid-cols-3 gap-2">
        <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Code (e.g. N4)"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={adding}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {items.map((nt) => (
          <li key={nt.notice_type_id} className="py-2">
            {editingId === nt.notice_type_id ? (
              <div className="flex items-center gap-2">
                <input value={editCode} onChange={(e) => setEditCode(e.target.value)}
                  className="w-24 border border-gray-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => save(nt.notice_type_id)} className="text-xs text-blue-600 hover:underline">Save</button>
                <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-mono font-semibold text-gray-700 mr-3">{nt.code}</span>
                  <span className="text-sm text-gray-600">{nt.description}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => { setEditingId(nt.notice_type_id); setEditCode(nt.code); setEditDesc(nt.description); setError(""); }}
                    className="text-xs text-blue-600 hover:underline">Edit</button>
                  {confirmId === nt.notice_type_id ? (
                    <span className="flex items-center gap-1 text-xs">
                      <span className="text-red-600">Delete?</span>
                      <button onClick={() => remove(nt.notice_type_id)} className="text-red-700 font-semibold hover:underline">Yes</button>
                      <button onClick={() => setConfirmId(null)} className="text-gray-400 hover:underline">No</button>
                    </span>
                  ) : (
                    <button onClick={() => { setConfirmId(nt.notice_type_id); setError(""); }}
                      className="text-xs text-red-500 hover:underline">Delete</button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="py-2 text-sm text-gray-400">None yet.</li>}
      </ul>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [expenseTypes, setExpenseTypes]     = useState<RefItem[]>([]);
  const [maintCats, setMaintCats]           = useState<RefItem[]>([]);
  const [noticeTypes, setNoticeTypes]       = useState<NoticeType[]>([]);
  const [loading, setLoading]               = useState(true);

  async function load() {
    const [et, mc, nt] = await Promise.all([
      api<{ type_id: number; name: string }[]>("GET", "/api/v1/rental/ref/expense-types"),
      api<{ category_id: number; name: string }[]>("GET", "/api/v1/rental/ref/maintenance-categories"),
      api<NoticeType[]>("GET", "/api/v1/rental/ref/notice-types"),
    ]);
    setExpenseTypes(et.map((x) => ({ id: x.type_id, name: x.name })));
    setMaintCats(mc.map((x) => ({ id: x.category_id, name: x.name })));
    setNoticeTypes(nt);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <p className="text-sm text-gray-400">Manage reference data used across the app.</p>

      <RefSection
        title="Expense Types"
        items={expenseTypes}
        onAdd={async (name) => {
          await api("POST", "/api/v1/rental/ref/expense-types", { name });
          await load();
        }}
        onRename={async (id, name) => {
          await api("PATCH", `/api/v1/rental/ref/expense-types/${id}`, { name });
          await load();
        }}
        onDelete={async (id) => {
          await api("DELETE", `/api/v1/rental/ref/expense-types/${id}`);
          await load();
        }}
      />

      <RefSection
        title="Maintenance Categories"
        items={maintCats}
        onAdd={async (name) => {
          await api("POST", "/api/v1/rental/ref/maintenance-categories", { name });
          await load();
        }}
        onRename={async (id, name) => {
          await api("PATCH", `/api/v1/rental/ref/maintenance-categories/${id}`, { name });
          await load();
        }}
        onDelete={async (id) => {
          await api("DELETE", `/api/v1/rental/ref/maintenance-categories/${id}`);
          await load();
        }}
      />

      <NoticeTypeSection items={noticeTypes} onRefresh={load} />
    </div>
  );
}
