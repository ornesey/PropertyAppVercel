"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Lease, LeaseMember } from "@/types/lease";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NoticeType { notice_type_id: number; code: string; description: string; }
interface ServiceMethod { method_id: number; name: string; }
interface LegalNotice {
  notice_id: number;
  lease_id: number;
  notice_date: string;
  served_by: string;
  drive_url: string | null;
  notes: string | null;
  compliance_date: string | null;
  status: string;
  notice_type_code: string;
  notice_type_name: string;
  service_method_name: string;
  space_name: string;
  unit_number: string;
  address: string;
  recipients: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active:    "bg-yellow-100 text-yellow-700",
  void:      "bg-gray-100 text-gray-500",
  escalated: "bg-red-100 text-red-600",
};
const STATUS_DOT: Record<string, string> = {
  active: "🟡", void: "⚪", escalated: "🔴",
};

function ComplianceBadge({ date }: { date: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.round((new Date(date).getTime() - new Date(today).getTime()) / 86400000);
  if (daysLeft < 0) {
    return <span className="text-xs text-red-600 font-medium">⚠ {Math.abs(daysLeft)}d overdue</span>;
  }
  if (daysLeft <= 14) {
    return <span className="text-xs text-amber-600 font-medium">⏰ {daysLeft}d left</span>;
  }
  return <span className="text-xs text-gray-400">{date}</span>;
}

function Input({ label, value, onChange, type = "text", placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}{required && " *"}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}

function Select({ label, value, onChange, options, required }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}{required && " *"}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Notice row ───────────────────────────────────────────────────────────────

function NoticeRow({ notice, onChanged }: { notice: LegalNotice; onChanged: () => void }) {
  const [open, setOpen]           = useState(false);
  const [editing, setEditing]     = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]       = useState(false);

  const [compDate, setCompDate] = useState(notice.compliance_date?.slice(0, 10) ?? "");
  const [driveUrl, setDriveUrl] = useState(notice.drive_url ?? "");
  const [notes, setNotes]       = useState(notice.notes ?? "");

  async function patch(update: Record<string, unknown>) {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/legal-notices/${notice.notice_id}`, update);
    setSaving(false);
    onChanged();
  }

  async function saveEdit() {
    await patch({ compliance_date: compDate || null, drive_url: driveUrl || null, notes: notes || null });
    setEditing(false);
  }

  async function deleteNotice() {
    await api("DELETE", `/api/v1/rental/legal-notices/${notice.notice_id}`);
    onChanged();
  }

  const dot   = STATUS_DOT[notice.status]   ?? "⚪";
  const badge = STATUS_BADGE[notice.status] ?? "bg-gray-100 text-gray-500";

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Summary row */}
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span>{dot}</span>
            <span className="font-semibold text-gray-900">{notice.address}</span>
            <span className="text-sm text-gray-400">Unit {notice.unit_number} — {notice.space_name}</span>
            <span className="text-xs font-mono font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
              {notice.notice_type_code}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 pl-5 flex-wrap">
            <span>{notice.notice_date?.slice(0, 10)}</span>
            <span>via {notice.service_method_name}</span>
            <span>by {notice.served_by}</span>
            {notice.recipients.length > 0 && <span>→ {notice.recipients.join(", ")}</span>}
            {notice.compliance_date && <ComplianceBadge date={notice.compliance_date} />}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${badge}`}>
            {notice.status}
          </span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Detail panel */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {!editing && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>
                <span className="text-gray-400 text-xs">Type: </span>
                {notice.notice_type_code} — {notice.notice_type_name}
              </span>
              {notice.compliance_date && (
                <span>
                  <span className="text-gray-400 text-xs">Compliance: </span>
                  {notice.compliance_date}
                </span>
              )}
              {notice.drive_url && (
                <a href={notice.drive_url} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-xs">
                  📎 Document
                </a>
              )}
              {notice.notes && <span className="text-gray-400 italic text-xs w-full">{notice.notes}</span>}
            </div>
          )}

          {editing && (
            <div className="p-4 bg-gray-50 rounded-xl space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Compliance Date" value={compDate} onChange={setCompDate} type="date" />
                <Input label="Drive URL" value={driveUrl} onChange={setDriveUrl} placeholder="https://drive.google.com/…" />
              </div>
              <Input label="Notes" value={notes} onChange={setNotes} placeholder="Optional notes…" />
              <div className="flex gap-2">
                <button onClick={saveEdit} disabled={saving}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">
                Edit Details
              </button>
            )}
            {notice.status !== "void" && (
              <button onClick={() => patch({ status: "void" })} disabled={saving}
                className="text-xs text-gray-500 hover:underline disabled:opacity-50">
                Mark Void
              </button>
            )}
            {notice.status !== "escalated" && (
              <button onClick={() => patch({ status: "escalated" })} disabled={saving}
                className="text-xs text-red-500 hover:underline disabled:opacity-50">
                Mark Escalated
              </button>
            )}
            {notice.status !== "active" && (
              <button onClick={() => patch({ status: "active" })} disabled={saving}
                className="text-xs text-yellow-600 hover:underline disabled:opacity-50">
                Mark Active
              </button>
            )}
            {!confirming ? (
              <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Delete</button>
            ) : (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-red-600">Delete permanently?</span>
                <button onClick={deleteNotice} className="text-red-700 font-semibold hover:underline">Yes</button>
                <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">Cancel</button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add notice form ──────────────────────────────────────────────────────────

function AddNoticeForm({ leases, noticeTypes, serviceMethods, onAdded }: {
  leases: Lease[];
  noticeTypes: NoticeType[];
  serviceMethods: ServiceMethod[];
  onAdded: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen]               = useState(false);
  const [leaseId, setLeaseId]         = useState("");
  const [noticeTypeId, setNoticeTypeId] = useState("");
  const [noticeDate, setNoticeDate]   = useState(today);
  const [servedBy, setServedBy]       = useState("");
  const [methodId, setMethodId]       = useState("");
  const [compDate, setCompDate]       = useState("");
  const [driveUrl, setDriveUrl]       = useState("");
  const [notes, setNotes]             = useState("");
  const [tenantIds, setTenantIds]     = useState<number[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  useEffect(() => {
    if (leases.length && !leaseId) setLeaseId(String(leases[0].lease_id));
    if (noticeTypes.length && !noticeTypeId) setNoticeTypeId(String(noticeTypes[0].notice_type_id));
    if (serviceMethods.length && !methodId) setMethodId(String(serviceMethods[0].method_id));
  }, [leases, noticeTypes, serviceMethods, leaseId, noticeTypeId, methodId]);

  useEffect(() => { setTenantIds([]); }, [leaseId]);

  const selectedLeaseMembers = useMemo<LeaseMember[]>(() => {
    const lease = leases.find((l) => String(l.lease_id) === leaseId);
    return lease?.members ?? [];
  }, [leases, leaseId]);

  function toggleTenant(id: number) {
    setTenantIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!leaseId || !noticeTypeId || !methodId || !servedBy.trim()) {
      setError("Lease, notice type, service method, and served by are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/legal-notices", {
        lease_id:          Number(leaseId),
        notice_type_id:    Number(noticeTypeId),
        notice_date:       noticeDate,
        served_by:         servedBy.trim(),
        service_method_id: Number(methodId),
        compliance_date:   compDate || null,
        drive_url:         driveUrl || null,
        notes:             notes || null,
        tenant_ids:        tenantIds,
      });
      setOpen(false);
      setServedBy(""); setCompDate(""); setDriveUrl(""); setNotes(""); setTenantIds([]);
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create notice");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Issue Legal Notice
    </button>
  );

  const leaseOptions   = leases.map((l) => ({ value: String(l.lease_id), label: `${l.address} — Unit ${l.unit_number} — ${l.space_name}` }));
  const typeOptions    = noticeTypes.map((nt) => ({ value: String(nt.notice_type_id), label: `${nt.code} — ${nt.description}` }));
  const methodOptions  = serviceMethods.map((m) => ({ value: String(m.method_id), label: m.name }));

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-4">
      <p className="text-sm font-semibold text-gray-700">Issue Legal Notice</p>

      {leases.length === 0 ? (
        <p className="text-sm text-amber-700">No leases found. Create a lease first.</p>
      ) : (
        <>
          <Select label="Lease" value={leaseId} onChange={setLeaseId} options={leaseOptions} required />

          <div className="grid grid-cols-2 gap-3">
            <Select label="Notice Type" value={noticeTypeId} onChange={setNoticeTypeId} options={typeOptions} required />
            <Input label="Date of Notice" value={noticeDate} onChange={setNoticeDate} type="date" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Served By" value={servedBy} onChange={setServedBy} placeholder="Name of server" required />
            <Select label="Service Method" value={methodId} onChange={setMethodId} options={methodOptions} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Compliance Date (optional)" value={compDate} onChange={setCompDate} type="date" />
            <Input label="Drive URL (optional)" value={driveUrl} onChange={setDriveUrl} placeholder="https://drive.google.com/…" />
          </div>

          <Input label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Any additional notes…" />

          {selectedLeaseMembers.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Recipients</label>
              <div className="flex flex-wrap gap-3">
                {selectedLeaseMembers.map((m) => (
                  <label key={m.tenant_id} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox"
                      checked={tenantIds.includes(m.tenant_id)}
                      onChange={() => toggleTenant(m.tenant_id)}
                      className="rounded border-gray-300" />
                    {m.first_name} {m.last_name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Issuing…" : "Issue Notice"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
          </div>
        </>
      )}
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NoticesPage() {
  const router = useRouter();
  const [notices, setNotices]         = useState<LegalNotice[]>([]);
  const [leases, setLeases]           = useState<Lease[]>([]);
  const [noticeTypes, setNoticeTypes] = useState<NoticeType[]>([]);
  const [methods, setMethods]         = useState<ServiceMethod[]>([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "void" | "escalated">("all");

  async function load() {
    const [n, l, nt, m] = await Promise.all([
      api<LegalNotice[]>("GET", "/api/v1/rental/legal-notices"),
      api<Lease[]>("GET", "/api/v1/rental/leases/with-members"),
      api<NoticeType[]>("GET", "/api/v1/rental/ref/notice-types"),
      api<ServiceMethod[]>("GET", "/api/v1/rental/ref/service-methods"),
    ]);
    setNotices(n);
    setLeases(l);
    setNoticeTypes(nt);
    setMethods(m);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  const filtered = useMemo(() =>
    statusFilter === "all" ? notices : notices.filter((n) => n.status === statusFilter),
    [notices, statusFilter]
  );

  const counts = useMemo(() => ({
    all:       notices.length,
    active:    notices.filter((n) => n.status === "active").length,
    void:      notices.filter((n) => n.status === "void").length,
    escalated: notices.filter((n) => n.status === "escalated").length,
  }), [notices]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  const tabs: { key: "all" | "active" | "void" | "escalated"; label: string }[] = [
    { key: "all",       label: `All (${counts.all})` },
    { key: "active",    label: `Active (${counts.active})` },
    { key: "escalated", label: `Escalated (${counts.escalated})` },
    { key: "void",      label: `Void (${counts.void})` },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Legal Notices</h1>

      <AddNoticeForm
        leases={leases}
        noticeTypes={noticeTypes}
        serviceMethods={methods}
        onAdded={load}
      />

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">
          No notices{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => (
            <NoticeRow key={n.notice_id} notice={n} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
