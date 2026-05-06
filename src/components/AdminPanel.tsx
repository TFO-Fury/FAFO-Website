import { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
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
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AdminPanelProps {
  onViewUser: (userId: string) => void;
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
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        ...editForm,
        updatedAt: new Date()
      });
      setEditingUser(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
      alert("Failed to update user.");
    }
  };

  const filteredUsers = users.filter(user => {
    const userKeys = allKeys.filter(k => k.userId === user.id).map(k => k.key.toLowerCase());
    const matchesSearch = user.email?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         user.discordId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         userKeys.some(k => k.includes(searchTerm.toLowerCase()));
    const matchesPlan = filterPlan === 'all' || user.plan === filterPlan;
    const matchesStatus = filterStatus === 'all' || user.accountStatus === filterStatus;
    return matchesSearch && matchesPlan && matchesStatus;
  });

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 space-y-12">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-black font-display uppercase italic tracking-tighter leading-none">Admin Core</h1>
              <p className="text-white/40 font-medium text-[10px] uppercase tracking-widest mt-1">Global User and Contract Management</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/5">
              <UsersIcon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-widest text-white">
                Total Users
                <span className="ml-2 text-primary">[{users.length}]</span>
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/5 rounded-xl border border-green-500/10">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-green-500/60">
                Active
                <span className="ml-2 text-green-500">[{users.filter(u => u.accountStatus === 'active').length}]</span>
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/5 rounded-xl border border-red-500/10">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500/40" />
              <span className="text-[10px] font-black uppercase tracking-widest text-red-500/60">
                Inactive
                <span className="ml-2 text-red-500">[{users.filter(u => u.accountStatus !== 'active').length}]</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input 
              type="text"
              placeholder="Search Email/Discord/Key..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-12 pl-12 pr-6 rounded-xl bg-surface-dark border border-white/5 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none transition-all w-full md:w-64"
            />
          </div>
          <select 
            value={filterPlan} 
            onChange={(e) => setFilterPlan(e.target.value)}
            className="h-12 px-5 rounded-xl bg-surface-dark border border-white/5 text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer"
          >
            <option value="all">All Plans</option>
            <option value="aio">AIO</option>
            <option value="single">Single</option>
          </select>
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-12 px-5 rounded-xl bg-surface-dark border border-white/5 text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer"
          >
            <option value="all">All States</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-x-auto rounded-[32px] border border-white/5 bg-surface-dark shadow-2xl overflow-hidden"
      >
        <table className="w-full text-left border-collapse min-w-[1000px]">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">User Profile</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Subscription</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Linked Data</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Created</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredUsers.map(user => (
              <tr key={user.id} className="hover:bg-white/[0.01] transition-colors group">
                <td className="px-8 py-6">
                  <div className="flex flex-col gap-1">
                    <span className="text-white font-bold text-sm tracking-tight">{user.email}</span>
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="text-[9px] font-mono text-white/20 uppercase truncate max-w-[120px]">{user.id}</span>
                      {user.role === 'admin' && <ShieldCheck className="w-3 h-3 text-primary flex-shrink-0" />}
                    </div>
                  </div>
                </td>
                <td className="px-8 py-6">
                  {editingUser === user.id ? (
                    <div className="space-y-2">
                      <select 
                        value={editForm.plan} 
                        onChange={(e) => setEditForm({...editForm, plan: e.target.value})}
                        className="w-full h-9 rounded-lg bg-background border border-white/10 text-xs font-bold uppercase px-3"
                      >
                        <option value="none">None</option>
                        <option value="trial">Trial</option>
                        <option value="single">Single</option>
                        <option value="aio">AIO</option>
                      </select>
                      <select 
                        value={editForm.accountStatus} 
                        onChange={(e) => setEditForm({...editForm, accountStatus: e.target.value})}
                        className="w-full h-9 rounded-lg bg-background border border-white/10 text-xs font-bold uppercase px-3"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="expired">Expired</option>
                      </select>
                      <select 
                        value={editForm.role} 
                        onChange={(e) => setEditForm({...editForm, role: e.target.value})}
                        className="w-full h-9 rounded-lg bg-background border border-white/10 text-xs font-bold uppercase px-3"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <span className={`w-fit px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${user.plan !== 'none' ? 'bg-primary/20 text-primary border border-primary/20' : 'bg-white/5 text-white/40'}`}>
                        {user.plan}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-tight ${user.accountStatus === 'active' ? 'text-green-500' : 'text-red-500'}`}>
                        {user.accountStatus}
                      </span>
                      {user.expiresAt && (
                        <span className="text-[10px] text-white/20 font-bold uppercase tabular-nums">
                          Expires: {user.expiresAt?.toDate().toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-8 py-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Discord</span>
                      <span className={user.discordId ? "text-[11px] text-primary font-bold" : "text-[11px] text-white/20 italic"}>{user.discordId || 'Not Linked'}</span>
                    </div>
                    {allKeys.filter(k => k.userId === user.id).map(key => (
                      <div key={key.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Key</span>
                          <span className="text-[11px] text-orange-500 font-mono font-bold truncate max-w-[150px]" title={key.key}>{key.key}</span>
                        </div>
                        <div className="flex items-center gap-2 pl-2 border-l border-white/5">
                          <span className="text-[9px] font-black text-white/10 uppercase tracking-widest">Tier</span>
                          <span className="text-[9px] text-white/40 font-bold uppercase">{key.plan || 'AIO'}</span>
                        </div>
                      </div>
                    ))}
                    {user.entitlements?.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Entitled</span>
                        <span className="text-[10px] text-white/60 font-bold">{user.entitlements.length} Slots</span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-8 py-6">
                  <div className="flex items-center gap-2 text-white/30">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-medium tabular-nums">{user.createdAt?.toDate?.()?.toLocaleDateString() || 'N/A'}</span>
                  </div>
                </td>
                <td className="px-8 py-6">
                  <div className="flex items-center gap-2">
                    {editingUser === user.id ? (
                      <>
                        <button 
                          onClick={() => handleUpdateUser(user.id)}
                          className="p-2.5 rounded-xl bg-green-500/20 text-green-500 hover:bg-green-500 hover:text-white transition-all shadow-lg shadow-green-500/10"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setEditingUser(null)}
                          className="p-2.5 rounded-xl bg-white/5 text-white/40 hover:bg-white/10 transition-all font-bold"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => onViewUser(user.id)}
                          className="px-4 py-2 rounded-xl bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-white transition-all shadow-xl opacity-0 group-hover:opacity-100 flex items-center gap-2"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Adjust
                        </button>
                        <button 
                          onClick={() => {
                            setEditingUser(user.id);
                            setEditForm({ 
                              plan: user.plan, 
                              accountStatus: user.accountStatus,
                              role: user.role || 'user'
                            });
                          }}
                          className="p-2.5 rounded-xl bg-white/5 text-white/40 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shadow-xl"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
}
