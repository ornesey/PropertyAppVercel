"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Lease, LeaseMember, LeaseStatus } from "@/types/lease";
import type { Tenant } from "@/types/tenant";
import type { Property, PropertyDetail } from "@/types/property";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<number, string> = {
  1: "bg-green-100 text-green-700",
  2: "bg-green-100 text-green-700",
  3: "bg-gray-100 text-gray-500",
  4: "bg-red-100 text-red-600",
};

const STATUS_DOT: Record<number, string> = {
  1: "🟢", 2: "🟢", 3: "⚪", 4: "🔴",
};

function Input({ label, value, onChange, type = "text", placeholder, min, step }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; min?: string; step?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} min={min} step={step}
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

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({ member, onChanged }: { member: LeaseMember; onChanged: () => void }) {
  const [editing, setEditing]       = useState(false);
  const [obligation, setObligation] = useState(String(member.monthly_obligation));
  const [isPrimary, setIsPrimary]   = useState(member.is_primary);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]         = useState(false);

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/lease-members/${member.member_id}`, {
      monthly_obligation: Number(obligation),
      is_primary: isPrimary,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  async function remove() {
    await api("DELETE", `/api/v1/rental/lease-members/${member.member_id}`);
    onChanged();
  }

  const name = `${member.first_name} ${member.last_name}`;

  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        {member.is_primary && <span title="Primary" className="text-yellow-500">⭐</span>}
        {member.member_type === "sublessee" && <span title="Sublessee" className="text-blue-400">🔄</span>}
        <span className="font-medium text-gray-800">{name}</span>
        <span className="text-gray-400">${Number(member.monthly_obligation).toLocaleString()}/mo</span>
        {member.sublease_start && (
          <span className="text-xs text-gray-400">
            {member.sublease_start} → {member.sublease_end ?? "—"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
          {editing ? "Cancel" : "Edit"}
        </button>
        {!confirming
          ? <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Remove</button>
          : <span className="text-xs flex items-center gap-1">
              <span className="text-red-600">Sure?</span>
              <button onClick={remove} className="text-red-700 font-semibold hover:underline">Yes</button>
              <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">No</button>
            </span>
        }
      </div>
      {editing && (
        <div className="w-full col-span-2 flex items-end gap-3 mt-2">
          <Input label="$/mo" value={obligation} onChange={setObligation} type="number" min="0" step="25" />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 pb-1.5 cursor-pointer">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)}
              className="rounded border-gray-300" />
            Primary
          </label>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 mb-0.5">
            {saving ? "…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Add member form ──────────────────────────────────────────────────────────

function AddMemberForm({ leaseId, tenants, onAdded }: {
  leaseId: number;
  tenants: Tenant[];
  onAdded: () => void;
}) {
  const [open, setOpen]             = useState(false);
  const [tenantId, setTenantId]     = useState("");
  const [obligation, setObligation] = useState("0");
  const [isPrimary, setIsPrimary]   = useState(false);
  const [memberType, setMemberType] = useState("tenant");
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (tenants.length && !tenantId) setTenantId(String(tenants[0].tenant_id));
  }, [tenants, tenantId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await api("POST", `/api/v1/rental/leases/${leaseId}/members`, {
      tenant_id: Number(tenantId),
      monthly_obligation: Number(obligation),
      is_primary: isPrimary,
      member_type: memberType,
    });
    setSaving(false);
    setOpen(false);
    onAdded();
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="text-xs text-blue-600 hover:underline">
      + Add Member
    </button>
  );

  return (
    <form onSubmit={submit} className="mt-3 p-3 bg-gray-50 rounded-xl space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Tenant" value={tenantId} onChange={setTenantId}
          options={tenants.map((t) => ({ value: String(t.tenant_id), label: `${t.first_name} ${t.last_name}` }))} />
        <Input label="Monthly Obligation ($)" value={obligation} onChange={setObligation} type="number" min="0" step="25" />
      </div>
      <div className="flex items-center gap-4">
        <Select label="Type" value={memberType} onChange={setMemberType}
          options={[{ value: "tenant", label: "Tenant" }, { value: "sublessee", label: "Sublessee" }]} />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 mt-5 cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)}
            className="rounded border-gray-300" />
          Primary
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Member"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Lease row ────────────────────────────────────────────────────────────────

function LeaseRow({ lease, statuses, tenants, onChanged }: {
  lease: Lease;
  statuses: LeaseStatus[];
  tenants: Tenant[];
  onChanged: () => void;
}) {
  const [open, setOpen]             = useState(false);
  const [editing, setEditing]       = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]         = useState(false);

  const [rent, setRent]           = useState(String(lease.total_rent));
  const [statusCode, setStatusCode] = useState(String(lease.status_code));
  const [startDate, setStartDate] = useState(lease.start_date?.slice(0, 10) ?? "");
  const [endDate, setEndDate]     = useState(lease.end_date?.slice(0, 10) ?? "");
  const [lmr, setLmr]             = useState(String(lease.lmr_deposit ?? 0));
  const [notes, setNotes]         = useState(lease.notes ?? "");

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/leases/${lease.lease_id}`, {
      total_rent: Number(rent),
      status_code: Number(statusCode),
      start_date: startDate,
      end_date: endDate || null,
      lmr_deposit: Number(lmr) || null,
      notes: notes || null,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  async function deleteLease() {
    await api("DELETE", `/api/v1/rental/leases/${lease.lease_id}`);
    onChanged();
  }

  const dot = STATUS_DOT[lease.status_code] ?? "⚪";
  const statusColor = STATUS_COLORS[lease.status_code] ?? "bg-gray-100 text-gray-500";
  const memberNames = lease.members.map((m) => `${m.first_name} ${m.last_name}`).join(", ");

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Summary row */}
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span>{dot}</span>
            <span className="font-semibold text-gray-900">{lease.address}</span>
            <span className="text-sm text-gray-400">Unit {lease.unit_number} — {lease.space_name}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 pl-5">
            <span>${Number(lease.total_rent).toLocaleString()}/mo</span>
            <span>{lease.start_date?.slice(0, 10)} → {lease.end_date?.slice(0, 10) ?? "ongoing"}</span>
            {memberNames && <span>{memberNames}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor}`}>
            {lease.status_label}
          </span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Detail panel */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5">

          {/* Members */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Members</p>
            {lease.members.length === 0
              ? <p className="text-sm text-gray-400">No members yet.</p>
              : <div className="divide-y divide-gray-100">
                  {lease.members.map((m) => (
                    <MemberRow key={m.member_id} member={m} onChanged={onChanged} />
                  ))}
                </div>
            }
            <AddMemberForm leaseId={lease.lease_id} tenants={tenants} onAdded={onChanged} />
          </div>

          {/* Lease edit */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Lease Details</p>
              <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
                {editing ? "Cancel" : "Edit"}
              </button>
            </div>

            {!editing && (
              <div className="flex gap-6 text-sm text-gray-600">
                {lease.security_deposit && <span>Security: ${Number(lease.security_deposit).toLocaleString()}</span>}
                {lease.lmr_deposit && <span>LMR: ${Number(lease.lmr_deposit).toLocaleString()}</span>}
                {lease.notes && <span className="text-gray-400 italic">{lease.notes}</span>}
              </div>
            )}

            {editing && (
              <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
                <div className="grid grid-cols-3 gap-3">
                  <Input label="Total Rent ($)" value={rent} onChange={setRent} type="number" min="0" step="50" />
                  <Select label="Status" value={statusCode} onChange={setStatusCode}
                    options={statuses.map((s) => ({ value: String(s.code), label: s.label }))} />
                  <Input label="LMR Deposit ($)" value={lmr} onChange={setLmr} type="number" min="0" step="50" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Start Date" value={startDate} onChange={setStartDate} type="date" />
                  <Input label="End Date" value={endDate} onChange={setEndDate} type="date" />
                </div>
                <Input label="Notes" value={notes} onChange={setNotes} />
                <div className="flex items-center gap-3">
                  <button onClick={save} disabled={saving}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {saving ? "Saving…" : "Save"}
                  </button>
                  {!confirming
                    ? <button onClick={() => setConfirming(true)} className="text-xs text-red-600 hover:underline">Delete Lease</button>
                    : <span className="flex items-center gap-2 text-xs">
                        <span className="text-red-600">Delete this lease permanently?</span>
                        <button onClick={deleteLease} className="text-red-700 font-semibold hover:underline">Yes</button>
                        <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">Cancel</button>
                      </span>
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add lease form ───────────────────────────────────────────────────────────

interface SpaceOption {
  space_id: number;
  label: string;
}

function AddLeaseForm({ spaces, statuses, onAdded }: {
  spaces: SpaceOption[];
  statuses: LeaseStatus[];
  onAdded: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen]           = useState(false);
  const [spaceId, setSpaceId]     = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate]     = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [rent, setRent]           = useState("0");
  const [deposit, setDeposit]     = useState("0");
  const [lmr, setLmr]             = useState("0");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  useEffect(() => {
    if (spaces.length && !spaceId) setSpaceId(String(spaces[0].space_id));
    if (statuses.length && !statusCode) {
      const fixed = statuses.find((s) => s.label.toLowerCase().includes("fixed"));
      setStatusCode(String(fixed?.code ?? statuses[0].code));
    }
  }, [spaces, statuses, spaceId, statusCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!spaceId) { setError("Select a space."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/leases", {
        space_id: Number(spaceId),
        start_date: startDate,
        end_date: endDate || null,
        lease_type_code: Number(statusCode),
        status_code: Number(statusCode),
        total_rent: Number(rent),
        security_deposit: Number(deposit) || null,
        lmr_deposit: Number(lmr) || null,
        notes: notes || null,
      });
      setOpen(false);
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create lease");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Create Lease
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-4">
      <p className="text-sm font-semibold text-gray-700">New Lease</p>
      {spaces.length === 0
        ? <p className="text-sm text-amber-700">Add properties, units and spaces first.</p>
        : <>
            <Select label="Rentable Space" value={spaceId} onChange={setSpaceId}
              options={spaces.map((s) => ({ value: String(s.space_id), label: s.label }))} />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Start Date" value={startDate} onChange={setStartDate} type="date" />
              <Input label="End Date (optional)" value={endDate} onChange={setEndDate} type="date" />
              <Select label="Lease Type" value={statusCode} onChange={setStatusCode}
                options={statuses.map((s) => ({ value: String(s.code), label: s.label }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Total Rent ($)" value={rent} onChange={setRent} type="number" min="0" step="50" />
              <Input label="Security Deposit ($)" value={deposit} onChange={setDeposit} type="number" min="0" step="50" />
              <Input label="LMR Deposit ($)" value={lmr} onChange={setLmr} type="number" min="0" step="50" />
            </div>
            <Input label="Notes" value={notes} onChange={setNotes} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={saving}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Creating…" : "Create Lease"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
            </div>
          </>
      }
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface LeaseTask {
  task_id: number;
  lease_id: number;
  task_type: string;
  due_date: string;
  status: string;
  notes: string | null;
  space_name: string;
  unit_number: string;
  address: string;
  days_until_due: number;
}

function LeasesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leases, setLeases]     = useState<Lease[]>([]);
  const [statuses, setStatuses] = useState<LeaseStatus[]>([]);
  const [tenants, setTenants]   = useState<Tenant[]>([]);
  const [spaces, setSpaces]     = useState<SpaceOption[]>([]);
  const [leaseTasks, setLeaseTasks] = useState<LeaseTask[]>([]);
  const [loading, setLoading]   = useState(true);
  const [propFilter, setPropFilter]     = useState("All");
  const [tenantSearch, setTenantSearch] = useState("");
  const [tab, setTab]           = useState<"active" | "past" | "tasks">("active");

  async function load() {
    const [l, s, t, props, tasks] = await Promise.all([
      api<Lease[]>("GET", "/api/v1/rental/leases/with-members"),
      api<LeaseStatus[]>("GET", "/api/v1/rental/ref/lease-statuses"),
      api<Tenant[]>("GET", "/api/v1/rental/tenants"),
      api<PropertyDetail[]>("GET", "/api/v1/rental/properties/with-units-and-spaces"),
      api<LeaseTask[]>("GET", "/api/v1/rental/lease-tasks"),
    ]);
    setLeases(l);
    setStatuses(s);
    setTenants(t);
    setLeaseTasks(tasks);

    const spaceList: SpaceOption[] = [];
    for (const prop of props) {
      for (const unit of prop.units ?? []) {
        for (const space of unit.spaces ?? []) {
          spaceList.push({
            space_id: space.space_id,
            label: `${prop.address} — Unit ${unit.unit_number} — ${space.space_name}`,
          });
        }
      }
    }
    setSpaces(spaceList);
    setLoading(false);
  }

  async function completeTask(taskId: number) {
    await api("PATCH", `/api/v1/rental/lease-tasks/${taskId}`, { status: "completed" });
    load();
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    if (searchParams.get("tab") === "tasks") setTab("tasks");
    load();
  }, [router]);

  const properties = useMemo(() =>
    ["All", ...Array.from(new Set(leases.map((l) => l.address)))],
    [leases]
  );

  const filtered = useMemo(() => {
    let list = leases;
    if (propFilter !== "All") list = list.filter((l) => l.address === propFilter);
    if (tenantSearch) {
      const q = tenantSearch.toLowerCase();
      list = list.filter((l) =>
        l.members.some((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q))
      );
    }
    return list;
  }, [leases, propFilter, tenantSearch]);

  const ACTIVE_LABELS = ["active", "fixed term", "fixed-term", "month-to-month", "month to month"];
  const isActive = (l: Lease) =>
    ACTIVE_LABELS.some((lbl) => l.status_label?.toLowerCase().includes(lbl));
  const active = filtered.filter(isActive);
  const past   = filtered.filter((l) => !isActive(l));
  const shown  = tab === "active" ? active : tab === "past" ? past : [];

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Leases</h1>

      {tab !== "tasks" && <AddLeaseForm spaces={spaces} statuses={statuses} onAdded={load} />}

      {/* Filters — only for lease tabs */}
      {tab !== "tasks" && (
        <div className="flex gap-3">
          <input value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)}
            placeholder="Search by tenant name…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={propFilter} onChange={(e) => setPropFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {properties.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setTab("active")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "active" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          Active ({active.length})
        </button>
        <button onClick={() => setTab("past")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "past" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          Past ({past.length})
        </button>
        <button onClick={() => setTab("tasks")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "tasks" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          Tasks
          {leaseTasks.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">{leaseTasks.length}</span>
          )}
        </button>
      </div>

      {/* Tasks tab */}
      {tab === "tasks" && (
        <div className="space-y-3">
          {leaseTasks.length === 0 ? (
            <p className="text-sm text-gray-400">No open lease tasks.</p>
          ) : (
            leaseTasks.map((task) => {
              const overdue = task.days_until_due < 0;
              const dueSoon = task.days_until_due >= 0 && task.days_until_due <= 7;
              const rowStyle = overdue
                ? "border-red-200 bg-red-50"
                : dueSoon ? "border-yellow-200 bg-yellow-50" : "border-gray-200 bg-white";
              return (
                <div key={task.task_id} className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${rowStyle}`}>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{task.task_type}</span>
                    <span className="text-xs text-gray-500">{task.address} — Unit {task.unit_number} — {task.space_name}</span>
                    {task.notes && <span className="text-xs text-gray-400 mt-0.5">{task.notes}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Due</p>
                      <p className={`text-sm font-medium ${overdue ? "text-red-700" : "text-gray-900"}`}>{task.due_date}</p>
                      {overdue && <p className="text-xs text-red-500">{Math.abs(task.days_until_due)}d overdue</p>}
                      {!overdue && dueSoon && <p className="text-xs text-yellow-600">Due in {task.days_until_due}d</p>}
                    </div>
                    <button
                      onClick={() => completeTask(task.task_id)}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Complete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Lease list */}
      {tab !== "tasks" && (
        shown.length === 0 ? (
          <p className="text-sm text-gray-400">
            {propFilter !== "All" || tenantSearch ? "No leases match the current filter." : `No ${tab} leases.`}
          </p>
        ) : (
          <div className="space-y-3">
            {shown.map((l) => (
              <LeaseRow key={l.lease_id} lease={l} statuses={statuses} tenants={tenants} onChanged={load} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default function LeasesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>}>
      <LeasesPageInner />
    </Suspense>
  );
}
