"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type {
  CashFlowResponse, CashFlowProperty, CashFlowExpenseItem,
  CashFlowCommonExpense, Mortgage,
} from "@/types/cashflow";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property { property_id: number; address: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return `$${Math.abs(n).toLocaleString()}`; }
function currentYear()  { return new Date().getFullYear(); }
function currentMonth() { return new Date().getMonth() + 1; }
function yearOptions()  {
  const y = currentYear();
  return Array.from({ length: 7 }, (_, i) => y - 3 + i);
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function SourceBadge({ source }: { source: CashFlowExpenseItem["source"] }) {
  if (source === "actual")     return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">actual</span>;
  if (source === "manual")     return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">manual est.</span>;
  if (source === "calculated") return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">auto est.</span>;
  return null;
}

// ─── Expense row ──────────────────────────────────────────────────────────────

function ExpenseRow({ item, propId, year, month, onUpdated }: {
  item: CashFlowExpenseItem;
  propId: number;
  year: number;
  month: number | null;
  onUpdated: () => void;
}) {
  const [editing, setEditing]         = useState(false);
  const [editVal, setEditVal]         = useState(String(item.amount));
  const [saving, setSaving]           = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError]     = useState("");
  const isActual = item.source === "actual";

  async function save() {
    if (!editVal || isNaN(Number(editVal))) return;
    setSaving(true);
    await api("POST", "/api/v1/rental/cashflow/estimates", {
      property_id: propId, expense_type_id: item.expense_type_id,
      year, month, amount: Number(editVal),
    });
    setSaving(false); setEditing(false); onUpdated();
  }

  async function recalculate() {
    setCalculating(true); setCalcError("");
    try {
      await api("POST", "/api/v1/rental/cashflow/estimates/calculate", {
        property_id: propId, expense_type_id: item.expense_type_id, year, month,
      });
      onUpdated();
    } catch (e: unknown) {
      setCalcError(e instanceof Error ? e.message : "Not enough history to calculate");
    } finally { setCalculating(false); }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
        <span className="text-gray-600 min-w-0 flex-1 truncate">{item.category}</span>
        <div className="flex items-center gap-2 shrink-0">
          <SourceBadge source={item.source} />
          {isActual ? (
            <span className="font-medium text-gray-800 w-24 text-right">{fmt(item.amount)}</span>
          ) : editing ? (
            <div className="flex items-center gap-1">
              <input type="number" step="0.01" value={editVal} onChange={(e) => setEditVal(e.target.value)}
                className="w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={save} disabled={saving} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                {saving ? "…" : "Save"}
              </button>
              <button onClick={() => { setEditing(false); setCalcError(""); }} className="text-xs text-gray-400 hover:underline">✕</button>
            </div>
          ) : (
            <button onClick={() => { setEditing(true); setEditVal(String(item.amount)); }}
              className="font-medium text-gray-800 w-24 text-right hover:text-blue-600 hover:underline">
              {fmt(item.amount)}
            </button>
          )}
          {!isActual && !editing && (
            <button onClick={recalculate} disabled={calculating} title="Recalculate from 12-month average"
              className="text-sm text-gray-400 hover:text-gray-700 disabled:opacity-50 w-4">
              {calculating ? "…" : "↻"}
            </button>
          )}
        </div>
      </div>
      {calcError && <p className="text-xs text-amber-600 pb-1">{calcError}</p>}
    </div>
  );
}

// ─── Add expense estimate inline form ────────────────────────────────────────

interface ExpenseType { type_id: number; name: string; }

function AddEstimateForm({ propId, year, month, existingTypeIds, onAdded }: {
  propId: number;
  year: number;
  month: number | null;
  existingTypeIds: Set<number | null>;
  onAdded: () => void;
}) {
  const [open, setOpen]           = useState(false);
  const [types, setTypes]         = useState<ExpenseType[]>([]);
  const [typeId, setTypeId]       = useState("");
  const [amount, setAmount]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  async function openForm() {
    if (!types.length) {
      const data = await api<ExpenseType[]>("GET", "/api/v1/rental/ref/expense-types");
      // Filter out types already on this property card and Mortgage Interest
      const filtered = data.filter(
        (t) => !existingTypeIds.has(t.type_id) && t.name !== "Mortgage Interest"
      );
      setTypes(filtered);
      if (filtered.length) setTypeId(String(filtered[0].type_id));
    }
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!typeId || !amount) return;
    setSaving(true); setError("");
    try {
      await api("POST", "/api/v1/rental/cashflow/estimates", {
        property_id: propId, expense_type_id: Number(typeId),
        year, month, amount: Number(amount),
      });
      setOpen(false); setAmount(""); onAdded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  }

  if (!open) return (
    <button onClick={openForm}
      className="mt-1 text-xs text-blue-500 hover:underline">
      + Add expense estimate
    </button>
  );

  if (!types.length) return (
    <p className="text-xs text-gray-400 mt-1">All expense types already have entries for this period.</p>
  );

  return (
    <form onSubmit={save} className="mt-2 flex items-end gap-2 flex-wrap">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Category</label>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
          {types.map((t) => <option key={t.type_id} value={t.type_id}>{t.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Amount ($)</label>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00" required
          className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
      <div className="flex items-center gap-2 pb-0.5">
        <button type="submit" disabled={saving}
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:underline">Cancel</button>
      </div>
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
    </form>
  );
}

// ─── Property card ────────────────────────────────────────────────────────────

function PropertyCard({ prop, year, month, onUpdated }: {
  prop: CashFlowProperty; year: number; month: number | null; onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isPositive = prop.net_cash_flow >= 0;
  const existingTypeIds = new Set(prop.expenses.map((e) => e.expense_type_id));

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left">
        <div className="space-y-0.5 min-w-0">
          <span className="font-semibold text-gray-900">{prop.address}</span>
          <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
            <span>Collected {fmt(prop.income_collected)} / Expected {fmt(prop.income_expected)}</span>
            {prop.mortgage_payment > 0 && <span>Mortgage {fmt(prop.mortgage_payment)}</span>}
            {prop.total_operating_expenses > 0 && <span>Expenses {fmt(prop.total_operating_expenses)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <span className={`text-sm font-bold ${isPositive ? "text-green-600" : "text-red-600"}`}>
            {isPositive ? "+" : "−"}{fmt(prop.net_cash_flow)}
          </span>
          <span className="text-gray-400">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4">
          <div className="divide-y divide-gray-50">
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-gray-500 font-medium">Rental Income</span>
              <div className="flex items-center gap-2">
                {prop.income_expected !== prop.income_collected && (
                  <span className="text-xs text-gray-400">/ {fmt(prop.income_expected)} expected</span>
                )}
                <span className="font-semibold text-green-700 w-24 text-right">{fmt(prop.income_collected)}</span>
              </div>
            </div>
            {prop.mortgage_payment > 0 && (
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-gray-600">Mortgage Payment</span>
                <span className="font-medium text-gray-800 w-24 text-right">{fmt(prop.mortgage_payment)}</span>
              </div>
            )}
            {prop.expenses.map((item) => (
              <ExpenseRow key={item.expense_type_id ?? item.category}
                item={item} propId={prop.property_id} year={year} month={month} onUpdated={onUpdated} />
            ))}
            <div className="py-1">
              <AddEstimateForm
                propId={prop.property_id} year={year} month={month}
                existingTypeIds={existingTypeIds} onAdded={onUpdated} />
            </div>
            <div className={`flex items-center justify-between py-2 text-sm font-bold ${isPositive ? "text-green-700" : "text-red-600"}`}>
              <span>Net Cash Flow</span>
              <span className="w-24 text-right">{isPositive ? "+" : "−"}{fmt(prop.net_cash_flow)}</span>
            </div>
            {prop.mortgage_interest_tax_ref > 0 && (
              <p className="text-xs text-gray-400 italic pt-1">
                Mortgage Interest (tax ref only): {fmt(prop.mortgage_interest_tax_ref)} — not counted in cash flow above
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Report tab ───────────────────────────────────────────────────────────────

function ReportTab({ year, month, propFilter }: {
  year: number; month: number | null; propFilter: string;
}) {
  const [data, setData]       = useState<CashFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    let url = `/api/v1/rental/cashflow?year=${year}`;
    if (month)      url += `&month=${month}`;
    if (propFilter) url += `&property_id=${propFilter}`;
    const d = await api<CashFlowResponse>("GET", url);
    setData(d);
    setLoading(false);
  }

  useEffect(() => { load(); }, [year, month, propFilter]);

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>;
  if (!data)   return null;

  const { portfolio, properties, common_expenses, common_total } = data;
  const netPositive = portfolio.net_cash_flow >= 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Income Collected", value: `$${portfolio.income_collected.toLocaleString()}`,
            sub: portfolio.income_expected !== portfolio.income_collected ? `/ $${portfolio.income_expected.toLocaleString()} expected` : null,
            color: "text-gray-900" },
          { label: "Mortgage Payments", value: `$${portfolio.mortgage_payments.toLocaleString()}`, sub: null, color: "text-gray-900" },
          { label: "Operating Expenses", value: `$${(portfolio.operating_expenses + portfolio.common_expenses).toLocaleString()}`, sub: null, color: "text-gray-900" },
          { label: "Net Cash Flow", value: `${netPositive ? "+" : "−"}$${Math.abs(portfolio.net_cash_flow).toLocaleString()}`,
            sub: null, color: netPositive ? "text-green-600" : "text-red-600" },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{m.label}</p>
            <p className={`text-xl font-bold mt-1 ${m.color}`}>{m.value}</p>
            {m.sub && <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>}
          </div>
        ))}
      </div>

      {properties.length === 0 ? (
        <p className="text-sm text-gray-400">No data for this period. Record expenses or generate rent entries first.</p>
      ) : (
        <div className="space-y-3">
          {properties.map((prop) => (
            <PropertyCard key={prop.property_id} prop={prop} year={year} month={month} onUpdated={load} />
          ))}
        </div>
      )}

      {common_expenses.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Common Expenses</p>
            <p className="text-xs text-gray-400">Not allocated to any specific property</p>
          </div>
          <div className="divide-y divide-gray-50">
            {common_expenses.map((e: CashFlowCommonExpense, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">{e.category}</span>
                  {e.source !== "actual" && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">est.</span>
                  )}
                </div>
                <span className="font-medium text-gray-800">${Number(e.amount).toLocaleString()}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-2 text-sm font-semibold text-gray-700">
              <span>Total Common</span>
              <span>${common_total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mortgage row ─────────────────────────────────────────────────────────────

function MortgageRow({ mortgage, onChanged }: { mortgage: Mortgage; onChanged: () => void }) {
  const [editing, setEditing]       = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [lender,  setLender]  = useState(mortgage.lender ?? "");
  const [payment, setPayment] = useState(String(mortgage.monthly_payment));
  const [tStart,  setTStart]  = useState(mortgage.term_start?.slice(0, 10) ?? "");
  const [tEnd,    setTEnd]    = useState(mortgage.term_end?.slice(0, 10) ?? "");
  const [rate,    setRate]    = useState(
    mortgage.interest_rate != null ? String((Number(mortgage.interest_rate) * 100).toFixed(2)) : ""
  );
  const [notes, setNotes] = useState(mortgage.notes ?? "");

  async function save() {
    setSaving(true);
    await api("PATCH", `/api/v1/rental/mortgages/${mortgage.mortgage_id}`, {
      lender: lender || null, monthly_payment: Number(payment),
      term_start: tStart, term_end: tEnd || null,
      interest_rate: rate ? Number(rate) / 100 : null, notes: notes || null,
    });
    setSaving(false); setEditing(false); onChanged();
  }

  async function remove() {
    await api("DELETE", `/api/v1/rental/mortgages/${mortgage.mortgage_id}`);
    onChanged();
  }

  const today    = new Date().toISOString().slice(0, 10);
  const isActive = !mortgage.term_end || mortgage.term_end >= today;

  return (
    <div className="py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? "bg-green-500" : "bg-gray-300"}`}
              title={isActive ? "Active" : "Expired"} />
            <span className="font-medium text-sm text-gray-900">
              ${Number(mortgage.monthly_payment).toLocaleString()}/mo
            </span>
            {mortgage.lender && <span className="text-xs text-gray-500">{mortgage.lender}</span>}
            {mortgage.interest_rate != null && (
              <span className="text-xs text-gray-400">{(Number(mortgage.interest_rate) * 100).toFixed(2)}%</span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            {mortgage.term_start?.slice(0, 10)} → {mortgage.term_end?.slice(0, 10) ?? "open-ended"}
          </p>
          {mortgage.notes && <p className="text-xs text-gray-400 italic">{mortgage.notes}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => setEditing((e) => !e)} className="text-xs text-blue-600 hover:underline">
            {editing ? "Cancel" : "Edit"}
          </button>
          {!confirming
            ? <button onClick={() => setConfirming(true)} className="text-xs text-red-500 hover:underline">Delete</button>
            : <span className="flex items-center gap-1 text-xs">
                <span className="text-red-600">Delete?</span>
                <button onClick={remove} className="text-red-700 font-semibold hover:underline">Yes</button>
                <button onClick={() => setConfirming(false)} className="text-gray-400 hover:underline">No</button>
              </span>
          }
        </div>
      </div>
      {editing && (
        <div className="p-3 bg-gray-50 rounded-xl space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {([
              { label: "Lender", val: lender, set: setLender, type: "text", ph: "e.g. TD Bank" },
              { label: "Monthly Payment ($)", val: payment, set: setPayment, type: "number", ph: "" },
              { label: "Term Start", val: tStart, set: setTStart, type: "date", ph: "" },
              { label: "Term End (optional)", val: tEnd, set: setTEnd, type: "date", ph: "" },
              { label: "Interest Rate %", val: rate, set: setRate, type: "number", ph: "e.g. 5.49" },
              { label: "Notes", val: notes, set: setNotes, type: "text", ph: "" },
            ] as { label: string; val: string; set: (v: string) => void; type: string; ph: string }[]).map(({ label, val, set, type, ph }) => (
              <div key={label} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{label}</label>
                <input type={type} value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
          </div>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Add mortgage form ────────────────────────────────────────────────────────

function AddMortgageForm({ properties, onAdded }: { properties: Property[]; onAdded: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen]       = useState(false);
  const [propId, setPropId]   = useState("");
  const [lender, setLender]   = useState("");
  const [payment, setPayment] = useState("");
  const [tStart, setTStart]   = useState(today);
  const [tEnd, setTEnd]       = useState("");
  const [rate, setRate]       = useState("");
  const [notes, setNotes]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    if (properties.length && !propId) setPropId(String(properties[0].property_id));
  }, [properties, propId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!propId || !payment) { setError("Property and monthly payment are required."); return; }
    setSaving(true); setError("");
    try {
      await api("POST", "/api/v1/rental/mortgages", {
        property_id: Number(propId), lender: lender || null,
        monthly_payment: Number(payment), term_start: tStart,
        term_end: tEnd || null, interest_rate: rate ? Number(rate) / 100 : null,
        notes: notes || null,
      });
      setOpen(false);
      setPayment(""); setLender(""); setTEnd(""); setRate(""); setNotes("");
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full border-2 border-dashed border-gray-200 rounded-xl py-3 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors">
      + Add Mortgage
    </button>
  );

  return (
    <form onSubmit={submit} className="border border-blue-200 rounded-xl p-5 bg-blue-50 space-y-4">
      <p className="text-sm font-semibold text-gray-700">New Mortgage</p>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Property *</label>
        <select value={propId} onChange={(e) => setPropId(e.target.value)} required
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {properties.map((p) => <option key={p.property_id} value={p.property_id}>{p.address}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {([
          { label: "Lender", val: lender, set: setLender, type: "text", ph: "e.g. TD Bank", req: false },
          { label: "Monthly Payment ($) *", val: payment, set: setPayment, type: "number", ph: "", req: true },
          { label: "Term Start *", val: tStart, set: setTStart, type: "date", ph: "", req: true },
          { label: "Term End (optional)", val: tEnd, set: setTEnd, type: "date", ph: "", req: false },
          { label: "Interest Rate % (optional)", val: rate, set: setRate, type: "number", ph: "e.g. 5.49", req: false },
          { label: "Notes (optional)", val: notes, set: setNotes, type: "text", ph: "", req: false },
        ] as { label: string; val: string; set: (v: string) => void; type: string; ph: string; req: boolean }[]).map(({ label, val, set, type, ph, req }) => (
          <div key={label} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">{label}</label>
            <input type={type} value={val} onChange={(e) => set(e.target.value)}
              placeholder={ph} required={req}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save Mortgage"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:underline">Cancel</button>
      </div>
    </form>
  );
}

// ─── Mortgages tab ────────────────────────────────────────────────────────────

function MortgagesTab() {
  const [mortgages, setMortgages]   = useState<Mortgage[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading]       = useState(true);

  async function load() {
    const [m, p] = await Promise.all([
      api<Mortgage[]>("GET", "/api/v1/rental/mortgages"),
      api<Property[]>("GET", "/api/v1/rental/properties"),
    ]);
    setMortgages(m); setProperties(p); setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const byProperty = useMemo(() => {
    const map = new Map<string, Mortgage[]>();
    for (const m of mortgages) {
      const key = m.property_address;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [mortgages]);

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-5">
      <AddMortgageForm properties={properties} onAdded={load} />
      {byProperty.size === 0 ? (
        <p className="text-sm text-gray-400">No mortgages recorded yet. Add one above.</p>
      ) : (
        Array.from(byProperty.entries()).map(([address, morts]) => (
          <div key={address} className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-700 mb-1">🏢 {address}</p>
            <div className="divide-y divide-gray-100">
              {morts.map((m) => <MortgageRow key={m.mortgage_id} mortgage={m} onChanged={load} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CashFlowPage() {
  const router = useRouter();
  const [tab, setTab]               = useState<"report" | "mortgages">("report");
  const [year, setYear]             = useState(currentYear());
  const [month, setMonth]           = useState<number | null>(currentMonth());
  const [propFilter, setPropFilter] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    api<Property[]>("GET", "/api/v1/rental/properties").then(setProperties);
  }, [router]);

  const years  = yearOptions();
  const months = [
    { value: "", label: "Full Year" },
    ...MONTHS.map((label, i) => ({ value: String(i + 1), label })),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Cash Flow</h1>

      <div className="flex items-center gap-3 flex-wrap">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month ?? ""} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={propFilter} onChange={(e) => setPropFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Properties</option>
          {properties.map((p) => <option key={p.property_id} value={p.property_id}>{p.address}</option>)}
        </select>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {(["report", "mortgages"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t === "report" ? "Cash Flow" : "Mortgages"}
          </button>
        ))}
      </div>

      {tab === "report"    && <ReportTab year={year} month={month} propFilter={propFilter} />}
      {tab === "mortgages" && <MortgagesTab />}
    </div>
  );
}
