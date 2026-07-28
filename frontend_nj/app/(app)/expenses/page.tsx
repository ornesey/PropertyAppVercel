"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Expense, ExpenseSummary, ExpenseType, FixedCost } from "@/types/expense";
import type { Property } from "@/types/property";
import type { Vendor } from "@/types/maintenance";

const today = new Date().toISOString().slice(0, 10);
const currentYear  = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

function fmt(n: number) { return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

// ─── Shared primitives ────────────────────────────────────────────────────────

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

function Select({ label, value, onChange, options, nullable }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; nullable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {nullable && <option value="">— None —</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Summary tiles ────────────────────────────────────────────────────────────

function SummaryTiles({ summary }: { summary: ExpenseSummary }) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(summary.total)}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {summary.by_type.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">By Type</p>
            <div className="space-y-1.5">
              {summary.by_type.map((t) => (
                <div key={t.expense_type} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t.expense_type}</span>
                  <span className="font-medium text-gray-900">{fmt(t.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {summary.by_property.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">By Property</p>
            <div className="space-y-1.5">
              {summary.by_property.map((p) => (
                <div key={p.property} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 truncate">{p.property}</span>
                  <span className="font-medium text-gray-900 ml-2">{fmt(p.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Expense row ──────────────────────────────────────────────────────────────

function ExpenseRow({ expense, expenseTypes, properties, vendors, onChanged }: {
  expense: Expense;
  expenseTypes: ExpenseType[];
  properties: Property[];
  vendors: Vendor[];
  onChanged: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [editing, setEditing]   = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]     = useState(false);

  const [date, setDate]             = useState(expense.expense_date?.slice(0, 10) ?? today);
  const [typeId, setTypeId]         = useState(String(expense.expense_type_id ?? ""));
  const [amount, setAmount]         = useState(String(expense.amount));
  const [propId, setPropId]         = useState(String(expense.property_address
    ? properties.find((p) => p.address === expense.property_address)?.property_id ?? ""
    : ""));
  const [vendorId, setVendorId]     = useState(String(expense.vendor_id ?? ""));
  const [receipt, setReceipt]       = useState(expense.receipt_number ?? "");
  const [driveUrl, setDriveUrl]     = useState(expense.drive_url ?? "");
  const [notes, setNotes]           = useState(expense.notes ?? "");

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/expenses/${expense.expense_id}`, {
      expense_date: date,
      expense_type_id: typeId ? Number(typeId) : null,
      amount: Number(amount),
      property_id: propId ? Number(propId) : null,
      vendor_id: vendorId ? Number(vendorId) : null,
      receipt_number: receipt || null,
      drive_url: driveUrl || null,
      notes: notes || null,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  async function deleteExpense() {
    await api("DELETE", `/api/v1/rental/expenses/${expense.expense_id}`);
    onChanged();
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400 w-24 shrink-0">{expense.expense_date?.slice(0, 10)}</span>
          <div>
            <span className="font-medium text-sm text-gray-900">
              {expense.type_name ?? expense.expense_type ?? "—"}
            </span>
            {expense.property_address && (
              <span className="ml-2 text-xs text-gray-400">{expense.property_address}</span>
            )}
            {expense.vendor_name && (
              <span className="ml-2 text-xs text-gray-400">· {expense.vendor_name}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-semibold text-sm text-gray-900">{fmt(expense.amount)}</span>
          <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <div className="flex gap-4 text-xs text-gray-500">
            {expense.receipt_number && <span>Receipt: {expense.receipt_number}</span>}
            {expense.drive_url && (
              <a href={expense.drive_url} target="_blank" rel="noopener noreferrer"
                className="text-blue-600 hover:underline">View Receipt ↗</a>
            )}
            {expense.notes && <span className="italic">{expense.notes}</span>}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
              {editing ? "Cancel" : "Edit"}
            </button>
            {!confirming
              ? <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Delete</button>
              : <span className="flex items-center gap-1 text-xs">
                  <span className="text-red-600">Delete this expense?</span>
                  <button onClick={deleteExpense} className="text-red-700 font-semibold hover:underline">Yes</button>
                  <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">No</button>
                </span>
            }
          </div>

          {editing && (
            <div className="p-3 bg-gray-50 rounded-xl space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Input label="Date" value={date} onChange={setDate} type="date" />
                <Select label="Type" value={typeId} onChange={setTypeId} nullable
                  options={expenseTypes.map((t) => ({ value: String(t.type_id), label: t.name }))} />
                <Input label="Amount ($)" value={amount} onChange={setAmount} type="number" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Property" value={propId} onChange={setPropId} nullable
                  options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
                <Select label="Vendor" value={vendorId} onChange={setVendorId} nullable
                  options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Receipt #" value={receipt} onChange={setReceipt} />
                <Input label="Drive URL" value={driveUrl} onChange={setDriveUrl} placeholder="https://…" />
              </div>
              <Input label="Notes" value={notes} onChange={setNotes} />
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add expense form ─────────────────────────────────────────────────────────

function AddExpenseForm({ expenseTypes, properties, vendors, onAdded }: {
  expenseTypes: ExpenseType[];
  properties: Property[];
  vendors: Vendor[];
  onAdded: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [date, setDate]         = useState(today);
  const [typeId, setTypeId]     = useState("");
  const [amount, setAmount]     = useState("");
  const [propId, setPropId]     = useState("");
  const [vendorId, setVendorId] = useState("");
  const [receipt, setReceipt]   = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) { setError("Amount is required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/expenses", {
        expense_date: date,
        expense_type_id: typeId ? Number(typeId) : null,
        amount: Number(amount),
        property_id: propId ? Number(propId) : null,
        vendor_id: vendorId ? Number(vendorId) : null,
        receipt_number: receipt || null,
        drive_url: driveUrl || null,
        notes: notes || null,
      });
      setOpen(false);
      setAmount(""); setReceipt(""); setDriveUrl(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add expense");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Expense
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-gray-700">New Expense</p>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Date" value={date} onChange={setDate} type="date" />
        <Select label="Type" value={typeId} onChange={setTypeId} nullable
          options={expenseTypes.map((t) => ({ value: String(t.type_id), label: t.name }))} />
        <Input label="Amount ($)" value={amount} onChange={setAmount} type="number" placeholder="0.00" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Property (optional)" value={propId} onChange={setPropId} nullable
          options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
        <Select label="Vendor (optional)" value={vendorId} onChange={setVendorId} nullable
          options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Receipt #" value={receipt} onChange={setReceipt} />
        <Input label="Drive URL" value={driveUrl} onChange={setDriveUrl} placeholder="https://…" />
      </div>
      <Input label="Notes" value={notes} onChange={setNotes} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Expense"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Fixed cost row ───────────────────────────────────────────────────────────

function FixedCostRow({ fc, expenseTypes, properties, vendors, onChanged }: {
  fc: FixedCost;
  expenseTypes: ExpenseType[];
  properties: Property[];
  vendors: Vendor[];
  onChanged: () => void;
}) {
  const [open, setOpen]       = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]   = useState(false);

  const [name, setName]         = useState(fc.name);
  const [amount, setAmount]     = useState(String(fc.amount));
  const [freq, setFreq]         = useState(fc.frequency);
  const [typeId, setTypeId]     = useState(String(fc.expense_type_id ?? ""));
  const [propId, setPropId]     = useState(String(fc.property_id ?? ""));
  const [vendorId, setVendorId] = useState(String(fc.vendor_id ?? ""));
  const [startDate, setStartDate] = useState(fc.start_date?.slice(0, 10) ?? today);
  const [notes, setNotes]       = useState(fc.notes ?? "");
  const [active, setActive]     = useState(fc.active);

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/fixed-costs/${fc.fixed_cost_id}`, {
      name, amount: Number(amount), frequency: freq,
      expense_type_id: typeId ? Number(typeId) : null,
      property_id: propId ? Number(propId) : null,
      vendor_id: vendorId ? Number(vendorId) : null,
      start_date: startDate,
      notes: notes || null,
      active,
    });
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  async function deleteFC() {
    await api("DELETE", `/api/v1/rental/fixed-costs/${fc.fixed_cost_id}`);
    onChanged();
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-medium text-sm text-gray-900">{fc.name}</span>
            {fc.expense_type_name && <span className="ml-2 text-xs text-gray-400">{fc.expense_type_name}</span>}
            {fc.property_address && <span className="ml-2 text-xs text-gray-400">· {fc.property_address}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400">{fc.frequency}</span>
          <span className="font-semibold text-sm text-gray-900">{fmt(fc.amount)}</span>
          {!fc.active && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-400">Inactive</span>
          )}
          <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
              {editing ? "Cancel" : "Edit"}
            </button>
            {!confirming
              ? <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Delete</button>
              : <span className="flex items-center gap-1 text-xs">
                  <span className="text-red-600">Delete this fixed cost?</span>
                  <button onClick={deleteFC} className="text-red-700 font-semibold hover:underline">Yes</button>
                  <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">No</button>
                </span>
            }
          </div>

          {editing && (
            <div className="p-3 bg-gray-50 rounded-xl space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Input label="Name" value={name} onChange={setName} />
                <Input label="Amount ($)" value={amount} onChange={setAmount} type="number" />
                <Select label="Frequency" value={freq} onChange={setFreq}
                  options={["monthly", "quarterly", "annually", "one-time"].map((f) => ({ value: f, label: f }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Type" value={typeId} onChange={setTypeId} nullable
                  options={expenseTypes.map((t) => ({ value: String(t.type_id), label: t.name }))} />
                <Select label="Property" value={propId} onChange={setPropId} nullable
                  options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Vendor" value={vendorId} onChange={setVendorId} nullable
                  options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
                <Input label="Start Date" value={startDate} onChange={setStartDate} type="date" />
              </div>
              <Input label="Notes" value={notes} onChange={setNotes} />
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
                  className="rounded border-gray-300" />
                Active
              </label>
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add fixed cost form ──────────────────────────────────────────────────────

function AddFixedCostForm({ expenseTypes, properties, vendors, onAdded }: {
  expenseTypes: ExpenseType[];
  properties: Property[];
  vendors: Vendor[];
  onAdded: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [name, setName]         = useState("");
  const [amount, setAmount]     = useState("");
  const [freq, setFreq]         = useState("monthly");
  const [typeId, setTypeId]     = useState("");
  const [propId, setPropId]     = useState("");
  const [vendorId, setVendorId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !amount) { setError("Name and amount are required."); return; }
    setSaving(true);
    setError("");
    try {
      await api("POST", "/api/v1/rental/fixed-costs", {
        name, amount: Number(amount), frequency: freq,
        expense_type_id: typeId ? Number(typeId) : null,
        property_id: propId ? Number(propId) : null,
        vendor_id: vendorId ? Number(vendorId) : null,
        start_date: startDate,
        notes: notes || null,
      });
      setOpen(false);
      setName(""); setAmount(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add fixed cost");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Fixed Cost
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-3">
      <p className="text-sm font-semibold text-gray-700">New Fixed Cost</p>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Name" value={name} onChange={setName} placeholder="e.g. Enbridge Gas" />
        <Input label="Amount ($)" value={amount} onChange={setAmount} type="number" placeholder="0.00" />
        <Select label="Frequency" value={freq} onChange={setFreq}
          options={["monthly", "quarterly", "annually", "one-time"].map((f) => ({ value: f, label: f }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Type (optional)" value={typeId} onChange={setTypeId} nullable
          options={expenseTypes.map((t) => ({ value: String(t.type_id), label: t.name }))} />
        <Select label="Property (optional)" value={propId} onChange={setPropId} nullable
          options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Vendor (optional)" value={vendorId} onChange={setVendorId} nullable
          options={vendors.map((v) => ({ value: String(v.vendor_id), label: v.company_name }))} />
        <Input label="Start Date" value={startDate} onChange={setStartDate} type="date" />
      </div>
      <Input label="Notes" value={notes} onChange={setNotes} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add Fixed Cost"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const router = useRouter();
  const [expenses, setExpenses]     = useState<Expense[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [summary, setSummary]       = useState<ExpenseSummary | null>(null);
  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [vendors, setVendors]       = useState<Vendor[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"expenses" | "fixed">("expenses");

  // Filters
  const [selYear, setSelYear]   = useState(String(currentYear));
  const [selMonth, setSelMonth] = useState(String(currentMonth));
  const [selProp, setSelProp]   = useState("");
  const [selType, setSelType]   = useState("");
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg]     = useState("");

  const yearOptions  = Array.from({ length: 5 }, (_, i) => String(currentYear - 2 + i));
  const monthOptions = [
    { value: "", label: "All months" },
    ...Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: new Date(2000, i).toLocaleString("default", { month: "long" }),
    })),
  ];

  async function loadExpenses() {
    const params = new URLSearchParams();
    if (selYear)  params.set("year",  selYear);
    if (selMonth) params.set("month", selMonth);
    if (selProp)  params.set("property_id", selProp);

    const [e, s] = await Promise.all([
      api<Expense[]>        ("GET", `/api/v1/rental/expenses?${params}`),
      api<ExpenseSummary>   ("GET", `/api/v1/rental/expenses/summary?${params}`),
    ]);
    setExpenses(e);
    setSummary(s);
  }

  async function load() {
    const [et, p, v, fc] = await Promise.all([
      api<ExpenseType[]>("GET", "/api/v1/rental/ref/expense-types"),
      api<Property[]>   ("GET", "/api/v1/rental/properties"),
      api<Vendor[]>     ("GET", "/api/v1/rental/vendors"),
      api<FixedCost[]>  ("GET", "/api/v1/rental/fixed-costs"),
    ]);
    setExpenseTypes(et);
    setProperties(p);
    setVendors(v);
    setFixedCosts(fc);
    await loadExpenses();
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    load();
  }, [router]);

  useEffect(() => {
    if (!loading) loadExpenses();
  }, [selYear, selMonth, selProp]);

  async function generateFixed() {
    const month = `${selYear}-${String(selMonth || currentMonth).padStart(2, "0")}`;
    setGenerating(true);
    setGenMsg("");
    const r = await api<{ created: number }>("POST", `/api/v1/rental/fixed-costs/generate?month=${month}`);
    const created = r?.created ?? 0;
    setGenMsg(created > 0 ? `✅ Created ${created} expense entries for ${month}.` : "All entries already exist.");
    setGenerating(false);
    loadExpenses();
  }

  const filteredExpenses = useMemo(() => {
    if (!selType) return expenses;
    return expenses.filter((e) => String(e.expense_type_id) === selType);
  }, [expenses, selType]);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["expenses", "fixed"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t === "expenses" ? "Expenses" : "Fixed Costs"}
          </button>
        ))}
      </div>

      {/* Expenses tab */}
      {tab === "expenses" && (
        <div className="space-y-5">
          <AddExpenseForm expenseTypes={expenseTypes} properties={properties} vendors={vendors}
            onAdded={() => { loadExpenses(); }} />

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-end">
            <Select label="Year" value={selYear} onChange={setSelYear}
              options={yearOptions.map((y) => ({ value: y, label: y }))} />
            <Select label="Month" value={selMonth} onChange={setSelMonth} options={monthOptions} />
            <Select label="Property" value={selProp} onChange={setSelProp} nullable
              options={properties.map((p) => ({ value: String(p.property_id), label: p.address }))} />
            <Select label="Type" value={selType} onChange={setSelType} nullable
              options={expenseTypes.map((t) => ({ value: String(t.type_id), label: t.name }))} />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Fixed Costs</label>
              <button onClick={generateFixed} disabled={generating}
                className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
                ⚡ {generating ? "Generating…" : "Generate"}
              </button>
            </div>
            {genMsg && <p className="text-sm text-gray-600 self-end pb-1.5">{genMsg}</p>}
          </div>

          {/* Summary */}
          {summary && summary.total > 0 && <SummaryTiles summary={summary} />}

          {/* List */}
          {filteredExpenses.length === 0 ? (
            <p className="text-sm text-gray-400">No expenses found for the selected filters.</p>
          ) : (
            <div className="space-y-2">
              {filteredExpenses.map((e) => (
                <ExpenseRow key={e.expense_id} expense={e}
                  expenseTypes={expenseTypes} properties={properties} vendors={vendors}
                  onChanged={loadExpenses} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fixed costs tab */}
      {tab === "fixed" && (
        <div className="space-y-4">
          <AddFixedCostForm expenseTypes={expenseTypes} properties={properties} vendors={vendors}
            onAdded={load} />
          {fixedCosts.length === 0 ? (
            <p className="text-sm text-gray-400">No fixed costs yet.</p>
          ) : (
            <div className="space-y-2">
              {fixedCosts.map((fc) => (
                <FixedCostRow key={fc.fixed_cost_id} fc={fc}
                  expenseTypes={expenseTypes} properties={properties} vendors={vendors}
                  onChanged={load} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
