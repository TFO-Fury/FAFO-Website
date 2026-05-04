import { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, onSnapshot, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import { 
  Search, 
  Edit3, 
  Save, 
  X, 
  ShieldCheck, 
  Clock,
  ShieldAlert
} from 'lucide-react';

export function AdminPanel() {
  const [users, setUsers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPlan, setFilterPlan] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const usersPath = 'users';
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, usersPath);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleUpdateUser = async (userId: string) => {
    const userPath = `users/${userId}`;
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        ...editForm,
        updatedAt: new Date()
      });
      setEditingUser(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userPath);
      alert("Failed to update user. Permissions likely denied.");
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.email?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         user.discordId?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPlan = filterPlan === 'all' || user.plan === filterPlan;
    const matchesStatus = filterStatus === 'all' || user.accountStatus === filterStatus;
    return matchesSearch && matchesPlan && matchesStatus;
  });

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" />
            <h1 className="text-4xl font-black font-display uppercase italic tracking-tighter">Admin Core</h1>
          </div>
          <p className="text-white/40 font-medium text-xs uppercase tracking-widest">Global user and contract management</p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input 
              type="text"
              placeholder="Search Email/Discord..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-12 pl-12 pr-6 rounded-xl bg-surface-dark border border-white/5 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none transition-all w-full md:w-64"
            />
          </div>
          <select 
            value={filterPlan} 
            onChange={(e) => setFilterPlan(e.target.value)}
            className="h-12 px-5 rounded-xl bg-surface-dark border border-white/5 text-xs font-black uppercase tracking-widest outline-none cursor-pointer"
          >
            <option value="all">All Plans</option>
            <option value="aio">AIO</option>
            <option value="single">Single</option>
            <option value="none">None</option>
          </select>
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-12 px-5 rounded-xl bg-surface-dark border border-white/5 text-xs font-black uppercase tracking-widest outline-none cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[32px] border border-white/5 bg-surface-dark shadow-2xl">
        <table className="w-full text-left border-collapse min-w-[1000px]">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">User Profile</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Contract Detail</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Integrations</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Created</th>
              <th className="px-8 py-6 text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredUsers.map(user => (
              <tr key={user.id} className="hover:bg-white/[0.01] transition-colors group">
                <td className="px-8 py-6">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white tracking-tight">{user.email}</span>
                    <span className="text-[10px] text-white/20 font-black uppercase tracking-widest flex items-center gap-1.5 mt-1">
                      {user.isAdmin && <ShieldAlert className="w-3 h-3 text-primary" />}
                      {user.id}
                    </span>
                  </div>
                </td>
                <td className="px-8 py-6">
                  {editingUser === user.id ? (
                    <div className="space-y-2">
                      <select 
                        value={editForm.plan} 
                        onChange={(e) => setEditForm({...editForm, plan: e.target.value})}
                        className="w-full p-2 rounded-lg bg-background border border-white/10 text-xs font-bold uppercase"
                      >
                        <option value="none">None</option>
                        <option value="single">Single</option>
                        <option value="aio">AIO</option>
                      </select>
                      <select 
                        value={editForm.accountStatus} 
                        onChange={(e) => setEditForm({...editForm, accountStatus: e.target.value})}
                        className="w-full p-2 rounded-lg bg-background border border-white/10 text-xs font-bold uppercase"
                      >
                        <option value="inactive">Inactive</option>
                        <option value="active">Active</option>
                        <option value="expired">Expired</option>
                      </select>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <span className={`w-fit px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${user.plan !== 'none' ? 'bg-primary/20 text-primary' : 'bg-white/5 text-white/40'}`}>
                        {user.plan}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-tight ${user.accountStatus === 'active' ? 'text-green-500' : 'text-red-500'}`}>
                        {user.accountStatus}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-8 py-6">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-white/60">Discord: <span className={user.discordId ? "text-primary font-bold" : "text-white/20 italic"}>{user.discordId || 'Not Linked'}</span></span>
                  </div>
                </td>
                <td className="px-8 py-6">
                  <div className="flex items-center gap-2 text-white/30">
                    <Clock className="w-3 h-3" />
                    <span className="text-xs font-medium">{user.createdAt?.toDate?.()?.toLocaleDateString() || 'N/A'}</span>
                  </div>
                </td>
                <td className="px-8 py-6">
                  <div className="flex items-center gap-2">
                    {editingUser === user.id ? (
                      <>
                        <button 
                          onClick={() => handleUpdateUser(user.id)}
                          className="p-2 rounded-lg bg-green-500/20 text-green-500 hover:bg-green-500 hover:text-white transition-all shadow-lg shadow-green-500/10"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setEditingUser(null)}
                          className="p-2 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 transition-all font-bold"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button 
                        onClick={() => {
                          setEditingUser(user.id);
                          setEditForm({ plan: user.plan, accountStatus: user.accountStatus });
                        }}
                        className="p-2 rounded-lg bg-white/5 text-white/40 opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shadow-xl"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
