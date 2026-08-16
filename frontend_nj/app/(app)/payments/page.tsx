"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { RentRollRow, PaymentMethod, Transaction, Promise as PayPromise, Adjustment } from "@/types/payment";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const currentMonth = today.slice(0, 7);

function monthOptions() {
  const opts: string[] = [];
  const base = new Date();
  for (let y = -12; y <= 6; y++) {
    const d = new Date(base.getFullYear(), base.getMonth() + y, 1);
    opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return opts;
}

const STATUS_STYLE: Record<string, string> = {
  paid:          "bg-green-100 text-green-700",
  partial:       "bg-orange-100 text-orange-700",
  promised:      "bg-yellow-100 text-yellow-700",
  late:          "bg-red-100 text-red-700",
  pending:       "bg-gray-100 text-gray-500",
  not_generated: "bg-gray-50 text-gray-400",
};

const STATUS_ICON: Record<string, string> = {
  paid: "🟢", partial: "🟠", promised: "🟡", late: "🔴", pending: "⚪", not_generated: "⬜",
};

function fmt(n: number | null | undefined) {
  return n != null ? `$${Number(n).toLocaleString()}` : "—";
}

function Input({ label, value, onChange, type = "text", min, step }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; min?: string; step?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        min={min} step={step}
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

// ─── Transaction history (lazy) ───────────────────────────────────────────────

function TransactionHistory({ ledgerId }: { ledgerId: number }) {
  const [txns, setTxns] = useState<Transaction[] | null>(null);

  useEffect(() => {
    api<Transaction[]>("GET", `/api/v1/rental/ledger/${ledgerId}/transactions`).then(setTxns);
  }, [ledgerId]);

  if (!txns) return <p className="text-xs text-gray-400 animate-pulse">Loading…</p>;
  if (!txns.length) return <p className="text-xs text-gray-400">No individual payment records yet.</p>;

  const total = txns.reduce((s, t) => s + Number(t.amount), 0);
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-400">{txns.length} payment(s) — Total: <strong>${total.toLocaleString()}</strong></p>
      {txns.map((t) => (
        <div key={t.transaction_id} className="flex items-center gap-3 text-xs text-gray-600">
          <span className="text-green-600">✅</span>
          <span className="font-medium">{t.paid_date}</span>
          <span className="font-semibold">${Number(t.amount).toLocaleString()}</span>
          {t.payment_method_label && <span className="text-gray-400">{t.payment_method_label}</span>}
          {t.notes && <span className="text-gray-400 italic">{t.notes}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Rent roll row ────────────────────────────────────────────────────────────

function RentRollEntry({ row, methods, selMonth, onChanged }: {
  row: RentRollRow;
  methods: PaymentMethod[];
  selMonth: string;
  onChanged: () => void;
}) {
  const [open, setOpen]           = useState(false);
  const [activeTab, setActiveTab] = useState<"pay" | "promise" | "adjust" | "history">("pay");
  const [showHistory, setShowHistory] = useState(false);

  // Derived amounts
  const obligation      = Number(row.monthly_obligation);
  const paid            = Number(row.amount_paid ?? 0);
  const adjustTotal     = Number(row.adjustment_total ?? 0);
  const netDue          = (row.amount_due != null ? Number(row.amount_due) : obligation) + adjustTotal;
  const remaining       = Math.max(0, netDue - paid);

  const defaultMethod = methods.find((m) => m.label.toLowerCase().includes("transfer"))?.code ?? methods[0]?.code ?? "";

  // Pay form
  const [payAmt, setPayAmt]       = useState(String(remaining));
  const [payDate, setPayDate]     = useState(today);
  const [payMethod, setPayMethod] = useState(defaultMethod);
  const [payNotes, setPayNotes]   = useState("");
  const [paying, setPaying]       = useState(false);

  // Promises
  const [promises, setPromises]   = useState<PayPromise[] | null>(null);
  const [prDate, setPrDate]       = useState(today);
  const [prAmt, setPrAmt]         = useState(String(obligation));
  const [prNotes, setPrNotes]     = useState("");
  const [promising, setPromising] = useState(false);

  // Adjustments
  const [adjustments, setAdjustments] = useState<Adjustment[] | null>(null);
  const [adjAmt, setAdjAmt]           = useState("");
  const [adjReason, setAdjReason]     = useState("");
  const [addingAdj, setAddingAdj]     = useState(false);

  const status: string = row.payment_status ?? "not_generated";
  const icon    = STATUS_ICON[status] ?? "⬜";
  const style   = STATUS_STYLE[status] ?? STATUS_STYLE.not_generated;
  const isPast  = selMonth < currentMonth;
  const isLate  = ["late", "pending"].includes(status) && isPast && !!row.ledger_id;

  async function loadPromises() {
    if (!row.ledger_id) return;
    const data = await api<PayPromise[]>("GET", `/api/v1/rental/ledger/${row.ledger_id}/promises`);
    setPromises(data);
  }

  async function loadAdjustments() {
    if (!row.ledger_id) return;
    const data = await api<Adjustment[]>("GET", `/api/v1/rental/ledger/${row.ledger_id}/adjustments`);
    setAdjustments(data);
  }

  function switchTab(t: typeof activeTab) {
    setActiveTab(t);
    if (t === "history") setShowHistory(true);
    if (t === "promise" && promises === null) loadPromises();
    if (t === "adjust" && adjustments === null) loadAdjustments();
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!row.ledger_id) return;
    setPaying(true);
    await api("POST", `/api/v1/rental/ledger/${row.ledger_id}/pay`, {
      amount: Number(payAmt),
      paid_date: payDate,
      payment_method_code: payMethod || null,
      notes: payNotes || null,
    });
    setPaying(false);
    onChanged();
  }

  async function addPromise(e: React.FormEvent) {
    e.preventDefault();
    if (!row.ledger_id) return;
    setPromising(true);
    await api("POST", `/api/v1/rental/ledger/${row.ledger_id}/promises`, {
      promised_date: prDate,
      promised_amount: Number(prAmt),
      notes: prNotes || null,
    });
    setPromising(false);
    setPrNotes("");
    await loadPromises();
    onChanged();
  }

  async function deletePromise(promiseId: number) {
    await api("DELETE", `/api/v1/rental/promises/${promiseId}`);
    await loadPromises();
    onChanged();
  }

  async function addAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!row.ledger_id || !adjAmt || !adjReason.trim()) return;
    setAddingAdj(true);
    await api("POST", `/api/v1/rental/ledger/${row.ledger_id}/adjustments`, {
      amount: Number(adjAmt),
      reason: adjReason.trim(),
    });
    setAddingAdj(false);
    setAdjAmt(""); setAdjReason("");
    await loadAdjustments();
    onChanged();
  }

  async function deleteAdjustment(adjId: number) {
    await api("DELETE", `/api/v1/rental/adjustments/${adjId}`);
    await loadAdjustments();
    onChanged();
  }

  const hasAdjustments = adjustTotal !== 0;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Summary row */}
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-3">
          <span>{icon}</span>
          <div>
            <span className="font-medium text-sm text-gray-900">{row.tenant_name}</span>
            <span className="ml-2 text-xs text-gray-400">Unit {row.unit_number} — {row.space_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {hasAdjustments ? (
            <span className="text-sm text-gray-600">
              <span className="line-through text-gray-400 text-xs mr-1">{fmt(row.monthly_obligation)}</span>
              {fmt(netDue)}/mo
            </span>
          ) : (
            <span className="text-sm text-gray-600">{fmt(row.monthly_obligation)}/mo</span>
          )}
          {row.amount_paid != null && (
            <span className="text-xs text-gray-400">paid {fmt(row.amount_paid)}</span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${style}`}>
            {status.replace("_", " ").toUpperCase()}
          </span>
          <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">

          {/* Status banners */}
          {status === "paid" && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-sm text-green-700">
              ✅ Paid in full — {fmt(row.amount_paid)} on {row.paid_date ?? "—"}
            </div>
          )}
          {status === "partial" && (
            <div className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 text-sm text-orange-700">
              🟠 Partial — {fmt(row.amount_paid)} paid, <strong>{fmt(remaining)}</strong> remaining
              {hasAdjustments && <span className="ml-2 text-xs">(net of adjustments)</span>}
            </div>
          )}
          {status === "promised" && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2 text-sm text-yellow-700">
              🟡 Promised — see Promise tab for schedule
            </div>
          )}
          {isLate && status !== "paid" && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">
              🔴 LATE — {fmt(netDue)} was due {selMonth}-01
            </div>
          )}
          {!row.ledger_id && (
            <p className="text-xs text-gray-400">No payment entry for {selMonth} yet. Click ⚡ Generate above.</p>
          )}

          {/* Action tabs */}
          {row.ledger_id && status !== "paid" && (
            <div>
              <div className="flex gap-1 border-b border-gray-100 mb-3">
                {(["pay", "promise", "adjust", "history"] as const).map((t) => (
                  <button key={t} onClick={() => switchTab(t)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                      activeTab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"
                    }`}>
                    {t === "pay" ? "Record Payment" : t === "promise" ? "Promises" : t === "adjust" ? "Adjustments" : "History"}
                  </button>
                ))}
              </div>

              {/* Pay tab */}
              {activeTab === "pay" && (
                <form onSubmit={recordPayment} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {paid > 0 && (
                    <p className="col-span-full text-xs text-gray-400">
                      Already collected: <strong>{fmt(paid)}</strong> — Remaining: <strong>{fmt(remaining)}</strong>
                      {hasAdjustments && " (net of adjustments)"}
                    </p>
                  )}
                  <Input label="Amount ($)" value={payAmt} onChange={setPayAmt} type="number" min="0.01" step="0.01" />
                  <Input label="Date" value={payDate} onChange={setPayDate} type="date" />
                  <Select label="Method" value={payMethod} onChange={setPayMethod}
                    options={methods.map((m) => ({ value: m.code, label: m.label }))} />
                  <Input label="Notes" value={payNotes} onChange={setPayNotes} />
                  <div className="col-span-full">
                    <button type="submit" disabled={paying}
                      className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      {paying ? "Saving…" : "💾 Save Payment"}
                    </button>
                  </div>
                </form>
              )}

              {/* Promises tab */}
              {activeTab === "promise" && (
                <div className="space-y-3">
                  {promises === null ? (
                    <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                  ) : promises.length === 0 ? (
                    <p className="text-xs text-gray-400">No promises recorded yet.</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-400 mb-1">
                        Total promised: <strong>${promises.reduce((s, p) => s + Number(p.promised_amount), 0).toLocaleString()}</strong>
                      </p>
                      {promises.map((p) => (
                        <div key={p.promise_id} className="flex items-center justify-between gap-3 text-xs text-gray-700 bg-yellow-50 rounded-lg px-3 py-1.5">
                          <div className="flex items-center gap-3">
                            <span className="font-medium">{p.promised_date}</span>
                            <span className="font-semibold text-yellow-700">${Number(p.promised_amount).toLocaleString()}</span>
                            {p.notes && <span className="text-gray-400 italic">{p.notes}</span>}
                          </div>
                          <button onClick={() => deletePromise(p.promise_id)} className="text-red-400 hover:text-red-600">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={addPromise} className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
                    <Input label="By date" value={prDate} onChange={setPrDate} type="date" />
                    <Input label="Amount ($)" value={prAmt} onChange={setPrAmt} type="number" min="0" />
                    <Input label="Notes" value={prNotes} onChange={setPrNotes} />
                    <div className="col-span-full">
                      <button type="submit" disabled={promising}
                        className="px-4 py-1.5 bg-yellow-500 text-white text-xs rounded-lg hover:bg-yellow-600 disabled:opacity-50">
                        {promising ? "Adding…" : "🟡 Add Promise"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Adjustments tab */}
              {activeTab === "adjust" && (
                <div className="space-y-3">
                  {adjustments === null ? (
                    <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                  ) : adjustments.length === 0 ? (
                    <p className="text-xs text-gray-400">No adjustments yet.</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-400 mb-1">
                        Net due: <strong>{fmt(netDue)}</strong>
                        {adjustTotal < 0 && <span className="text-green-600 ml-1">(discount {fmt(adjustTotal)} applied)</span>}
                        {adjustTotal > 0 && <span className="text-orange-600 ml-1">(surcharge +{fmt(adjustTotal)} applied)</span>}
                      </p>
                      {adjustments.map((a) => (
                        <div key={a.adjustment_id} className="flex items-center justify-between gap-3 text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-1.5">
                          <div className="flex items-center gap-3">
                            <span className={`font-semibold ${a.amount < 0 ? "text-green-600" : "text-orange-600"}`}>
                              {a.amount < 0 ? "-" : "+"}{fmt(Math.abs(a.amount))}
                            </span>
                            <span className="text-gray-600">{a.reason}</span>
                          </div>
                          <button onClick={() => deleteAdjustment(a.adjustment_id)} className="text-red-400 hover:text-red-600">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={addAdjustment} className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-500">Amount (negative = discount)</label>
                      <input type="number" step="0.01" value={adjAmt} onChange={(e) => setAdjAmt(e.target.value)}
                        placeholder="-100 or +50"
                        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <Input label="Reason" value={adjReason} onChange={setAdjReason} />
                    <div className="col-span-full">
                      <button type="submit" disabled={addingAdj}
                        className="px-4 py-1.5 bg-gray-700 text-white text-xs rounded-lg hover:bg-gray-800 disabled:opacity-50">
                        {addingAdj ? "Adding…" : "Apply Adjustment"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeTab === "history" && showHistory && (
                <TransactionHistory ledgerId={row.ledger_id} />
              )}
            </div>
          )}

          {/* History for paid entries */}
          {row.ledger_id && status === "paid" && (
            <div>
              <button onClick={() => setShowHistory((s) => !s)}
                className="text-xs text-blue-600 hover:underline">
                {showHistory ? "Hide History" : "View Payment History"}
              </button>
              {showHistory && <div className="mt-2"><TransactionHistory ledgerId={row.ledger_id} /></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PaymentsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selMonth, setSelMonth]   = useState(currentMonth);
  const [roll, setRoll]           = useState<RentRollRow[]>([]);
  const [methods, setMethods]     = useState<PaymentMethod[]>([]);
  const [loading, setLoading]     = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg]       = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  async function loadRoll(month: string) {
    setLoading(true);
    const [r, m] = await Promise.all([
      api<RentRollRow[]>("GET", `/api/v1/rental/rent-roll?month=${month}`),
      methods.length ? Promise.resolve(methods) : api<PaymentMethod[]>("GET", "/api/v1/rental/ref/payment-methods"),
    ]);
    setRoll(r);
    if (!methods.length) setMethods(m as PaymentMethod[]);
    setLoading(false);
  }

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { router.push("/login"); return; }
    if (searchParams.get("filter") === "outstanding") setOutstandingOnly(true);
    loadRoll(selMonth);
  }, [router]);

  async function generate() {
    setGenerating(true);
    setGenMsg("");
    const r = await api<{ created: number; month: string }>(
      "POST", `/api/v1/rental/ledger/generate-month?month=${selMonth}`
    );
    const created = r?.created ?? 0;
    setGenMsg(created > 0 ? `✅ Created ${created} entries for ${selMonth}.` : "All entries already exist.");
    setGenerating(false);
    loadRoll(selMonth);
  }

  function changeMonth(m: string) {
    setSelMonth(m);
    setGenMsg("");
    loadRoll(m);
  }

  // Summary stats
  const totalDue    = useMemo(() => roll.reduce((s, r) => s + Number(r.monthly_obligation), 0), [roll]);
  const totalPaid   = useMemo(() => roll.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0), [roll]);
  const countPaid   = useMemo(() => roll.filter((r) => r.payment_status === "paid").length, [roll]);
  const countOut    = useMemo(() => roll.filter((r) => r.payment_status !== "paid").length, [roll]);

  const isOutstanding = (r: RentRollRow) =>
    Number(r.monthly_obligation ?? 0) > Number(r.amount_paid ?? 0);

  const visibleRoll = useMemo(
    () => outstandingOnly ? roll.filter(isOutstanding) : roll,
    [roll, outstandingOnly],
  );

  // Group by property
  const byProperty = useMemo(() => {
    const map = new Map<string, RentRollRow[]>();
    for (const r of visibleRoll) {
      const key = r.address;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [visibleRoll]);

  const months = useMemo(() => monthOptions(), []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Payments</h1>

      {/* Month selector + generate + filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={selMonth} onChange={(e) => changeMonth(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {months.map((m) => <option key={m}>{m}</option>)}
        </select>
        <button onClick={generate} disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
          ⚡ {generating ? "Generating…" : "Generate"}
        </button>
        <button
          onClick={() => setOutstandingOnly((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border cursor-pointer transition-colors ${
            outstandingOnly
              ? "bg-red-50 border-red-300 text-red-700 font-medium hover:bg-red-100"
              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs shrink-0 ${
            outstandingOnly ? "bg-red-600 border-red-600 text-white" : "border-gray-400"
          }`}>
            {outstandingOnly ? "✓" : ""}
          </span>
          Outstanding Only
        </button>
        {genMsg && <span className="text-sm text-gray-600">{genMsg}</span>}
      </div>

      {/* Summary metrics */}
      {roll.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Expected", value: fmt(totalDue) },
            { label: "Collected", value: fmt(totalPaid) },
            { label: "🟢 Paid", value: String(countPaid) },
            { label: "⚠️ Outstanding", value: String(countOut) },
          ].map((m) => (
            <div key={m.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{m.label}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Rent roll */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading…</div>
      ) : roll.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
          No active tenants for {selMonth}. Click ⚡ Generate to create payment entries.
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(byProperty.entries()).map(([address, rows]) => (
            <div key={address}>
              <p className="text-sm font-semibold text-gray-500 mb-2">🏢 {address}</p>
              <div className="space-y-2">
                {rows.map((r) => (
                  <RentRollEntry
                    key={`${r.tenant_id}-${r.lease_id}`}
                    row={r}
                    methods={methods}
                    selMonth={selMonth}
                    onChanged={() => loadRoll(selMonth)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>}>
      <PaymentsPageInner />
    </Suspense>
  );
}
