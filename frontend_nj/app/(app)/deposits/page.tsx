"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Lease } from "@/types/lease";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Deposit {
  deposit_id: number;
  lease_id: number;
  tenant_id: number;
  amount: number;
  paid_date: string;
  status: "held" | "applied";
  applied_ledger_id: number | null;
  notes: string | null;
  tenant_name: string;
  space_name: string;
  unit_number: string;
  address: string;
  applied_due_date: string | null;
}

interface LedgerEntry {
  ledger_id: number;
  due_date: string;
  amount_due: number;
  amount_paid: number | null;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `$${Number(n).toLocaleString()}`;
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

// ─── Apply panel (inline) ─────────────────────────────────────────────────────

function ApplyPanel({ deposit, onApplied, onCancel }: {
  deposit: Deposit;
  onApplied: () => void;
  onCancel: () => void;
}) {
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[] | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<LedgerEntry[]>("GET", `/api/v1/rental/ledger?tenant_id=${deposit.tenant_id}`)
      .then((entries) => {
        const open = entries.filter((e) => e.status !== "paid");
        setLedgerEntries(open);
        if (open.length) setSelectedLedgerId(String(open[0].ledger_id));
      });
  }, [deposit.tenant_id]);

  async function apply() {
    if (!selectedLedgerId) return;
    setSaving(true);
    await api("PATCH", `/api/v1/rental/deposits/${deposit.deposit_id}/apply`, {
      ledger_id: Number(selectedLedgerId),
    });
    setSaving(false);
    onApplied();
  }

  if (!ledgerEntries) return <p className="text-xs text-gray-400 animate-pulse">Loading rent months…</p>;

  if (ledgerEntries.length === 0) return (
    <div className="text-xs space-y-2">
      <p className="text-amber-700">No open rent months found for this tenant. Generate a rent entry first.</p>
      <button onClick={onCancel} className="text-gray-400 hover:underline">Cancel</button>
    </div>
  );

  const options = ledgerEntries.map((e) => ({
    value: String(e.ledger_id),
    label: `${e.due_date?.slice(0, 7)} — ${fmt(e.amount_due)} (${e.status})`,
  }));

  return (
    <div className="p-3 bg-blue-50 rounded-lg space-y-3">
      <p className="text-xs font-medium text-gray-700">Apply deposit to which rent month?</p>
      <Select label="Rent month" value={selectedLedgerId} onChange={setSelectedLedgerId} options={options} />
      <div className="flex gap-2">
        <button onClick={apply} disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Applying…" : "Confirm Apply"}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

// ─── Deposit row ──────────────────────────────────────────────────────────────

function DepositRow({ deposit, onChanged }: { deposit: Deposit; onChanged: () => void }) {
  const [applying, setApplying]   = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function deleteDeposit() {
    await api("DELETE", `/api/v1/rental/deposits/${deposit.deposit_id}`);
    onChanged();
  }

  const isHeld    = deposit.status === "held";
  const statusBadge = isHeld
    ? "bg-green-100 text-green-700"
    : "bg-gray-100 text-gray-500";

  return (
    <div className="border border-gray-200 rounded-xl bg-white px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">{deposit.tenant_name}</span>
            <span className="text-xs text-gray-400">{deposit.address} — Unit {deposit.unit_number} — {deposit.space_name}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            <span>Received {deposit.paid_date?.slice(0, 10)}</span>
            <span className="font-semibold text-gray-800">{fmt(deposit.amount)}</span>
            {deposit.notes && <span className="italic text-gray-400">{deposit.notes}</span>}
            {deposit.applied_due_date && (
              <span className="text-gray-400">→ applied to {deposit.applied_due_date?.slice(0, 7)} rent</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusBadge}`}>
            {isHeld ? "Held" : "Applied"}
          </span>
          {isHeld && !applying && (
            <button onClick={() => setApplying(true)} className="text-xs text-blue-600 hover:underline">
              Apply to rent
            </button>
          )}
          {isHeld && !confirming && !applying && (
            <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Delete</button>
          )}
          {confirming && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-red-600">Delete?</span>
              <button onClick={deleteDeposit} className="text-red-700 font-semibold hover:underline">Yes</button>
              <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">No</button>
            </span>
          )}
        </div>
      </div>

      {applying && (
        <ApplyPanel
          deposit={deposit}
          onApplied={() => { setApplying(false); onChanged(); }}
          onCancel={() => setApplying(false)}
        />
      )}
    </div>
  );
}

// ─── Record deposit form ──────────────────────────────────────────────────────

function RecordDepositForm({ leases, onAdded }: { leases: Lease[]; onAdded: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen]         = useState(false);
  const [leaseId, setLeaseId]   = useState("");
  const [tenantId, setTenantId] = useState("");
  const [amount, setAmount]     = useState("");
  const [paidDate, setPaidDate] = useState(today);
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  // Active leases with members
  const ACTIVE_LABELS = ["active", "fixed term", "fixed-term", "month-to-month", "month to month"];
  const activeLeases = leases.filter((l) =>
    ACTIVE_LABELS.some((lbl) => l.status_label?.toLowerCase().includes(lbl))
  );

  useEffect(() => {
    if (activeLeases.length && !leaseId) {
      setLeaseId(String(activeLeases[0].lease_id));
    }
  }, [activeLeases, leaseId]);

  const selectedLease = useMemo(
    () => activeLeases.find((l) => String(l.lease_id) === leaseId),
    [activeLeases, leaseId]
  );

  useEffect(() => {
    if (selectedLease?.members.length) {
      setTenantId(String(selectedLease.members[0].tenant_id));
    } else {
      setTenantId("");
    }
  }, [selectedLease]);

  const leaseOptions = activeLeases.map((l) => ({
    value: String(l.lease_id),
    label: `${l.address} — Unit ${l.unit_number} — ${l.space_name}`,
  }));

  const tenantOptions = (selectedLease?.members ?? []).map((m) => ({
    value: String(m.tenant_id),
    label: `${m.first_name} ${m.last_name}`,
  }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!leaseId || !tenantId || !amount) { setError("Lease, tenant, and amount are required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/deposits", {
        lease_id: Number(leaseId),
        tenant_id: Number(tenantId),
        amount: Number(amount),
        paid_date: paidDate,
        notes: notes || null,
      });
      setOpen(false);
      setAmount(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record deposit");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Record Deposit
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-4">
      <p className="text-sm font-semibold text-gray-700">Record LMR Deposit</p>

      {activeLeases.length === 0 ? (
        <p className="text-sm text-amber-700">No active leases found.</p>
      ) : (
        <>
          <Select label="Lease" value={leaseId} onChange={setLeaseId} options={leaseOptions} required />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tenant" value={tenantId} onChange={setTenantId} options={tenantOptions} required />
            <Input label="Amount ($)" value={amount} onChange={setAmount} type="number" placeholder="0.00" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date Received" value={paidDate} onChange={setPaidDate} type="date" required />
            <Input label="Notes (optional)" value={notes} onChange={setNotes} placeholder="e.g. first month move-in" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Record Deposit"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
          </div>
        </>
      )}
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DepositsPage() {
  const router = useRouter();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [leases, setLeases]     = useState<Lease[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<"all" | "held" | "applied">("all");

  async function load() {
    const [d, l] = await Promise.all([
      api<Deposit[]>("GET", "/api/v1/rental/deposits"),
      api<Lease[]>("GET", "/api/v1/rental/leases/with-members"),
    ]);
    setDeposits(d);
    setLeases(l);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  const filtered = useMemo(() =>
    filter === "all" ? deposits : deposits.filter((d) => d.status === filter),
    [deposits, filter]
  );

  const totalHeld    = useMemo(() => deposits.filter((d) => d.status === "held").reduce((s, d) => s + Number(d.amount), 0), [deposits]);
  const totalApplied = useMemo(() => deposits.filter((d) => d.status === "applied").reduce((s, d) => s + Number(d.amount), 0), [deposits]);
  const countHeld    = useMemo(() => deposits.filter((d) => d.status === "held").length, [deposits]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;

  const tabs: { key: "all" | "held" | "applied"; label: string }[] = [
    { key: "all",     label: `All (${deposits.length})` },
    { key: "held",    label: `Held (${deposits.filter((d) => d.status === "held").length})` },
    { key: "applied", label: `Applied (${deposits.filter((d) => d.status === "applied").length})` },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Last Month Deposits</h1>

      {/* Summary metrics */}
      {deposits.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Held (liability)", value: fmt(totalHeld), sub: `${countHeld} tenant${countHeld !== 1 ? "s" : ""}` },
            { label: "Applied (used)", value: fmt(totalApplied) },
            { label: "Total received", value: fmt(totalHeld + totalApplied) },
          ].map((m) => (
            <div key={m.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{m.label}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{m.value}</p>
              {m.sub && <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>}
            </div>
          ))}
        </div>
      )}

      <RecordDepositForm leases={leases} onAdded={load} />

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">
          No deposits{filter !== "all" ? ` with status "${filter}"` : ""}.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => (
            <DepositRow key={d.deposit_id} deposit={d} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
