"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";
import { useState } from "react";

const NAV = [
  { href: "/dashboard",    icon: "🏠", label: "Dashboard" },
  { href: "/properties",   icon: "🏢", label: "Properties" },
  { href: "/tenants",      icon: "👥", label: "Tenants" },
  { href: "/leases",       icon: "📋", label: "Leases" },
  { href: "/notices",      icon: "📄", label: "Notices" },
  { href: "/payments",     icon: "💳", label: "Payments" },
  { href: "/deposits",     icon: "🏦", label: "Deposits" },
  { href: "/maintenance",  icon: "🔧", label: "Maintenance" },
  { href: "/expenses",     icon: "💰", label: "Expenses" },
  { href: "/cashflow",     icon: "📊", label: "Cash Flow" },
  { href: "/vendors",      icon: "🏪", label: "Vendors" },
];

const BOTTOM_NAV = [
  { href: "/team",     icon: "👨‍👩‍👧", label: "Team" },
  { href: "/settings", icon: "🏷️", label: "Settings" },
  { href: "/profile",  icon: "⚙️", label: "Profile" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleSignOut() {
    clearToken();
    router.push("/login");
  }

  function handleNavClick() {
    setMobileOpen(false);
  }

  return (
    <>
      {/* Mobile hamburger button — fixed top-left, hidden on desktop */}
      <button
        className="fixed top-3 left-3 z-50 md:hidden bg-white border border-gray-200 rounded-lg p-2 shadow-sm text-gray-600 hover:text-gray-900"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop — shown on mobile when sidebar is open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          // Base (mobile): fixed overlay, slides in/out
          "fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-white border-r border-gray-100 transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: reset to normal sticky layout
          "md:static md:translate-x-0 md:shrink-0 md:h-screen md:sticky md:top-0",
        ].join(" ")}
      >
        {/* Logo + mobile close button */}
        <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-base font-semibold text-gray-900">🏠 Property Mgmt</span>
          <button
            className="md:hidden text-gray-400 hover:text-gray-700 p-1"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Main nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV.map(({ href, icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom — profile + sign out */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-0.5">
          {BOTTOM_NAV.map(({ href, icon, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                {label}
              </Link>
            );
          })}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <span className="text-base leading-none">🚪</span>
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
