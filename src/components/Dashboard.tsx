import { useState, useEffect, useRef } from 'react';
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
  Lock,
  Plus,
  ShieldCheck as ShieldCheckIcon
} from 'lucide-react';
import { CDKeyManager } from './CDKeyManager';
import { isAdmin, isOwner } from './Auth';

function formatClassName(val: any): string {
  if (!val) return 'Unknown Class';
  if (typeof val !== 'string') return String(val);
  const trimmed = val.trim();
  if (!trimmed) return 'Unknown Class';
  return trimmed.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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

  const [discordUsernameInput, setDiscordUsernameInput] = useState('');
  const [isSavingDiscordUsername, setIsSavingDiscordUsername] = useState(false);
  const discordUsernameSeededRef = useRef(false);

  const [isCancellingSubscription, setIsCancellingSubscription] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

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
        if (data.expiresAt && typeof data.expiresAt.toDate === 'function') {
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

    console.log("[Dashboard] current uid:", auth.currentUser?.uid);

    // Backend writes order records to 'orders' collection.
    // Checkout paths verified:
    //  - api/paypal/capture-order.ts  → firestore.collection('orders').add({ userId, plan, amount, paymentStatus, createdAt, ... })
    //  - api/paypal/webhook.ts        → firestore.collection('orders').add({ userId, plan, amount, paymentStatus, createdAt, ... })
    //  - src/components/CheckoutModal  → addDoc(collection(db, 'orders'), { userId: user.uid, plan, amount, paymentStatus, createdAt, ... })
    //  - api/dev/fake-checkout.ts     → firestore.collection('orders').add({ userId, plan, amount, paymentStatus, createdAt, ... })
    const ordersQuery = query(
      collection(db, 'orders'),
      where('userId', '==', currentUid)
    );
    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log("[Dashboard] raw firestore orders:", data);
      data.sort((a: any, b: any) => {
        const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return bTime.getTime() - aTime.getTime();
      });
      console.log("[Dashboard] filtered user orders:", data);
      setPurchases(data);
    }, (err) => {
      console.error("[Dashboard] orders fetch error:", err);
      handleFirestoreError(err, OperationType.LIST, 'orders');
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
      unsubOrders();
      unsubKeys();
    };
  }, [currentUid]);

  // Seed the self-reported Discord username field once when the profile first
  // loads, without clobbering it while the user is actively editing it.
  useEffect(() => {
    if (userData && !discordUsernameSeededRef.current) {
      setDiscordUsernameInput(userData.discordUsername || '');
      discordUsernameSeededRef.current = true;
    }
  }, [userData]);

  // Auto-expiration observer
  useEffect(() => {
    if (!userData || isAdminViewing) return;
    
    const checkExpiration = async () => {
      if (userData.expiresAt && typeof userData.expiresAt.toDate === 'function' && userData.accountStatus === 'active') {
        const expiry = userData.expiresAt.toDate();
        if (expiry < new Date()) {
          console.log("[Auto-Expire] Plan has ended. Updating status...");
          try {
            await updateDoc(doc(db, 'users', currentUid!), {
              accountStatus: 'expired',
              updatedAt: new Date()
            });
          } catch (err) {
            console.error("[Auto-Expire] Failed to deactivate user:", err);
          }
        }
      }
    };

    checkExpiration();
    const interval = setInterval(checkExpiration, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [userData, currentUid, isAdminViewing]);

  const handleAdminUpdate = async () => {
    if (!currentUid || !isAdminViewing) return;
    setIsSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const updates: any = {
        discordId: adminDiscordId,
        plan: adminPlan,
        accountStatus: adminStatus,
      };

      if (adminExpiresAt) {
        updates.expiresAt = new Date(adminExpiresAt);
      }

      const res = await fetch('/api/admin/user/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: currentUid, updates })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      alert("User updated successfully.");
    } catch (err: any) {
      alert(`Failed to update user: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdminSyncRoles = async () => {
    if (!currentUid) return;
    try {
      const url = '/api/admin/user/sync-roles';
      console.log("Calling API:", url);
      const res = await fetch(url, {
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
      // Trigger license sync to reflect removed key
      if (currentUid) {
        fetch('/api/sync-license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUid })
        }).then(async r => {
          const data = await r.json().catch(() => ({}));
          console.log('[Dashboard] License sync after key removal:', data);
        }).catch(err => {
          console.error('[Dashboard] License sync after key removal failed:', err);
        });
      }
    } catch (err) {
      alert("Failed to remove key.");
    }
  };

  const handleActivateKey = async () => {
    if (!activationCode.trim()) return;
    setIsActivating(true);
    setActivationResult(null);

    try {
      const url = '/api/keys/activate';
      console.log("Calling API:", url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: activationCode.trim().toUpperCase(),
          userId: currentUid,
          selectedClass: userData?.selectedClass || undefined
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
      // roleType is just a debugging hint now - the server computes the
      // actual Discord role from real Firestore entitlements at link time,
      // never from this client-supplied value (see auth/discord/callback.ts).
      const roleType = userData?.plan || 'none';
      const params = new URLSearchParams({
        roleType,
        userId: currentUid ?? '',
      });
      const url = `/api/auth/discord/url?${params.toString()}`;
      console.log("Calling API:", url);
      const res = await fetch(url);
      
      if (!res.ok) {
        let details = `Server returned ${res.status}`;
        try {
          const errorData = await res.json();
          if (errorData.error) details = errorData.error;
          if (errorData.suggested) details += `\n\nSuggestion: ${errorData.suggested}`;
          if (errorData.debug) details += `\n\nRoute: ${errorData.debug.method} ${errorData.debug.originalUrl}`;
        } catch (e) {
          // If not JSON, try to get text to see if it's an HTML error page
          const text = await res.text().catch(() => "");
          if (text.includes("<!DOCTYPE html>")) {
            details += "\n\nThe server returned an HTML page instead of JSON. This usually means the API route is not properly registered or is being intercepted by a static file handler.";
          }
        }
        throw new Error(details);
      }

      const data = await res.json();
      console.log("[Discord] Generated Redirect URI:", data.redirectUri);
      console.log("[Discord] Make sure this EXACT URL is in your Discord Developer Portal -> OAuth2 -> Redirects");

      window.location.href = data.url;
    } catch (err: any) {
      console.error("[Discord Link Error]", err);
      const is404 = err.message.includes('404');
      const errorMsg = err.message || "Unknown error";
      
      const tip = is404 
        ? "\n\nServer 404: The API route is missing. Please refresh the page and try again."
        : `\n\nDebug Info:\nOrigin: ${window.location.origin}\nUID: ${currentUid}\n\nEnsure this EXACT URL is in your Discord Portal:\n${window.location.origin}/auth/discord/callback`;
          
      alert(`Discord Connection Error: ${errorMsg}${tip}`);
    }
  };

  const handleSaveDiscordUsername = async () => {
    if (!currentUid) return;
    setIsSavingDiscordUsername(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const res = await fetch('/api/user/update-discord-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ discordUsername: discordUsernameInput })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err: any) {
      console.error('[Dashboard] Failed to save Discord username:', err);
      alert(`Failed to save Discord username: ${err.message}`);
    } finally {
      setIsSavingDiscordUsername(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!currentUid) return;
    setShowCancelConfirm(false);
    setIsCancellingSubscription(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken(true);

      const res = await fetch('/api/paypal/cancel-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: currentUid })
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      alert('Subscription cancelled. You\'ll keep access until it expires.');
    } catch (err: any) {
      console.error('[Dashboard] Failed to cancel subscription:', err);
      alert(`Failed to cancel subscription: ${err.message}`);
    } finally {
      setIsCancellingSubscription(false);
    }
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const now = new Date();
  const legacyExpired = userData?.expiresAt && typeof userData.expiresAt.toDate === 'function' && userData.expiresAt.toDate() < now;
  const aioExpired = userData?.aioExpires && (() => {
    const d = userData.aioExpires?.toDate ? userData.aioExpires.toDate() : new Date(userData.aioExpires);
    return !isNaN(d.getTime()) && d < now;
  })();
  const anyActiveClass = userData?.classEntitlements && Object.values(userData.classEntitlements).some((ent: any) => {
    const d = ent?.expires?.toDate ? ent.expires.toDate() : new Date(ent?.expires);
    return !isNaN(d.getTime()) && d >= now;
  });
  const isExpired = legacyExpired && !anyActiveClass && (!userData?.aioExpires || aioExpired);

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
        
        {(isAdmin(userData) || isOwner(userData)) && (
          <div className="px-4 py-2 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-black uppercase text-primary tracking-widest">
              {isOwner(userData) ? 'Owner Access Enabled' : 'Admin Access Enabled'}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Card */}
        <div className="p-8 rounded-[32px] bg-surface-dark border border-white/5 space-y-6 shadow-2xl lg:col-span-1">
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

                {/* AIO Status */}
                {userData?.aioExpires && (() => {
                  const aioDate = userData.aioExpires?.toDate ? userData.aioExpires.toDate() : new Date(userData.aioExpires);
                  const aioActive = !isNaN(aioDate.getTime()) && aioDate > new Date();
                  return (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">AIO Access</span>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${aioActive ? 'bg-white/5 text-white/60 border-white/10' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                        {aioActive ? `Until ${aioDate.toLocaleDateString()}` : 'Expired'}
                      </span>
                    </div>
                  );
                })()}

                {/* Subscription Status */}
                {userData?.subscriptionId && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">Subscription</span>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${userData?.subscriptionStatus === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-white/5 text-white/40 border-white/10'}`}>
                        {userData?.subscriptionStatus === 'active' ? 'Auto-Renews' : userData?.subscriptionStatus === 'cancelled' ? 'Cancelled' : userData?.subscriptionStatus === 'suspended' ? 'Suspended' : userData?.subscriptionStatus === 'expired' ? 'Expired' : 'Unknown'}
                      </span>
                    </div>
                    {userData?.subscriptionStatus === 'active' && (
                      showCancelConfirm ? (
                        <div className="space-y-2 p-3 rounded-lg border border-[#dc3545]/30 bg-[#dc3545]/5">
                          <p className="text-[10px] font-bold text-white/60 text-center">
                            Cancel your subscription? You'll keep access until your current period ends, but it won't auto-renew.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={handleCancelSubscription}
                              disabled={isCancellingSubscription}
                              className="flex-1 py-2.5 bg-[#dc3545] hover:bg-[#bb2d3b] text-white text-xs font-black uppercase tracking-widest rounded-lg transition-all disabled:opacity-50"
                            >
                              {isCancellingSubscription ? 'Cancelling...' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setShowCancelConfirm(false)}
                              disabled={isCancellingSubscription}
                              className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white text-xs font-black uppercase tracking-widest rounded-lg transition-all disabled:opacity-50"
                            >
                              No
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowCancelConfirm(true)}
                          className="w-full py-3 bg-[#dc3545] hover:bg-[#bb2d3b] text-white text-xs font-black uppercase tracking-widest rounded-lg transition-all"
                        >
                          Cancel Subscription
                        </button>
                      )
                    )}
                  </div>
                )}

                {/* Class Entitlements — hidden when AIO active */}
                {(() => {
                  const aioDate = userData?.aioExpires?.toDate ? userData.aioExpires.toDate() : new Date(userData?.aioExpires);
                  const aioActive = !isNaN(aioDate.getTime()) && aioDate > new Date();
                  return !aioActive && userData?.classEntitlements && Object.keys(userData.classEntitlements).length > 0;
                })() && (
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <span className="text-[10px] font-black text-white/25 uppercase tracking-widest block">Class Entitlements</span>
                    {Object.entries(userData.classEntitlements).map(([cls, ent]: [string, any]) => {
                      const expRaw = ent?.expires;
                      const expDate = expRaw?.toDate ? expRaw.toDate() : new Date(expRaw);
                      const isActive = !isNaN(expDate.getTime()) && expDate > new Date();
                      return (
                        <div key={cls} className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{formatClassName(cls)}</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${isActive ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                            {isActive ? `Until ${expDate.toLocaleDateString()}` : 'Expired'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Legacy fallback display */}
                {!userData?.aioExpires && (!userData?.classEntitlements || Object.keys(userData.classEntitlements).length === 0) && userData?.expiresAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">Expires</span>
                    <span className="text-[10px] font-bold text-white/60 tabular-nums">
                      {typeof userData.expiresAt.toDate === 'function' ? userData.expiresAt.toDate().toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-white/25 uppercase tracking-widest">Account Status</span>
                  <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${userData?.accountStatus === 'active' && !isExpired ? 'text-green-500' : 'text-red-500'}`}>
                    {userData?.accountStatus === 'active' && !isExpired ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {isExpired ? 'Expired' : userData?.accountStatus || 'Inactive'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Discord Card */}
        <div className="p-8 rounded-[32px] bg-surface-dark border border-white/5 flex flex-col justify-between space-y-6 shadow-2xl relative overflow-hidden group lg:col-span-2">
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
                      <p className="text-xs font-bold text-white/40 tabular-nums">
                        Linked: {userData.discordUsername ? `@${userData.discordUsername}` : userData.discordId}
                      </p>
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

              {!isAdminViewing && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-white/20 uppercase tracking-widest">Discord Username</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={discordUsernameInput}
                      onChange={(e) => setDiscordUsernameInput(e.target.value)}
                      placeholder="e.g. bobsmith"
                      className="flex-1 h-12 bg-background border border-white/10 rounded-2xl px-5 text-sm font-bold tracking-tight text-white/60 outline-none focus:ring-2 focus:ring-[#5865F2]/20 transition-all"
                    />
                    <button
                      onClick={handleSaveDiscordUsername}
                      disabled={isSavingDiscordUsername}
                      className="h-12 px-5 rounded-2xl bg-[#5865F2]/10 border border-[#5865F2]/20 text-[#5865F2] text-[10px] font-black uppercase tracking-widest hover:bg-[#5865F2] hover:text-white transition-all disabled:opacity-50"
                    >
                      {isSavingDiscordUsername ? '...' : 'Save'}
                    </button>
                  </div>
                  <p className="text-[10px] text-white/20">
                    {userData?.discordId
                      ? "Automatically set from your linked Discord account."
                      : "Let us know your Discord username so we can recognize you in the community, even before you link your account."}
                  </p>
                </div>
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

      <div className="grid grid-cols-1 gap-8">
        {/* Purchase History */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-black font-display uppercase tracking-widest italic">Order Log</h2>
          </div>

          <div className="overflow-hidden rounded-[32px] border border-white/5 bg-surface-dark shadow-2xl">
            <div className="max-h-[400px] overflow-y-auto">
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
                    purchases.map((order) => {
                      const entity = order.plan || order.type || order.product || 'Unknown';
                      const value = order.amount ?? order.total ?? order.price ?? 0;
                      const status = order.paymentStatus || order.status || 'pending';
                      let tsDisplay = 'N/A';
                      try {
                        const ts = order.createdAt || order.timestamp;
                        if (ts?.toDate) {
                          tsDisplay = ts.toDate().toLocaleDateString();
                        } else if (ts) {
                          const d = new Date(ts);
                          if (!isNaN(d.getTime())) tsDisplay = d.toLocaleDateString();
                        }
                      } catch (e) {}
                      return (
                        <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-8 py-6">
                            <span className="text-xs font-black text-white uppercase tracking-tight">{entity} License</span>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-xs font-black text-primary italic tracking-widest">${value}</span>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-[10px] font-bold text-white/30 tabular-nums">{tsDisplay}</span>
                          </td>
                          <td className="px-8 py-6">
                            <div className={`w-2 h-2 rounded-full ${status === 'completed' || status === 'COMPLETED' || status === 'paid' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]'}`} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <CDKeyManager 
        userId={currentUid!} 
        keys={userKeys} 
        isAdmin={isAdmin(userData) || isAdminViewing}
      />
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
