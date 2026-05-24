import { cn } from "@/lib/utils";
import {
  Activity,
  Clock,
  Download,
  FileText,
  LayoutDashboard,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ReactNode } from "react";
import { Link, useLocation } from "wouter";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/downloads", label: "Downloads", icon: <Download size={18} /> },
  { href: "/logs", label: "Logs ao Vivo", icon: <Activity size={18} /> },
  { href: "/history", label: "Histórico", icon: <Clock size={18} /> },
  { href: "/settings", label: "Configurações", icon: <Settings size={18} /> },
];

interface AppLayoutProps {
  children: ReactNode;
  connected?: boolean;
}

export function AppLayout({ children, connected = false }: AppLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Mesh background */}
      <div className="mesh-bg" />

      {/* Sidebar */}
      <aside className="w-64 shrink-0 flex flex-col glass-card rounded-none border-r border-l-0 border-t-0 border-b-0 z-10">
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <FileText size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-display font-bold text-white text-sm leading-tight">ANVISA</h1>
              <p className="text-xs text-white/40 tracking-widest uppercase">Downloader</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div className={cn("sidebar-link", isActive && "active")}>
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Connection status */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5">
            {connected ? (
              <>
                <Wifi size={14} className="text-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">Conectado</span>
                <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </>
            ) : (
              <>
                <WifiOff size={14} className="text-red-400" />
                <span className="text-xs text-red-400 font-medium">Reconectando...</span>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
