import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Music, 
  Clock, 
  Settings as SettingsIcon, 
  Radio, 
  LogOut, 
  Menu, 
  X,
  Activity,
  Server,
  Cloud,
  PieChart
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { icon: LayoutDashboard, label: "Overview", href: "/" },
    { icon: Music, label: "Library", href: "/library" },
    { icon: PieChart, label: "Clocks", href: "/clocks" },
    { icon: Clock, label: "Scheduler", href: "/scheduler" },
    { icon: SettingsIcon, label: "Settings", href: "/settings" },
    { icon: Activity, label: "Play History", href: "/history" },
  ];

  return (
    <div className="min-h-screen flex bg-background text-foreground font-sans">
      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
            <Radio className="h-6 w-6 text-primary mr-3" />
            <span className="font-display font-bold text-lg tracking-wider text-foreground">
              NOVA<span className="text-primary">STREAM</span>
            </span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-6 px-3 space-y-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <a className={cn(
                  "flex items-center px-3 py-2.5 rounded-sm text-sm font-medium transition-colors group",
                  location === item.href 
                    ? "bg-sidebar-accent text-primary border-l-2 border-primary" 
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                )}>
                  <item.icon className={cn(
                    "h-5 w-5 mr-3 transition-colors",
                    location === item.href ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )} />
                  {item.label}
                </a>
              </Link>
            ))}
          </nav>

          {/* System Status */}
          <div className="p-4 border-t border-sidebar-border bg-sidebar-accent/20">
            <h4 className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-wider">System Status</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center text-muted-foreground">
                  <Server className="h-3 w-3 mr-2" />
                  <span>Server</span>
                </div>
                <span className="flex items-center text-green-500 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse"></span>
                  ONLINE
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center text-muted-foreground">
                  <Activity className="h-3 w-3 mr-2" />
                  <span>Stream</span>
                </div>
                <span className="flex items-center text-green-500 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse"></span>
                  ON-AIR
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center text-muted-foreground">
                  <Cloud className="h-3 w-3 mr-2" />
                  <span>Sync</span>
                </div>
                <span className="flex items-center text-primary font-mono">
                  IDLE
                </span>
              </div>
            </div>
          </div>

          {/* User Profile */}
          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center">
              <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center text-primary font-bold font-display">
                A
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-foreground">Admin</p>
                <p className="text-xs text-muted-foreground">Station Manager</p>
              </div>
              <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden h-16 flex items-center justify-between px-4 border-b border-border bg-card">
          <div className="flex items-center">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <span className="ml-3 font-display font-bold text-lg">NOVASTREAM</span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
