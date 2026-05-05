import { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy, updateDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, 
  CreditCard, 
  Hexagon, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Link as LinkIcon,
  ShoppingBag,
  Ticket,
  Zap as ZapIcon,
  Calendar,
  AlertCircle,
  Trash2,
  Lock
} from 'lucide-react';

interface DashboardProps {
  onUpgrade: () => void;
  targetUserId?: string | null;
}

export function Dashboard({ onUpgrade, targetUserId }: DashboardProps) {
  const isAdminViewing = !!targetUserId;
  const currentUid = targetUserId || auth.currentUser?.uid;

  const [userData, setUserData] = useState<any>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [userKeys, setUserKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [activationCode, setActivationCode] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [activationResult, setActivationResult] = useState<{success: boolean, message: string} | null>(null);

  // Admin Override States
  const [adminDiscordId, setAdminDiscordId] = useState('');
  const [adminPlan, setAdminPlan] = useState('');
  const [adminStatus, setAdminStatus] = useState('');
  const [adminExpiresAt, setAdminExpiresAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!currentUid) return;

    const userPath = `users/${currentUid}`;
    const unsubUser = onSnapshot(doc(db, 'users', currentUid), (docSnapshot) => {
      const data = docSnapshot.data();
      setUserData(data);
      if (data) {
        setAdminDiscordId(data.discordId || '');
        setAdminPlan(data.plan || 'none');
        setAdminStatus(data.accountStatus || 'inactive');
        if (data.expiresAt) {
          const date = data.expiresAt.toDate();
          setAdminExpiresAt(date.toISOString().split('T')[0]);
        }
      }
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, userPath);
      setError("Failed to load profile.");
      setLoading(false);
    });

    const purchasesPath = 'purchases';
    const purchasesQuery = query(
      collection(db, 'purchases'), 
      where('userId', '==', currentUid),
      orderBy('createdAt', 'desc')
    );

    const unsubPurchases = onSnapshot(purchasesQuery, (snapshot) => {
      setPurchases(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, purchasesPath);
    });

    const keysQuery = query(
      collection(db, 'cd_keys'),
      where('userId', '==', currentUid)
    );
    const unsubKeys = onSnapshot(keysQuery, (snapshot) => {
      setUserKeys(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubUser();
      unsubPurchases();
      unsubKeys();
    };
  }, [currentUid]);

  const handleAdminUpdate = async () => {
    if (!currentUid || !isAdminViewing) return;
    setIsSaving(true);
    try {
      const userRef = doc(db, 'users', currentUid);
      const updates: any = {
        discordId: adminDiscordId,
        plan: adminPlan,
        accountStatus: adminStatus,
        updatedAt: new Date()
      };
      
      if (adminExpiresAt) {
        updates.expiresAt = new Date(adminExpiresAt);
      }

      await updateDoc(userRef, updates);
      alert("User updated successfully.");
    } catch (err) {
      alert("Failed to update user.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdminSyncRoles = async () => {
    if (!currentUid) return;
    try {
      const res = await fetch('/api/admin/user/sync-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUid })
      });
      const data = await res.json();
      alert(data.success ? "Roles synced!" : "Sync failed: " + data.error);
    } catch (err) {
      alert("Role sync error.");
    }
  };

  const handleRemoveKey = async (keyId: string) => {
    if (!confirm("Remove this key from user?")) return;
    try {
      await updateDoc(doc(db, 'cd_keys', keyId), { 
        userId: null, 
        status: 'unused',
        updatedAt: new Date()
      });
    } catch (err) {
      alert("Failed to remove key.");
    }
  };

  const handleActivateKey = async () => {
    if (!activationCode.trim()) return;
    setIsActivating(true);
    setActivationResult(null);

    try {
      const res = await fetch('/api/keys/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: activationCode.trim().toUpperCase(),
          userId: currentUid
        })
      });

      const data = await res.json();
      if (data.success) {
        setActivationResult({ success: true, message: `Access Unlocked: ${data.plan.toUpperCase()} plan active!` });
        setActivationCode('');
      } else {
        setActivationResult({ success: false, message: data.error || 'Activation failed' });
      }
    } catch (err) {
      setActivationResult({ success: false, message: 'Server error during activation' });
    } finally {
      setIsActivating(false);
    }
  };

  const handleLinkDiscord = async () => {
    try {
      const roleType = userData?.plan === 'aio' ? 'aio' : (userData?.plan === 'trial' ? 'trial' : 'one-class');
      const res = await fetch(`/api/auth/discord/url?roleType=${roleType}&userId=${currentUid}`);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned ${res.status}`);
      }

      const { url } = await res.json();
      
      const width = 500;
      const height = 750;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      window.open(url, 'discord_auth', `width=${width},height=${height},left=${left},top=${top}`);
    } catch (err: any) {
      console.error(err);
      alert(`Discord Link Error: ${err.message || "Failed to initiate link"}`);
    }
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isExpired = userData?.expiresAt && userData.expiresAt.toDate() < new Date();

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 space-y-12">
      {isAdminViewing && (
        <div className="flex items-center justify-between p-6 bg-primary/10 border border-primary/20 rounded-3xl animate-pulse-subtle">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-primary tracking-[0.2em] leading-none mb-1">Privileged Access</p>
              <h2 className="text-xl font-black font-display uppercase italic tracking-tighter text-white">Admin Viewing User</h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button 
              onClick={handleAdminSyncRoles}
              className="px-6 h-10 rounded-xl bg-white/5 border border-white/5 text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white transition-all"
            >
              Sync Roles
            </button>
            <button 
              onClick={handleAdminUpdate}
              disabled={isSaving}
              className="px-8 h-10 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
            >
              {isSaving ? 'Saving...' : 'Push Updates'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-black font-display uppercase italic tracking-tighter">
            {isAdminViewing ? "User Command Center" : "Your Command Center"}
          </h1>
          <p className="text-white/40 font-medium tracking-tight uppercase text-xs tracking-[0.2em]">Manage subscriptions and access</p>
        </div>
        
        {userData?.role === 'admin' && (
          <div className="px-4 py-2 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-black uppercase text-primary tracking-widest">Admin Access Enabled</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Card */}
        <div className="p-8 rounded-[32px] bg-surface-dark border border-white/5 space-y-6 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/10">
              <User className="w-8 h-8" />
            </div>
            <div>
              <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">User Profile</p>
              <p className="text-lg font-bold text-white tracking-tight">{userData?.email || 'Unknown'}</p>
              {isAdminViewing && (
                <p className="text-[9px] font-mono font-bold text-white/20 uppercase tracking-widest">{currentUid}</p>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 space-y-5">
            {isAdminViewing ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Subscription Tier</label>
                  <select 
                    value={adminPlan}
                    onChange={(e) => setAdminPlan(e.target.value)}
                    className="w-full h-11 bg-background border border-white/10 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest text-white/60 outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="none">None</option>
                    <option value="trial">Trial</option>
                    <option value="single">Single</option>
                    <option value="aio">AIO</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Account Status</label>
                  <select 
                    value={adminStatus}
                    onChange={(e) => setAdminStatus(e.target.value)}
                    className="w-full h-11 bg-background border border-white/10 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest text-white/60 outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Expiration Date</label>
                  <input 
                    type="date"
                    value={adminExpiresAt}
                    onChange={(e) => setAdminExpiresAt(e.target.value)}
                    className="w-full h-11 bg-background border border-white/10 rounded-xl px-4 text-[10px] font-black uppercase tracking-widest text-white/60 outline-none focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">Tier</span>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${userData?.plan && userData?.plan !== 'none' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-white/5 text-white/20 border-white/5 '}`}>
                    {userData?.plan === 'aio' ? 'All-In-One' : userData?.plan === 'single' ? 'Single Class' : userData?.plan === 'trial' ? '3-Day Trial' : 'No License'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">Account Status</span>
                  <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${userData?.accountStatus === 'active' && !isExpired ? 'text-green-500' : 'text-red-500'}`}>
                    {userData?.accountStatus === 'active' && !isExpired ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {isExpired ? 'Expired' : userData?.accountStatus || 'Inactive'}
                  </span>
                </div>
                {userData?.expiresAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">Expires</span>
                    <span className="text-[10px] font-bold text-white/60 tabular-nums">
                      {userData.expiresAt.toDate().toLocaleDateString()}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* CD Key Activation Card */}
        <div className="p-8 rounded-[32px] bg-surface-dark border border-white/5 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Ticket size={80} strokeWidth={1} />
          </div>
          
          <div className="space-y-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-500 border border-orange-500/10">
                <Lock className="w-8 h-8" />
              </div>
              <div>
                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">License Auth</p>
                <p className="text-lg font-bold text-white tracking-tight">Manage Key</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="FAFO-XXXX-XXXX-XXXX"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value)}
                  disabled={isActivating}
                  className="w-full h-14 bg-background border border-white/10 rounded-2xl px-6 text-sm font-mono font-bold tracking-widest placeholder:text-white/10 outline-none focus:ring-2 focus:ring-primary/20 transition-all uppercase"
                />
                <button 
                  onClick={handleActivateKey}
                  disabled={isActivating || !activationCode.trim()}
                  className="absolute right-2 top-2 h-10 px-6 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary-dark transition-all disabled:opacity-30 active:scale-95 shadow-lg shadow-primary/20"
                >
                  {isActivating ? '...' : isAdminViewing ? 'Inject' : 'Unlock'}
                </button>
              </div>

              <AnimatePresence>
                {activationResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`p-4 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-3 border ${activationResult.success ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}
                  >
                    {activationResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {activationResult.message}
                  </motion.div>
                )}
              </AnimatePresence>

              {userKeys.length > 0 && (
                <div className="pt-4 border-t border-white/5 space-y-3">
                  <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Associated Keys</p>
                  <div className="space-y-2">
                    {userKeys.map(k => (
                      <div key={k.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <span className="text-[10px] font-mono font-bold text-white/50">{k.key}</span>
                        {isAdminViewing ? (
                          <button 
                            onClick={() => handleRemoveKey(k.id)}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                            title="Remove Key from User"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="text-[9px] font-black uppercase text-primary/60">{k.plan}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Discord Card */}
        <div className="p-8 rounded-[32px] bg-surface-dark border border-white/5 flex flex-col justify-between space-y-6 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Hexagon size={80} strokeWidth={1} />
          </div>

          <div className="space-y-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-[#5865F2]/10 flex items-center justify-center text-[#5865F2] border border-[#5865F2]/10">
                <Hexagon className="w-8 h-8" />
              </div>
              <div>
                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Social Sync</p>
                <p className="text-lg font-bold text-white tracking-tight">Community Link</p>
              </div>
            </div>

            <div className="pt-6 border-t border-white/5 space-y-4">
              {isAdminViewing ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Manual Discord ID</label>
                  <input 
                    type="text"
                    value={adminDiscordId}
                    onChange={(e) => setAdminDiscordId(e.target.value)}
                    placeholder="Enter Discord UID"
                    className="w-full h-12 bg-background border border-white/10 rounded-2xl px-5 text-sm font-bold tracking-tight text-white/60 outline-none focus:ring-2 focus:ring-[#5865F2]/20 transition-all"
                  />
                </div>
              ) : (
                userData?.discordId ? (
                  <div className="p-5 rounded-2xl bg-green-500/5 border border-green-500/10 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-green-500 uppercase tracking-widest leading-none mb-1">Authenticated</p>
                      <p className="text-xs font-bold text-white/40 tabular-nums">Linked: {userData.discordId}</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-white/20" />
                    </div>
                    <p className="text-xs font-bold text-white/20 italic">No Discord account detected</p>
                  </div>
                )
              )}
            </div>
          </div>

          {!userData?.discordId && !isAdminViewing && (
            <button 
              onClick={handleLinkDiscord}
              className="w-full h-14 rounded-2xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl shadow-[#5865F2]/20 relative z-10"
            >
              Sign Link Identity
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Active Subscriptions */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <ZapIcon className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-black font-display uppercase tracking-widest italic">Live Contracts</h2>
          </div>
          
          <div className="p-8 rounded-[32px] bg-gradient-to-br from-surface-dark to-black border border-white/5 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-white/25 uppercase tracking-[0.3em]">Current Status</p>
                  <h3 className="text-3xl font-black font-display uppercase italic tracking-tighter text-white">
                    {userData?.plan === 'none' || !userData?.plan ? 'RECON READY' : `${userData.plan} ACTIVE`}
                  </h3>
                </div>
                
                {userData?.expiresAt && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/5">
                      <Calendar className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[10px] font-black uppercase text-white/60 tracking-widest">
                        Until {userData.expiresAt.toDate().toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  onClick={onUpgrade}
                  className="h-12 px-8 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary-dark transition-all shadow-lg shadow-primary/20"
                >
                  {userData?.plan === 'none' ? 'Enlist Now' : 'Extend Duration'}
                </button>
                {userData?.plan !== 'none' && (
                  <button className="h-12 px-8 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 text-[10px] font-black uppercase tracking-widest transition-all">
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Purchase History */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-black font-display uppercase tracking-widest italic">Order Log</h2>
          </div>

          <div className="overflow-hidden rounded-[32px] border border-white/5 bg-surface-dark shadow-2xl">
            <div className="max-h-[300px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-surface-dark z-20">
                  <tr className="border-b border-white/5">
                    <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Entity</th>
                    <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Value</th>
                    <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Timestamp</th>
                    <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {purchases.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-8 py-12 text-center text-[10px] font-black text-white/10 italic uppercase tracking-widest">System log empty</td>
                    </tr>
                  ) : (
                    purchases.map((order) => (
                      <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-8 py-6">
                          <span className="text-xs font-black text-white uppercase tracking-tight">{order.plan} License</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-xs font-black text-primary italic tracking-widest">${order.amount}</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-[10px] font-bold text-white/30 tabular-nums">{order.createdAt?.toDate().toLocaleDateString()}</span>
                        </td>
                        <td className="px-8 py-6">
                          <div className={`w-2 h-2 rounded-full ${order.status === 'completed' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]'}`} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShieldCheck({ className }: { className: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
