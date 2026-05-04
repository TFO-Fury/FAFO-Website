import { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { motion } from 'motion/react';
import { 
  User, 
  CreditCard, 
  Hexagon, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Link as LinkIcon,
  ShoppingBag
} from 'lucide-react';

interface DashboardProps {
  onUpgrade: () => void;
}

export function Dashboard({ onUpgrade }: DashboardProps) {
  const [userData, setUserData] = useState<any>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    const userPath = `users/${auth.currentUser.uid}`;
    const unsubUser = onSnapshot(doc(db, 'users', auth.currentUser.uid), (docSnapshot) => {
      setUserData(docSnapshot.data());
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, userPath);
      setError("Failed to load profile.");
      setLoading(false);
    });

    const purchasesPath = 'purchases';
    const purchasesQuery = query(
      collection(db, 'purchases'), 
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubPurchases = onSnapshot(purchasesQuery, (snapshot) => {
      setPurchases(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, purchasesPath);
    });

    return () => {
      unsubUser();
      unsubPurchases();
    };
  }, []);

  const handleLinkDiscord = async () => {
    try {
      const roleType = userData?.plan === 'aio' ? 'aio' : 'one-class';
      const res = await fetch(`/api/auth/discord/url?roleType=${roleType}`);
      const { url } = await res.json();
      
      const width = 500;
      const height = 750;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      window.open(url, 'discord_auth', `width=${width},height=${height},left=${left},top=${top}`);
    } catch (err) {
      console.error(err);
      alert("Failed to initiate Discord link.");
    }
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-black font-display uppercase italic tracking-tighter">Your Command Center</h1>
        <p className="text-white/40 font-medium tracking-tight uppercase text-xs tracking-[0.2em]">Manage your subscriptions and access</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Card */}
        <div className="p-8 rounded-3xl bg-surface-dark border border-white/5 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <User className="w-8 h-8" />
            </div>
            <div>
              <p className="text-xs font-black text-white/40 uppercase tracking-widest">Account</p>
              <p className="text-lg font-bold text-white tracking-tight">{auth.currentUser?.email}</p>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white/30 uppercase tracking-widest">Plan</span>
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${userData?.plan !== 'none' ? 'bg-primary/20 text-primary' : 'bg-white/5 text-white/30'}`}>
                {userData?.plan === 'aio' ? 'All-In-One' : userData?.plan === 'single' ? 'Single Class' : 'No Active Plan'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white/30 uppercase tracking-widest">Status</span>
              <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${userData?.accountStatus === 'active' ? 'text-green-500' : 'text-red-500'}`}>
                {userData?.accountStatus === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {userData?.accountStatus}
              </span>
            </div>
          </div>
        </div>

        {/* Discord Card */}
        <div className="p-8 rounded-3xl bg-surface-dark border border-white/5 flex flex-col justify-between space-y-6">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-[#5865F2]/10 flex items-center justify-center text-[#5865F2]">
                <Hexagon className="w-8 h-8" />
              </div>
              <div>
                <p className="text-xs font-black text-white/40 uppercase tracking-widest">Community</p>
                <p className="text-lg font-bold text-white tracking-tight">Discord Link</p>
              </div>
            </div>

            <div className="pt-6 border-t border-white/5">
              {userData?.discordId ? (
                <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/10 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-[10px] font-black text-green-500 uppercase tracking-widest">Linked Successfully</p>
                    <p className="text-xs font-bold text-white/60">ID: {userData.discordId}</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
                  <LinkIcon className="w-5 h-5 text-white/20" />
                  <p className="text-xs font-bold text-white/40 italic">Discord account not connected</p>
                </div>
              )}
            </div>
          </div>

          {!userData?.discordId && (
            <button 
              onClick={handleLinkDiscord}
              className="w-full h-14 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 active:scale-95 shadow-lg shadow-[#5865F2]/20"
            >
              Connect Discord
            </button>
          )}
        </div>

        {/* Stats/Action Card */}
        <div className="p-8 rounded-3xl bg-[#3d1a2d] border border-primary/20 flex flex-col justify-between overflow-hidden relative">
          <div className="absolute -right-4 -bottom-4 opacity-5 rotate-12 scale-150">
            <Zap size={120} />
          </div>
          
          <div className="space-y-6 relative z-10">
            <h3 className="text-xl font-black font-display uppercase tracking-wider italic">Quick Actions</h3>
            <div className="grid grid-cols-1 gap-3">
              <button className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left group">
                <Clock className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold uppercase tracking-widest">Manage Subscription</span>
              </button>
              <button 
                onClick={onUpgrade}
                className={`flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left group w-full ${userData?.plan !== 'aio' ? 'ring-2 ring-primary/20 animate-pulse-subtle' : ''}`}
              >
                <ShoppingBag className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold uppercase tracking-widest">
                  {userData?.plan === 'single' ? 'Upgrade to All-In-One' : 'Upgrade Plan'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Purchase History */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-black font-display uppercase tracking-widest italic">Order History</h2>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-white/5 bg-surface-dark bg-opacity-50">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Plan</th>
                <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Amount</th>
                <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Date</th>
                <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-xs font-bold text-white/20 italic uppercase tracking-widest">No order records found</td>
                </tr>
              ) : (
                purchases.map((order) => (
                  <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-8 py-6">
                      <span className="text-sm font-bold text-white uppercase tracking-tight">{order.plan} Access</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-sm font-black text-primary italic">${order.amount}</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className="text-xs font-medium text-white/40">{order.createdAt?.toDate().toLocaleDateString()}</span>
                    </td>
                    <td className="px-8 py-6">
                      <span className={`text-[10px] font-black uppercase tracking-widest ${order.status === 'completed' ? 'text-green-500' : 'text-orange-500'}`}>
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Reuse icon
function Zap({ size }: { size: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}
