import { useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, limit } from 'firebase/firestore';
import {
  Search,
  Edit3,
  Save,
  X,
  ShieldCheck,
  Clock,
  ShieldAlert,
  Plus,
  Trash2,
  Lock,
  ExternalLink,
  Users as UsersIcon,
  Ticket,
  Ban,
  Zap,
  BarChart3,
  CreditCard,
  TrendingUp,
  Hexagon,
  DollarSign,
  Github
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AnalyticsDashboard from './AnalyticsDashboard';
import { CDKeyManager } from './CDKeyManager';

interface AdminPanelProps {
  onViewUser: (userId: string) => void;
}

const TABS = [
  { id: 'users', label: 'Users', icon: <UsersIcon className="w-3.5 h-3.5" /> },
  { id: 'orders', label: 'Orders', icon: <CreditCard className="w-3.5 h-3.5" /> },
  { id: 'revenue', label: 'Revenue', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: 'analytics', label: 'Analytics', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { id: 'subscriptions', label: 'Subscriptions', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'cdkeys', label: 'CD Keys', icon: <Ticket className="w-3.5 h-3.5" /> }
];

function formatClassName(val: any): string {
  if (!val) return 'Unknown Class';
  if (typeof val !== 'string') return String(val);
  const trimmed = val.trim();
  if (!trimmed) return 'Unknown Class';
  return trimmed.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function StatCard({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.05] flex items-center justify-center ${accent}`}>
        {icon}
      </div>
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-white/20">{label}</div>
        <div className="text-sm font-bold text-white/80">{value}</div>
      </div>
    </div>
  );
}

export function AdminPanel({ onViewUser }: AdminPanelProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [allKeys, setAllKeys] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('users');
  const [modalUser, setModalUser] = useState<any>(null);
  const [modalType, setModalType] = useState<'disable' | 'enable' | 'delete' | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    // Listen to users
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      usersData.sort((a: any, b: any) => {
        const dateA = a.createdAt?.toDate?.()?.getTime() || 0;
        const dateB = b.createdAt?.toDate?.()?.getTime() || 0;
        return dateB - dateA;
      });
      setUsers(usersData);
      setLoading(false);
    }, (err) => {
      console.error("[Admin] User fetch error:", err);
      setLoading(false);
    });

    return () => unsubUsers();
  }, []);

  useEffect(() => {
    const unsubKeys = onSnapshot(collection(db, 'cd_keys'), (snapshot) => {
      setAllKeys(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubKeys();
  }, []);

  const handleUpdateUser = async (userId: string) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      // Strip internal UI-only fields. Dates are sent as plain YYYY-MM-DD
      // strings (or null) - the backend converts them to Firestore Timestamps.
      // A client-SDK Timestamp/serverTimestamp built here wouldn't survive
      // JSON.stringify + the REST hop, and would get stored as a broken map.
      const { _newClass, _newClassExpires, _originalAioExpires, ...cleanUpdates } = editForm;

      // Only touch aioExpires if the admin actually changed it in this session -
      // otherwise every save (even unrelated ones, like changing role) would
      // resend it and the backend would wipe the AIO date / class entitlements.
      if (cleanUpdates.aioExpires === _originalAioExpires) {
        delete cleanUpdates.aioExpires;
      }

      const res = await fetch('/api/admin/user/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId, updates: cleanUpdates })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setEditingUser(null);
      alert("User updated successfully.");
    } catch (err: any) {
      console.error('[AdminPanel] handleUpdateUser failed:', err);
      // handleFirestoreError logs and re-throws - swallow that so the alert
      // below actually runs instead of failing completely silently.
      try { handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`); } catch { /* logged already */ }
      alert(`Failed to update user: ${err.message}`);
    }
  };

  // ─── DEV TEST: fake checkout entitlement grant ───
  const handleDevCheckout = async (targetUser: any, planType: 'trial' | 'single' | 'aio', className?: string) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const res = await fetch('/api/dev/fake-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: targetUser.id,
          email: targetUser.email,
          planType,
          ...(className ? { className } : {})
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      console.log(`[DevCheckout] ${planType} granted to ${targetUser.email}:`, data);
      alert(`DEV: Granted ${planType.toUpperCase()} to ${targetUser.email}\nExpires: ${new Date(data.expirationDate).toLocaleDateString()}\nDiscord: ${data.discordSyncResult?.success ? 'OK' : data.discordSyncResult?.error || 'N/A'}`);
    } catch (err: any) {
      console.error('[DevCheckout] Frontend error:', err);
      alert(`DEV Checkout Error: ${err.message}`);
    }
  };

  const handleDisableAction = async (targetUser: any, action: 'disable' | 'enable') => {
    try {
      setActionLoading(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const res = await fetch('/api/admin/disable-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: targetUser.id, action })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      console.log(`[Admin] ${action}d user ${targetUser.id}`, data);
      alert(`User ${action}d successfully. ${action === 'disable' ? `Revoked ${data.keysRevoked || 0} CD keys.` : ''}`);
      setModalUser(null);
      setModalType(null);
    } catch (err: any) {
      console.error(`[Admin] ${action} user error:`, err);
      setModalError(err.message || `Failed to ${action} user`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAction = async (targetUser: any) => {
    const confirmation = deleteConfirmText.trim().toUpperCase();
    if (confirmation !== 'DELETE') {
      setModalError('You must type DELETE exactly to confirm permanent deletion.');
      return;
    }
    setModalError(null);
    try {
      setActionLoading(true);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: targetUser.id, confirm: 'DELETE' })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      console.log(`[Admin] Deleted user ${targetUser.id}`, data);
      alert(`User deleted successfully. Removed ${data.ordersDeleted || 0} orders, ${data.purchasesDeleted || 0} purchases, ${data.keysDeleted || 0} keys.`);
      setModalUser(null);
      setModalType(null);
      setDeleteConfirmText('');
      setModalError(null);
    } catch (err: any) {
      console.error('[Admin] Delete user error:', err);
      setModalError(err.message || 'Failed to delete user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceGithubSync = async (targetUser: any) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const res = await fetch('/api/sync-license', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: targetUser.id })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      console.log(`[Admin] Force GitHub sync for ${targetUser.id}:`, data);
      alert(data.githubSync?.success ? 'GitHub license synced successfully.' : `GitHub sync issue: ${data.githubSync?.error || 'unknown'}`);
    } catch (err: any) {
      console.error('[Admin] Force GitHub sync error:', err);
      alert(`GitHub sync failed: ${err.message}`);
    }
  };

  let filteredUsers = users;
  try {
    filteredUsers = users.filter(user => {
      if (!user) return false;
      const matchesSearch = (user.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (user.discordId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (user.discordUsername || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPlan = filterPlan === 'all' || user.plan === filterPlan;
      const matchesStatus = filterStatus === 'all' || user.accountStatus === filterStatus;
      return matchesSearch && matchesPlan && matchesStatus;
    });
  } catch (err) {
    console.error('[AdminPanel] filteredUsers computation crashed, falling back to unfiltered list:', err);
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background text-white">
      {/* Top Navbar */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-white/[0.04]">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Hexagon className="w-5 h-5 text-primary" />
            <span className="text-xs font-black uppercase tracking-[0.2em] text-white/80">Admin Core</span>
          </div>
          <div className="flex items-center gap-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-transparent text-white/30 border-transparent hover:bg-white/5 hover:text-white/50'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <StatCard icon={<UsersIcon className="w-3.5 h-3.5" />} label="Total Users" value={users.length} accent="text-primary" />
          <StatCard icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Active" value={users.filter(u => u.accountStatus === 'active').length} accent="text-green-500" />
          <StatCard icon={<Ban className="w-3.5 h-3.5" />} label="Inactive" value={users.filter(u => u.accountStatus !== 'active').length} accent="text-red-500" />
          <StatCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Revenue" value="—" accent="text-white/40" />
          <StatCard icon={<Zap className="w-3.5 h-3.5" />} label="Active Subs" value={users.filter(u => u.accountStatus === 'active').length} accent="text-orange-500" />
        </div>

        {activeTab !== 'users' && activeTab !== 'cdkeys' && (
          <AnalyticsDashboard />
        )}

        {activeTab === 'cdkeys' && (
          <CDKeyManager userId={auth.currentUser?.uid || ''} keys={allKeys} isAdmin={true} />
        )}

        {activeTab === 'users' && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="relative flex-shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                  <input
                    type="text"
                    placeholder="Search email or Discord ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-10 pl-10 pr-4 rounded-lg bg-white/[0.02] border border-white/[0.04] text-sm font-medium focus:ring-2 focus:ring-primary/20 focus:border-primary/20 outline-none transition-all w-full sm:w-72"
                  />
                </div>
                <select
                  value={filterPlan}
                  onChange={(e) => setFilterPlan(e.target.value)}
                  className="h-10 px-4 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer flex-shrink-0"
                >
                  <option value="all">All Plans</option>
                  <option value="aio">AIO</option>
                  <option value="single">Single</option>
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="h-10 px-4 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer flex-shrink-0"
                >
                  <option value="all">All States</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="expired">Expired</option>
                  <option value="disabled">Disabled</option>
                  <option value="banned">Banned</option>
                </select>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-white/20 flex-shrink-0">
                {filteredUsers.length} result{filteredUsers.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Full Width Table */}
            <div className="bg-white/[0.02] border border-white/[0.04] rounded-2xl overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/[0.04] bg-white/[0.02]">
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 w-[300px]">User</th>
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 w-[120px]">Plan</th>
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 w-[80px]">Role</th>
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 w-[100px]">Status</th>
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 w-[160px]">Expires</th>
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 w-[160px]">Discord</th>
                    <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white/20 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredUsers.map(user => {
                    try {
                      return (
                              <tr key={user?.id || 'unknown'} className="hover:bg-white/[0.01] transition-colors group">
                                {/* User Column */}
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-black text-primary flex-shrink-0">
                                      {(user?.email || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-sm font-bold text-white/80 truncate">{user?.email || 'No Email'}</div>
                                      <div className="text-[9px] font-mono text-white/20 truncate">{user?.id?.slice(0, 12) || '?'}</div>
                                    </div>
                                  </div>
                                </td>

                                {/* Plan Column */}
                                <td className="px-5 py-3 w-[140px]">
                                  {editingUser === user?.id ? (
                                    <div className="space-y-1.5">
                                      <select
                                        value={editForm.plan}
                                        onChange={(e) => setEditForm({...editForm, plan: e.target.value})}
                                        className="w-full h-8 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] font-black uppercase px-2"
                                      >
                                        <option value="none">None</option>
                                        <option value="trial">Trial</option>
                                        <option value="single">Single</option>
                                        <option value="aio">AIO</option>
                                      </select>
                                      <select
                                        value={editForm.accountStatus}
                                        onChange={(e) => setEditForm({...editForm, accountStatus: e.target.value})}
                                        className="w-full h-8 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] font-black uppercase px-2"
                                      >
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                        <option value="expired">Expired</option>
                                      </select>
                                      <select
                                        value={editForm.role}
                                        onChange={(e) => setEditForm({...editForm, role: e.target.value})}
                                        className="w-full h-8 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] font-black uppercase px-2"
                                      >
                                        <option value="user">User</option>
                                        <option value="trial">Trial</option>
                                        <option value="admin">Admin</option>
                                        <option value="owner">Owner</option>
                                      </select>
                                      <div className="space-y-1 pt-1">
                                        <label className="text-[9px] font-black text-white/25 uppercase tracking-widest block">AIO Expires</label>
                                        <input
                                          type="date"
                                          value={editForm.aioExpires || ''}
                                          onChange={(e) => setEditForm({...editForm, aioExpires: e.target.value || null})}
                                          className="w-full h-7 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] font-bold uppercase px-2 text-white/60"
                                        />
                                      </div>
                                      {editForm.plan !== 'aio' && editForm.plan !== 'trial' && (
                                        <div className="space-y-1 pt-1">
                                          <label className="text-[9px] font-black text-white/25 uppercase tracking-widest block">Classes</label>
                                          {editForm.classEntitlements && Object.entries(editForm.classEntitlements).map(([cls, ent]: [string, any]) => (
                                            <div key={cls} className="flex items-center gap-1">
                                              <span className="text-[9px] font-bold text-white/60 uppercase truncate w-14">{formatClassName(cls)}</span>
                                              <input
                                                type="date"
                                                value={ent?.expires || ''}
                                                onChange={(e) => {
                                                  const updated = { ...editForm.classEntitlements };
                                                  updated[cls] = { ...updated[cls], expires: e.target.value };
                                                  setEditForm({...editForm, classEntitlements: updated});
                                                }}
                                                className="flex-1 h-6 rounded bg-white/[0.02] border border-white/[0.04] text-[9px] font-bold uppercase px-1 text-white/60"
                                              />
                                              <button
                                                onClick={() => {
                                                  const updated = { ...editForm.classEntitlements };
                                                  delete updated[cls];
                                                  setEditForm({...editForm, classEntitlements: updated});
                                                }}
                                                className="p-1 rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                              >
                                                <Trash2 className="w-2.5 h-2.5" />
                                              </button>
                                            </div>
                                          ))}
                                          <div className="flex items-center gap-1 pt-1">
                                            <select
                                              value={editForm._newClass || ''}
                                              onChange={(e) => setEditForm({...editForm, _newClass: e.target.value})}
                                              className="flex-1 h-6 rounded bg-white/[0.02] border border-white/[0.04] text-[9px] font-bold uppercase px-1 text-white/60"
                                            >
                                              <option value="">Class</option>
                                              {['deathknight','demonhunter','druid','evoker','hunter','mage','monk','paladin','priest','rogue','shaman','warlock','warrior'].filter(c => !editForm.classEntitlements?.[c]).map(c => (
                                                <option key={c} value={c}>{formatClassName(c)}</option>
                                              ))}
                                            </select>
                                            <input
                                              type="date"
                                              value={editForm._newClassExpires || ''}
                                              onChange={(e) => setEditForm({...editForm, _newClassExpires: e.target.value})}
                                              className="h-6 rounded bg-white/[0.02] border border-white/[0.04] text-[9px] font-bold uppercase px-1 text-white/60"
                                            />
                                            <button
                                              onClick={() => {
                                                const cls = editForm._newClass;
                                                const exp = editForm._newClassExpires;
                                                if (!cls || !exp) return;
                                                const updated = { ...(editForm.classEntitlements || {}) };
                                                updated[cls] = { expires: exp, updatedAt: new Date().toISOString() };
                                                setEditForm({...editForm, classEntitlements: updated, _newClass: '', _newClassExpires: ''});
                                              }}
                                              className="p-1 rounded bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all"
                                            >
                                              <Plus className="w-2.5 h-2.5" />
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex flex-col gap-1">
                                      <span className={`w-fit px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${user?.plan && user?.plan !== 'none' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-white/5 text-white/40 border-white/5'}`}>
                                        {user?.plan || 'none'}
                                      </span>
                                      {user?.aioExpires && (() => {
                                        const d = user.aioExpires?.toDate ? user.aioExpires.toDate() : new Date(user.aioExpires);
                                        const active = !isNaN(d.getTime()) && d > new Date();
                                        return (
                                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${active ? 'bg-white/5 text-white/60 border-white/10' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                                            AIO {active ? d.toLocaleDateString() : 'Expired'}
                                          </span>
                                        );
                                      })()}
                                      {(() => {
                                        const d = user?.aioExpires?.toDate ? user.aioExpires.toDate() : new Date(user?.aioExpires);
                                        const aioActive = !isNaN(d.getTime()) && d > new Date();
                                        return !aioActive && user?.classEntitlements && Object.keys(user.classEntitlements).length > 0;
                                      })() && (
                                        <div className="flex flex-col gap-0.5">
                                          {Object.entries(user.classEntitlements).map(([cls, ent]: [string, any]) => {
                                            const d = ent?.expires?.toDate ? ent.expires.toDate() : new Date(ent?.expires);
                                            const active = !isNaN(d.getTime()) && d > new Date();
                                            return (
                                              <div key={cls} className="flex items-center gap-1">
                                                <span className={`w-1 h-1 rounded-full ${active ? 'bg-green-500' : 'bg-red-500'}`} />
                                                <span className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-white/60' : 'text-white/30'}`}>
                                                  {formatClassName(cls)}
                                                </span>
                                                <span className="text-[9px] text-white/30 tabular-nums">{d.toLocaleDateString()}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      {!user?.aioExpires && (!user?.classEntitlements || Object.keys(user.classEntitlements).length === 0) && user?.expiresAt && (
                                        <span className="text-[9px] text-white/20 font-bold uppercase tabular-nums">
                                          {typeof user.expiresAt.toDate === 'function' ? user.expiresAt.toDate().toLocaleDateString() : 'Unknown'}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>

                                {/* Role Column */}
                                <td className="px-5 py-3 w-[80px]">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${user?.role === 'admin' ? 'bg-primary/10 text-primary border-primary/20' : user?.role === 'owner' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : user?.role === 'trial' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' : 'bg-white/5 text-white/40 border-white/5'}`}>
                                    {user?.role || 'user'}
                                  </span>
                                </td>

                                {/* Status Column */}
                                <td className="px-5 py-3 w-[100px]">
                                  {(() => {
                                    if (user?.accountStatus === 'disabled') {
                                      return (
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                          <span className="text-[10px] font-black uppercase tracking-widest text-red-500">Disabled</span>
                                        </div>
                                      );
                                    }
                                    if (user?.accountStatus === 'banned') {
                                      return (
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                                          <span className="text-[10px] font-black uppercase tracking-widest text-orange-500">Banned</span>
                                        </div>
                                      );
                                    }
                                    const now = new Date();
                                    const legacyExpired = user?.expiresAt && typeof user.expiresAt.toDate === 'function' && user.expiresAt.toDate() < now;
                                    const aioExpired = user?.aioExpires && (() => { const d = user.aioExpires?.toDate ? user.aioExpires.toDate() : new Date(user.aioExpires); return !isNaN(d.getTime()) && d < now; })();
                                    const anyActiveClass = user?.classEntitlements && Object.values(user.classEntitlements).some((ent: any) => { const d = ent?.expires?.toDate ? ent.expires.toDate() : new Date(ent?.expires); return !isNaN(d.getTime()) && d >= now; });
                                    const isExpired = legacyExpired && !anyActiveClass && (!user?.aioExpires || aioExpired);
                                    const isActive = user?.accountStatus === 'active' && !isExpired;
                                    return (
                                      <div className="flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-green-500' : 'text-red-500'}`}>
                                          {isActive ? 'Active' : 'Inactive'}
                                        </span>
                                      </div>
                                    );
                                  })()}
                                </td>

                                {/* Expires Column */}
                                <td className="px-5 py-3 w-[140px]">
                                  {user?.aioExpires ? (
                                    <span className="text-[10px] font-bold text-white/60 tabular-nums">
                                      {(() => {
                                        const d = user.aioExpires?.toDate ? user.aioExpires.toDate() : new Date(user.aioExpires);
                                        return !isNaN(d.getTime()) ? `AIO: ${d.toLocaleDateString()}` : 'Invalid';
                                      })()}
                                    </span>
                                  ) : user?.classEntitlements && Object.keys(user.classEntitlements).length > 0 ? (
                                    <div className="flex flex-col gap-0.5">
                                      {Object.entries(user.classEntitlements).map(([cls, ent]: [string, any]) => {
                                        const d = ent?.expires?.toDate ? ent.expires.toDate() : new Date(ent?.expires);
                                        const active = !isNaN(d.getTime()) && d > new Date();
                                        return (
                                          <div key={cls} className="flex items-center gap-1">
                                            <span className={`w-1 h-1 rounded-full ${active ? 'bg-green-500' : 'bg-red-500'}`} />
                                            <span className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-white/60' : 'text-white/30'}`}>
                                              {formatClassName(cls)}
                                            </span>
                                            <span className="text-[9px] text-white/30 tabular-nums">{d.toLocaleDateString()}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : user?.expiresAt ? (
                                    <span className="text-[10px] font-bold text-white/60 tabular-nums">
                                      {typeof user.expiresAt.toDate === 'function' ? user.expiresAt.toDate().toLocaleDateString() : 'Unknown'}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-white/20">—</span>
                                  )}
                                </td>

                                {/* Discord Column */}
                                <td className="px-5 py-3 w-[160px]">
                                  {user?.discordId ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                                      <span className="text-[10px] font-bold text-white/60 truncate">
                                        {user?.discordUsername ? `@${user.discordUsername}` : 'Linked'}
                                      </span>
                                    </div>
                                  ) : user?.discordUsername ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
                                      <span className="text-[10px] font-bold text-white/40 truncate">@{user.discordUsername}</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-white/10 flex-shrink-0" />
                                      <span className="text-[10px] text-white/20">Not Linked</span>
                                    </div>
                                  )}
                                </td>

                                {/* Actions Column */}
                                <td className="px-5 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {editingUser === user?.id ? (
                                      <button
                                        onClick={() => handleUpdateUser(user?.id)}
                                        className="p-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white transition-all"
                                        title="Save"
                                      >
                                        <Save className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          const legacyClass = user?.selectedClass && !user?.classEntitlements ? { [user.selectedClass]: { expires: user?.expiresAt, updatedAt: user?.updatedAt } } : undefined;
                                          const rawClassEntitlements = user?.classEntitlements || legacyClass || {};
                                          // Normalize each class's `expires` (a Firestore Timestamp) to a plain
                                          // YYYY-MM-DD string for the date input - Timestamp instances don't
                                          // survive JSON.stringify + the REST hop to the update endpoint.
                                          const classEntitlements: Record<string, any> = {};
                                          for (const [cls, ent] of Object.entries<any>(rawClassEntitlements)) {
                                            const expiresDate = ent?.expires?.toDate ? ent.expires.toDate() : (ent?.expires instanceof Date ? ent.expires : null);
                                            classEntitlements[cls] = { expires: expiresDate ? expiresDate.toISOString().split('T')[0] : '' };
                                          }
                                          const aioDate = user?.aioExpires?.toDate ? user.aioExpires.toDate().toISOString().split('T')[0] : (user?.aioExpires instanceof Date ? user.aioExpires.toISOString().split('T')[0] : '');
                                          setEditForm({
                                            plan: user?.plan,
                                            accountStatus: user?.accountStatus,
                                            role: user?.role || 'user',
                                            aioExpires: aioDate || null,
                                            _originalAioExpires: aioDate || null,
                                            classEntitlements
                                          });
                                          setEditingUser(user?.id);
                                        }}
                                        className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-primary/10 hover:text-primary transition-all"
                                        title="Edit"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => onViewUser(user?.id)}
                                      className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:bg-primary/10 hover:text-primary transition-all"
                                      title="View Profile"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDevCheckout(user, 'aio')}
                                      className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all"
                                      title="Grant AIO"
                                    >
                                      <Zap className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        const cls = prompt('Grant which class? (lowercase, e.g. warrior, shaman)', 'warrior');
                                        if (cls) handleDevCheckout(user, 'single', cls.trim().toLowerCase());
                                      }}
                                      className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all"
                                      title="Grant Single"
                                    >
                                      <Ticket className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDevCheckout(user, 'trial')}
                                      className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500 hover:bg-purple-500 hover:text-white transition-all"
                                      title="Grant Trial"
                                    >
                                      <Clock className="w-3.5 h-3.5" />
                                    </button>
                                    {(user?.accountStatus === 'disabled' || user?.accountStatus === 'banned') ? (
                                      <button
                                        onClick={() => {
                                          setModalUser(user);
                                          setModalType('enable');
                                          setModalError(null);
                                        }}
                                        className="p-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white transition-all"
                                        title="Enable User"
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setModalUser(user);
                                          setModalType('disable');
                                          setModalError(null);
                                        }}
                                        className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-white transition-all"
                                        title="Disable User"
                                      >
                                        <Ban className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setModalUser(user);
                                        setModalType('delete');
                                        setDeleteConfirmText('');
                                        setModalError(null);
                                      }}
                                      className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                      title="Delete User"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleForceGithubSync(user)}
                                      className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all"
                                      title="Force GitHub Sync"
                                    >
                                      <Github className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          } catch (err) {
                            console.error('AdminPanel user render error', err);
                            return (
                              <tr key={user?.id || 'unknown'}>
                                <td colSpan={6} className="px-5 py-3">
                                  <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Render Error — check console</span>
                                </td>
                              </tr>
                            );
                          }
                        })}
                      </tbody>
                    </table>
                  </div>


                </>
              )}
            </div>

            {/* Disable/Enable/Delete Confirmation Modal */}
            {modalType && modalUser && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => { setModalUser(null); setModalType(null); setDeleteConfirmText(''); setModalError(null); }} />
                <div className="relative w-full max-w-md bg-surface-dark border border-white/10 rounded-[32px] overflow-hidden shadow-2xl flex flex-col pt-10 pb-8 px-8 space-y-6">
                  <div className="text-center space-y-2">
                    <h2 className="text-xl font-black font-display uppercase tracking-widest italic text-white">
                      {modalType === 'disable' ? 'Disable User' : modalType === 'enable' ? 'Enable User' : 'Delete User'}
                    </h2>
                    <p className="text-white/40 text-xs font-medium">
                      {modalType === 'delete'
                        ? `Permanently delete ${modalUser.email || modalUser.id}? This cannot be undone.`
                        : `${modalType === 'disable' ? 'Disable' : 'Enable'} ${modalUser.email || modalUser.id}?`}
                    </p>
                  </div>

                  {modalType === 'delete' && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-white/40">
                        Type DELETE to confirm
                      </label>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => {
                          setDeleteConfirmText(e.target.value);
                          if (modalError) setModalError(null);
                        }}
                        placeholder="DELETE"
                        className="w-full h-12 px-4 rounded-xl bg-background border border-white/10 text-white font-bold text-sm uppercase tracking-widest outline-none focus:border-red-500 transition-colors"
                      />
                    </div>
                  )}

                  {modalError && (
                    <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold text-center">
                      {modalError}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setModalUser(null); setModalType(null); setDeleteConfirmText(''); setModalError(null); }}
                      className="flex-1 h-12 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={actionLoading}
                      onClick={() => {
                        console.log('[Delete Modal] confirm clicked');
                        if (modalType === 'delete') {
                          handleDeleteAction(modalUser);
                        } else {
                          handleDisableAction(modalUser, modalType);
                        }
                      }}
                      className={`flex-1 h-12 rounded-xl text-white text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                        modalType === 'delete' ? 'bg-red-500 hover:bg-red-600' :
                        modalType === 'disable' ? 'bg-yellow-500 hover:bg-yellow-600' :
                        'bg-green-500 hover:bg-green-600'
                      }`}
                    >
                      {actionLoading
                        ? (modalType === 'delete' ? 'Deleting...' : modalType === 'disable' ? 'Disabling...' : 'Enabling...')
                        : (modalType === 'delete' ? 'Permanently Delete' : modalType === 'disable' ? 'Disable User' : 'Enable User')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
      );
    }
