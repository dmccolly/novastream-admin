import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, Users, Clock, Music2, HardDrive } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function Home() {
  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Mission Control</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">System ID: NS-2026-ALPHA // Status: OPERATIONAL</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="border-primary/50 text-primary hover:bg-primary/10 font-mono text-xs">
              <HardDrive className="h-4 w-4 mr-2" />
              SYNC DROPBOX
            </Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs">
              <Play className="h-4 w-4 mr-2" />
              START STREAM
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="glass-panel border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-mono text-muted-foreground">CURRENT LISTENERS</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display neon-text">1,248</div>
              <p className="text-xs text-muted-foreground mt-1">+12% from last hour</p>
            </CardContent>
          </Card>
          
          <Card className="glass-panel border-l-4 border-l-cyan-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-mono text-muted-foreground">ACTIVE TRACKS</CardTitle>
              <Music2 className="h-4 w-4 text-cyan-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">3,402</div>
              <p className="text-xs text-muted-foreground mt-1">32,746 in Cold Storage</p>
            </CardContent>
          </Card>
          
          <Card className="glass-panel border-l-4 border-l-amber-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-mono text-muted-foreground">UPTIME</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">14d 02h</div>
              <p className="text-xs text-muted-foreground mt-1">Since last reboot</p>
            </CardContent>
          </Card>
          
          <Card className="glass-panel border-l-4 border-l-green-500">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium font-mono text-muted-foreground">SERVER LOAD</CardTitle>
              <ActivityIcon className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">12%</div>
              <p className="text-xs text-muted-foreground mt-1">CPU Usage</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Now Playing */}
          <Card className="glass-panel lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display tracking-wider flex items-center">
                <span className="h-2 w-2 rounded-full bg-primary mr-2 animate-pulse"></span>
                ON AIR
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row gap-6 items-center">
                <div className="w-full md:w-48 h-48 bg-black/50 rounded-lg border border-border flex items-center justify-center relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-50"></div>
                  <Music2 className="h-16 w-16 text-muted-foreground group-hover:text-primary transition-colors" />
                  
                  {/* Visualizer Bars (Fake) */}
                  <div className="absolute bottom-0 left-0 right-0 h-12 flex items-end justify-center gap-1 p-2">
                    {[...Array(12)].map((_, i) => (
                      <div 
                        key={i} 
                        className="w-2 bg-primary/80 rounded-t-sm animate-pulse"
                        style={{ 
                          height: `${Math.random() * 100}%`,
                          animationDelay: `${i * 0.1}s` 
                        }}
                      ></div>
                    ))}
                  </div>
                </div>
                
                <div className="flex-1 space-y-4 w-full">
                  <div>
                    <h3 className="text-2xl font-bold text-foreground">Bohemian Rhapsody</h3>
                    <p className="text-lg text-primary font-medium">Queen</p>
                    <p className="text-sm text-muted-foreground font-mono mt-1">A Night at the Opera • 1975</p>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-mono text-muted-foreground">
                      <span>02:14</span>
                      <span>05:55</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary w-[38%] relative">
                        <div className="absolute right-0 top-0 bottom-0 w-1 bg-white shadow-[0_0_10px_white]"></div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Controls */}
                  <div className="flex items-center gap-4 pt-2">
                    <Button variant="outline" size="icon" className="h-10 w-10 rounded-full border-primary/20 hover:border-primary hover:bg-primary/10">
                      <Pause className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-10 w-10 rounded-full border-primary/20 hover:border-primary hover:bg-primary/10">
                      <SkipForward className="h-4 w-4" />
                    </Button>
                    <div className="ml-auto px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold font-mono flex items-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 mr-2 animate-pulse"></span>
                      LIVE BROADCAST
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Queue */}
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="font-display tracking-wider">UP NEXT</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { title: "Enter Sandman", artist: "Metallica", time: "05:55" },
                  { title: "Sweet Child O' Mine", artist: "Guns N' Roses", time: "06:02" },
                  { title: "Back in Black", artist: "AC/DC", time: "06:15" },
                  { title: "Smells Like Teen Spirit", artist: "Nirvana", time: "06:20" },
                  { title: "Whole Lotta Love", artist: "Led Zeppelin", time: "06:25" },
                ].map((track, i) => (
                  <div key={i} className="flex items-center justify-between group p-2 rounded hover:bg-white/5 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center text-xs font-mono text-muted-foreground">
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">{track.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{track.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ActivityIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}
