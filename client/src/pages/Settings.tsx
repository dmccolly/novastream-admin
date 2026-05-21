import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tracksApi } from "@/lib/api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { 
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Zap
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

interface SyncStatus {
  lastSync?: string;
  nextSync?: string;
  status: "idle" | "syncing" | "success" | "error";
  tracksAdded?: number;
  tracksUpdated?: number;
  syncType?: "full" | "incremental";
  error?: string;
}

export default function Settings() {
  const [showToken, setShowToken] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ status: "idle" });
  const [syncType, setSyncType] = useState<"full" | "incremental">("incremental");
  const [settings, setSettings] = useState({
    dropboxToken: "sl.u.AGOq8c_r3akDKOGjf08b_xXzTHzz634OE1qRzRK0OSI02JQF6im4fuS3C_TycFaLAhaZAoRS5xxuygR1OqOwTuC7_dRUKXaqmaIckA7BfMLG2rFTFZx0hAiR6Cducnh7kk89OUMdWG_hxXQ_Uq3CAFxPRnt9LOZDqqKn4LKCEQb9sqY54WrUIJQ2yo85g0yN8E87cFitCrKKj_5OmTb67AZ2s9BIQTi9Nr0t7FS8F-SV2je1Mor6rTlTLVxAWH94iPs2Nf6GS_dqFSihgvZyzf3dmRtKxIKVMhsvo-c_ioKxsR2zOJlBIxlz7mMpokb1ar0vUfIHTh_uROX6tD4uhJZuo3MrtrU50Av68xF50y5Mut5APLTH9UVk0D0t5JH50A3va1ANsuJy9hr5xyWtNPztXUFxaRnzqCAg8WHULW1vnzG_zBK20fo3T0y8VpHqjKw5OkVyXBYM-fRhNsONWmp_vMsfqG_mz-eRAVR6akI2_0SBz8leNnG3Yo4PEjE-7IRoVQ-Z3Qkc-cf1jHx1VFLgZy3joC4kQNc2-UOcCa5gKQF1H3vy4EaTdBzY7Xo2bu8Ssn5Axf4PUdsqW43MecKUDIUI-QpAJ_b5VRoBONJT3nvR1K23PkUhsvAb8NI2hV48XqGEICCvUA2e9UmA9GO6cRM2LGPKBa3EhdbAAF5q2Jk2YHrwJH7snD_G-ehP5_Le5IE-cPRcws4NSjbDUEwczXUz2wiFcQ38uL9wz6gNHvfbrEMxof9tPYRawgzXgBS6xDwGEE1kHNM-WJz3kEpTcaTg0-C4YH8ww48ed9YG2BnXkk1Eh7VZfECc4s3w3EwrUaOSH1GkyLP288cs2kP27N9mkW03M0kn88oRty_oVEV_lm3LdYtvXIgqckpjEI-kHbVipY4HTEGqTVjSeC-yW_ofu5sAv1yF6ktVSULTvM3u3zcffp7jSzZixLsCeZ3Dz4xJC0lDV20RKKP_HZDjKJq-reW5yqMMTjP-clps6D-rvSlUsI9b555ZMwtV47fLtbJL1-kUXc4-uvKyiwVZr-L3r5XSKOz8t9GcBVsUWtEHCMpXzx6ywFztFiP5FEXpft67FpCnxYjAXUFIUA4nO9rQySNpsGr-Xh-BwpAC0NGh7eOF5IWrQZ39XoshtdovzPKvHhnG-E1xDh7W8em7ACufKemyho8C7tbFKJbL00hqi01upRScwzZy5EXDUlMFmim3GL9YHdKuhQfJ_6OIph7oYQ4f0BmWSZSeAqkmUis1YRZZjc__3Is44jNzx_o",
    musicFolder: "/Music",
    maxActiveTracks: 3000,
    autoSyncInterval: 3600,
    enableNotifications: true,
  });

  const handleSyncNow = async () => {
    try {
      setSyncStatus({ status: "syncing", syncType });
      const result = await tracksApi.sync(syncType);

      setSyncStatus({
        status: "success",
        lastSync: new Date().toLocaleString(),
        tracksAdded: result.added,
        tracksUpdated: result.updated,
        syncType,
      });
      toast.success(
        syncType === "full"
          ? `Full re-index complete: +${result.added} added, ~${result.updated} updated`
          : `Incremental sync complete: +${result.added} new, ~${result.updated} updated`
      );
    } catch (error) {
      setSyncStatus({
        status: "error",
        syncType,
        error: "Failed to sync with Dropbox"
      });
      toast.error("Sync failed");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const maskToken = (token: string) => {
    if (token.length <= 20) return token;
    return token.substring(0, 10) + "..." + token.substring(token.length - 10);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center">
            <SettingsIcon className="h-8 w-8 mr-3 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">Configure your radio station</p>
        </div>

        {/* Dropbox Configuration */}
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display tracking-wider">Dropbox Integration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-mono text-muted-foreground uppercase">Access Token</label>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={settings.dropboxToken}
                    readOnly
                    className="w-full px-3 py-2 rounded bg-input border border-border/50 text-foreground font-mono text-sm"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken(!showToken)}
                  className="border-border/50 hover:border-primary"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(settings.dropboxToken)}
                  className="border-border/50 hover:border-primary"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Token: {maskToken(settings.dropboxToken)} • Status: <span className="text-green-500">✓ Valid</span>
              </p>
            </div>

            <div>
              <label className="text-sm font-mono text-muted-foreground uppercase">Music Folder</label>
              <input
                type="text"
                value={settings.musicFolder}
                onChange={(e) => setSettings({ ...settings, musicFolder: e.target.value })}
                className="w-full px-3 py-2 mt-2 rounded bg-input border border-border/50 text-foreground font-mono text-sm focus:outline-none focus:border-primary"
                placeholder="/Music"
              />
              <p className="text-xs text-muted-foreground mt-2">Path to your music folder in Dropbox</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-mono text-muted-foreground uppercase">Max Active Tracks</label>
                <input
                  type="number"
                  value={settings.maxActiveTracks}
                  onChange={(e) => setSettings({ ...settings, maxActiveTracks: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 mt-2 rounded bg-input border border-border/50 text-foreground font-mono text-sm focus:outline-none focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-2">Maximum tracks to keep on server</p>
              </div>

              <div>
                <label className="text-sm font-mono text-muted-foreground uppercase">Auto-Sync Interval</label>
                <input
                  type="number"
                  value={settings.autoSyncInterval}
                  onChange={(e) => setSettings({ ...settings, autoSyncInterval: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 mt-2 rounded bg-input border border-border/50 text-foreground font-mono text-sm focus:outline-none focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-2">Seconds between syncs (0 = disabled)</p>
              </div>
            </div>

            <div className="flex items-center gap-2 p-3 rounded bg-primary/10 border border-primary/20">
              <input
                type="checkbox"
                checked={settings.enableNotifications}
                onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                className="w-4 h-4 rounded border-border bg-input cursor-pointer"
              />
              <label className="text-sm text-foreground cursor-pointer flex-1">Enable sync notifications</label>
            </div>
          </CardContent>
        </Card>

        {/* Sync Status */}
        <Card className={`glass-panel border-l-4 ${
          syncStatus.status === "success" 
            ? "border-l-green-500 bg-green-500/5" 
            : syncStatus.status === "error"
            ? "border-l-destructive bg-destructive/5"
            : "border-l-primary bg-primary/5"
        }`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-display tracking-wider flex items-center">
                <Zap className="h-5 w-5 mr-2" />
                Sync Status
              </CardTitle>
              <Button
                onClick={handleSyncNow}
                disabled={syncStatus.status === "syncing"}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncStatus.status === "syncing" ? "animate-spin" : ""}`} />
                {syncStatus.status === "syncing"
                  ? "SYNCING..."
                  : syncType === "full"
                  ? "FULL RE-INDEX"
                  : "SYNC NEW ONLY"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  syncType === "incremental"
                    ? "border-primary bg-primary/10"
                    : "border-border/50 hover:border-primary/50"
                }`}
              >
                <input
                  type="radio"
                  name="syncType"
                  value="incremental"
                  checked={syncType === "incremental"}
                  onChange={() => setSyncType("incremental")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground font-mono">Incremental</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Only new or changed files since last sync. Fast — uses Dropbox cursor.
                  </p>
                </div>
              </label>
              <label
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  syncType === "full"
                    ? "border-primary bg-primary/10"
                    : "border-border/50 hover:border-primary/50"
                }`}
              >
                <input
                  type="radio"
                  name="syncType"
                  value="full"
                  checked={syncType === "full"}
                  onChange={() => setSyncType("full")}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-bold text-foreground font-mono">Full re-index</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Walks the entire Dropbox folder. Slow. Use after restoring backups or when incremental looks wrong.
                  </p>
                </div>
              </label>
            </div>

            {syncStatus.status === "idle" && (
              <p className="text-sm text-muted-foreground">
                Click "{syncType === "full" ? "FULL RE-INDEX" : "SYNC NEW ONLY"}" to start a manual sync.
              </p>
            )}

            {syncStatus.status === "syncing" && (
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
                <span className="text-sm text-foreground font-mono">Scanning Dropbox...</span>
              </div>
            )}

            {syncStatus.status === "success" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-mono text-sm">
                    {syncStatus.syncType === "full" ? "Full re-index" : "Incremental sync"} completed successfully
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground font-mono text-xs">Last Sync</p>
                    <p className="font-bold text-foreground mt-1">{syncStatus.lastSync}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-mono text-xs">Added</p>
                    <p className="font-bold text-green-500 mt-1">+{syncStatus.tracksAdded}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-mono text-xs">Updated</p>
                    <p className="font-bold text-blue-500 mt-1">~{syncStatus.tracksUpdated}</p>
                  </div>
                </div>
              </div>
            )}

            {syncStatus.status === "error" && (
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-mono text-sm text-destructive">Sync failed</p>
                  <p className="text-xs text-muted-foreground mt-1">{syncStatus.error}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Server Status */}
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display tracking-wider">Server Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded bg-secondary/50 border border-border/50">
                <p className="text-xs font-mono text-muted-foreground uppercase">API Status</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm font-bold text-green-500">Online</span>
                </div>
              </div>

              <div className="p-3 rounded bg-secondary/50 border border-border/50">
                <p className="text-xs font-mono text-muted-foreground uppercase">Database</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm font-bold text-green-500">Connected</span>
                </div>
              </div>

              <div className="p-3 rounded bg-secondary/50 border border-border/50">
                <p className="text-xs font-mono text-muted-foreground uppercase">Icecast</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  <span className="text-sm font-bold text-yellow-500">Standby</span>
                </div>
              </div>

              <div className="p-3 rounded bg-secondary/50 border border-border/50">
                <p className="text-xs font-mono text-muted-foreground uppercase">Uptime</p>
                <p className="text-sm font-bold text-foreground mt-2">2d 14h 32m</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Settings */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="border-border/50 hover:border-primary">
            CANCEL
          </Button>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Save className="h-4 w-4 mr-2" />
            SAVE SETTINGS
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
