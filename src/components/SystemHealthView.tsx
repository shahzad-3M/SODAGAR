import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  History,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wifi,
  XCircle,
  Lock,
} from 'lucide-react';
import type { AdminAuditLog, SystemHealthReport } from '../types/index.ts';
import {
  apiCreateServerBackup,
  apiFetchSystemHealth,
  apiRevokeSession,
  apiRevokeUserSessions,
  apiVerifyRestoreBackup,
  getAdminAuditLogs,
  getSyncStatus,
  retrySyncNow,
  subscribeSyncStatus,
  type SyncStatusSnapshot,
} from '../utils/storage.ts';
import {
  ConfirmDialogModal,
  type ConfirmDialogState,
  ToastBanner,
  type ToastMessage,
} from './AppDialogs.tsx';

interface SystemHealthViewProps {
  currentUserRole: string;
  onOpenBackupSettings?: () => void;
}

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatDuration(totalSec?: number): string {
  if (totalSec === undefined || !Number.isFinite(totalSec)) return '0s';
  const s = Math.max(0, Math.floor(totalSec));
  const days = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hrs > 0 || days > 0) parts.push(`${hrs}h`);
  if (mins > 0 || hrs > 0 || days > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export const SystemHealthView: React.FC<SystemHealthViewProps> = ({
  currentUserRole,
  onOpenBackupSettings,
}) => {
  const [report, setReport] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncSnapshot, setSyncSnapshot] = useState<SyncStatusSnapshot>(getSyncStatus);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>(getAdminAuditLogs);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [runningRestoreTest, setRunningRestoreTest] = useState(false);
  const [revokingSid, setRevokingSid] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'admin';

  const pushToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = `sh_toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const loadHealth = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setFetchError(null);
    const res = await apiFetchSystemHealth();
    if (!res.ok || !res.health) {
      setFetchError(res.error || 'Could not retrieve live system health diagnostics.');
    } else {
      setReport(res.health);
      setAuditLogs(getAdminAuditLogs());
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void loadHealth();
    const unsub = subscribeSyncStatus((snap) => setSyncSnapshot(snap));
    return unsub;
  }, [loadHealth]);

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 max-w-lg mx-auto my-10 text-center space-y-3">
        <div className="w-11 h-11 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 flex items-center justify-center mx-auto">
          <Lock className="w-5 h-5" />
        </div>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          Administrator Access Required
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          System Health diagnostics, database integrity telemetry, backup verification, and active session controls are restricted to Super Admin and Admin accounts.
        </p>
      </div>
    );
  }

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await apiCreateServerBackup('system_health_manual');
      if (res.ok) {
        pushToast('Verified snapshot created and SHA-256 checksum recorded.', 'success');
        await loadHealth();
      } else {
        pushToast(res.error || 'Snapshot creation failed.', 'error');
      }
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRunRestoreTest = async () => {
    setRunningRestoreTest(true);
    try {
      const res = await apiVerifyRestoreBackup();
      if (res.ok) {
        pushToast(
          `Dry-run restore test passed (${res.lastRestoreTest?.recordsVerified ?? 0} records verified, live data untouched).`,
          'success'
        );
        await loadHealth();
      } else {
        pushToast(res.error || 'Restore verification test failed.', 'error');
        await loadHealth();
      }
    } finally {
      setRunningRestoreTest(false);
    }
  };

  const handleRevokeSession = (sid: string, label: string) => {
    setConfirmDialog({
      title: 'Revoke Active Session',
      message: `Immediately sign out "${label}" (session ${sid.slice(0, 12)}…)? Their token will be rejected on the next API request.`,
      confirmLabel: 'Revoke Session',
      danger: true,
      onConfirm: async () => {
        setRevokingSid(sid);
        const res = await apiRevokeSession(sid);
        setRevokingSid(null);
        if (res.ok) {
          pushToast('Session revoked immediately.', 'success');
          await loadHealth();
        } else {
          pushToast(res.error || 'Could not revoke session.', 'error');
        }
      },
    });
  };

  const handleRevokeOtherUserSessions = (userId: string, name: string) => {
    setConfirmDialog({
      title: 'Revoke User Sessions',
      message: `Sign out all active sessions for "${name}" (excluding your current browser session)?`,
      confirmLabel: 'Revoke Sessions',
      danger: true,
      onConfirm: async () => {
        const res = await apiRevokeUserSessions(userId, true);
        if (res.ok) {
          pushToast(`Revoked ${res.revokedCount ?? 0} session(s) for ${name}.`, 'success');
          await loadHealth();
        } else {
          pushToast(res.error || 'Failed to revoke user sessions.', 'error');
        }
      },
    });
  };

  const statusTone = (status: 'ok' | 'degraded' | 'error' | 'verified' | 'stale' | 'mismatch' | 'missing' | 'passed' | 'failed') => {
    if (status === 'ok' || status === 'verified' || status === 'passed') {
      return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
    }
    if (status === 'degraded' || status === 'stale') {
      return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
    }
    return 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800';
  };

  const criticalAlerts: string[] = [];
  if (fetchError) criticalAlerts.push(fetchError);
  if (report) {
    if (!report.database.connected) criticalAlerts.push(`Database disconnected: ${report.database.error || 'Ping failed'}`);
    if (report.integrity.status !== 'ok') criticalAlerts.push(`Database integrity warning: ${report.integrity.detail}`);
    if (report.backup.status === 'missing') criticalAlerts.push('No verified server backup snapshot exists yet.');
    if (report.backup.status === 'mismatch') criticalAlerts.push(`Backup SHA-256 verification failed: ${report.backup.reason}`);
    if (report.backup.status === 'stale') criticalAlerts.push(report.backup.reason);
    if (!report.lastRestoreTest) criticalAlerts.push('Backup restoration has not been tested yet. Run a non-destructive restore test.');
    else if (report.lastRestoreTest.status !== 'passed') criticalAlerts.push(`Last restore test failed: ${report.lastRestoreTest.error || 'Verify snapshot'}`);
    if (report.operations.recentApiErrorsCount > 0) criticalAlerts.push(`${report.operations.recentApiErrorsCount} server API error(s) recorded since boot.`);
    if (syncSnapshot.state === 'offline' || syncSnapshot.state === 'conflict') {
      criticalAlerts.push(`Client sync state is "${syncSnapshot.state}"${syncSnapshot.lastError ? `: ${syncSnapshot.lastError}` : ''}`);
    }
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Activity className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
              System Health &amp; Governance Monitor
            </h1>
            {report && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-bold uppercase ${statusTone(report.backendStatus)}`}
              >
                {report.backendStatus === 'ok' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : report.backendStatus === 'degraded' ? (
                  <AlertTriangle className="w-3.5 h-3.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                <span>Backend: {report.backendStatus}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Live verification of database integrity, SHA-256 backups, dry-run restore tests, SSE synchronization, storage telemetry, and active sessions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadHealth()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Live Checks</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCreateBackup()}
            disabled={creatingBackup}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <Database className="w-3.5 h-3.5" />
            <span>{creatingBackup ? 'Backing Up...' : 'Create Verified Backup'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRunRestoreTest()}
            disabled={runningRestoreTest}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 dark:bg-[#FFD200] dark:hover:bg-amber-400 text-white dark:text-slate-950 whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${runningRestoreTest ? 'animate-spin' : ''}`} />
            <span>{runningRestoreTest ? 'Testing Restore...' : 'Run Restore Test (Dry-Run)'}</span>
          </button>

          {onOpenBackupSettings && (
            <button
              type="button"
              onClick={onOpenBackupSettings}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <span>Backup Settings</span>
            </button>
          )}
        </div>
      </div>

      {/* Truthful Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-extrabold text-amber-900 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Active Governance &amp; Reliability Warnings ({criticalAlerts.length})</span>
          </div>
          <ul className="list-disc pl-5 text-xs text-amber-900/90 dark:text-amber-200/90 space-y-0.5">
            {criticalAlerts.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && !report ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-xs text-slate-500">
          Running live database, backup, disk, and session checks...
        </div>
      ) : report ? (
        <>
          {/* Primary Health Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Card 1: Backend & Version */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5" /> Backend &amp; Release
                </span>
                <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${statusTone(report.backendStatus)}`}>
                  {report.backendStatus}
                </span>
              </div>
              <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                v{report.appVersion} · {report.environment}
              </div>
              <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Server Uptime:</span>
                  <span className="font-mono font-bold tabular-nums">{formatDuration(report.uptimeSeconds)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Last Boot / Deploy:</span>
                  <span className="font-mono">{formatDateTime(report.serverBootedAt)}</span>
                </div>
              </div>
            </div>

            {/* Card 2: Database & Integrity */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" /> Database &amp; Integrity
                </span>
                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${statusTone(
                    report.database.connected ? report.integrity.status : 'error'
                  )}`}
                >
                  {report.database.connected ? `Integrity ${report.integrity.status}` : 'Disconnected'}
                </span>
              </div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-white truncate" title={report.database.identityLabel}>
                {report.database.identityLabel}
              </div>
              <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Connection / Ping:</span>
                  <span className="font-mono font-bold tabular-nums">
                    {report.database.connected ? `OK (${report.database.latencyMs ?? 0} ms)` : 'FAILED'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Migrations Applied:</span>
                  <span className="font-mono font-bold tabular-nums">
                    {report.migrations.count} ({report.migrations.latestMigrationId || 'none'})
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate" title={report.integrity.detail}>
                  {report.integrity.detail}
                </div>
              </div>
            </div>

            {/* Card 3: Backup & Restore Verification */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> Backup &amp; Restore
                </span>
                <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${statusTone(report.backup.status)}`}>
                  {report.backup.status}
                </span>
              </div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums">
                {report.backup.backupCount} Snapshots · SHA-256 {report.backup.sha256Valid ? 'Valid' : 'Unverified'}
              </div>
              <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Last Backup:</span>
                  <span className="font-mono">{formatDateTime(report.backup.latestBackupAt)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Last Restore Test:</span>
                  <span
                    className={`font-bold ${
                      report.lastRestoreTest?.status === 'passed'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {report.lastRestoreTest
                      ? `${report.lastRestoreTest.status.toUpperCase()} (${formatDateTime(report.lastRestoreTest.testedAt)})`
                      : 'Never Tested'}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 4: Sync & Disk Telemetry */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5" /> Real-Time Sync &amp; Disk
                </span>
                <span
                  className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${statusTone(
                    syncSnapshot.state === 'synced' ? 'ok' : syncSnapshot.state === 'saving' ? 'degraded' : 'error'
                  )}`}
                >
                  {syncSnapshot.state}
                </span>
              </div>
              <div className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums">
                {report.sync.sseClientsCount} SSE Client(s) · {report.sessions.activeSessionsCount} Sessions
              </div>
              <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Storage (`data/`):</span>
                  <span className="font-mono font-bold tabular-nums">
                    {formatBytes(report.storage.dataBytes)} (Backups: {formatBytes(report.storage.backupsBytes)})
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Disk Free Space:</span>
                  <span className="font-mono font-bold tabular-nums">
                    {report.storage.diskFreeBytes !== undefined
                      ? `${formatBytes(report.storage.diskFreeBytes)} free (${report.storage.diskUsedPercent ?? 0}% used)`
                      : 'Restricted FS'}
                  </span>
                </div>
                {syncSnapshot.pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void retrySyncNow()}
                    className="text-[11px] font-bold text-amber-700 dark:text-amber-300 underline cursor-pointer"
                  >
                    Flush {syncSnapshot.pendingCount} pending client change(s)
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Operations & Queues Summary */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-slate-500" />
              Operations, Queues &amp; Error Counters
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Active Users</div>
                <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {report.sessions.activeUsersCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Pending / In-Transit COD</div>
                <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {report.operations.pendingCodOrdersCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Pending WhatsApp Queue</div>
                <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {report.operations.pendingWhatsappQueueCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Pending Investor Offers</div>
                <div className="text-lg font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {report.operations.pendingInvestorRequestsCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Failed Automations</div>
                <div
                  className={`text-lg font-extrabold tabular-nums mt-0.5 ${
                    report.operations.failedCrmAutomationsCount > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {report.operations.failedCrmAutomationsCount}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Recent 5xx API Errors</div>
                <div
                  className={`text-lg font-extrabold tabular-nums mt-0.5 ${
                    report.operations.recentApiErrorsCount > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {report.operations.recentApiErrorsCount}
                </div>
              </div>
            </div>
          </div>

          {/* Active Sessions & Revocation Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Active Authenticated Sessions ({report.sessions.activeSessionsCount})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Revoked sessions take effect immediately across API requests. Total revoked in window: {report.sessions.revokedCount}.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-3 font-semibold">User</th>
                    <th className="py-2 px-3 font-semibold">Role</th>
                    <th className="py-2 px-3 font-semibold">IP / Client</th>
                    <th className="py-2 px-3 font-semibold">Last Active</th>
                    <th className="py-2 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.sessions.activeList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No tracked active sessions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    report.sessions.activeList.map((s) => (
                      <tr key={s.sid} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{s.name}</span>
                            {s.isCurrent && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">{s.userId}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-bold uppercase">
                            {s.role}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-slate-300 max-w-[260px] truncate" title={s.userAgent || ''}>
                          <span className="font-mono">{s.ip || 'unknown'}</span>
                          {s.userAgent && <span className="block text-[10px] text-slate-400 truncate">{s.userAgent}</span>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {formatDateTime(s.lastSeenAt)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1.5">
                          {!s.isCurrent && (
                            <button
                              type="button"
                              disabled={revokingSid === s.sid}
                              onClick={() => handleRevokeSession(s.sid, s.name)}
                              className="px-2.5 py-1 rounded-md border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/60 text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                            >
                              {revokingSid === s.sid ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRevokeOtherUserSessions(s.userId, s.name)}
                            className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-semibold cursor-pointer"
                          >
                            Sign Out Other Devices
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Two-Column Bottom Diagnostics: API Errors + Migrations & Audit Log */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent API Errors */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                Recent Server API Errors ({report.apiErrors.length})
              </h2>
              {report.apiErrors.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  Zero 5xx server API errors recorded since {formatDateTime(report.serverBootedAt)}.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {report.apiErrors.map((err) => (
                    <div
                      key={err.id}
                      className="p-2.5 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50/60 dark:bg-red-950/30 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                        <span className="font-bold text-red-800 dark:text-red-300">
                          {err.statusCode} {err.method} {err.path}
                        </span>
                        <span className="text-slate-500">{formatDateTime(err.timestamp)}</span>
                      </div>
                      <div className="text-slate-700 dark:text-slate-200 mt-1">{err.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Schema Migrations & Audit Trail */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-600" />
                Applied Schema Migrations &amp; Admin Governance Logs
              </h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {report.migrations.items.map((m) => (
                  <div
                    key={m.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">{m.id}</span>
                      <span className="text-[10px] font-mono text-slate-500">{formatDateTime(m.appliedAt)}</span>
                    </div>
                    {m.notes && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{m.notes}</div>}
                  </div>
                ))}

                {auditLogs.slice(0, 8).map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{log.action}</span>
                      <span className="text-[10px] font-mono text-slate-500">{formatDateTime(log.createdAt)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {log.actorName || 'Admin'} ({log.actorRole || 'admin'}) · {log.entityType}:{log.entityId}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      <ToastBanner toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      <ConfirmDialogModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
};
