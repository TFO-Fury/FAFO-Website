import { useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  updateDoc, 
  deleteDoc, 
  doc, 
  setDoc,
  getDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface CDKeyManagerProps {
  userId: string;
  keys: any[];
  isAdmin: boolean;
}

export function CDKeyManager({ userId, keys, isAdmin }: CDKeyManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAddKey = async () => {
    const trimmedKey = manualKey.trim().toUpperCase();
    if (!trimmedKey) return;
    
    console.log(`[CDKeyManager] Requesting activation for key: ${trimmedKey} for user ${userId}`);
    setIsSubmitting(true);
    
    try {
      const url = '/api/keys/activate';
      console.log("Calling API:", url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: trimmedKey,
          userId: userId
        })
      });

      console.log(`[CDKeyManager] Activation response status: ${res.status}`);
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error(`[CDKeyManager] Non-JSON response received:`, text.substring(0, 200));
        throw new Error(`Server returned non-JSON response (${res.status}). Check server logs.`);
      }

      const data = await res.json();

      if (res.ok && data.success) {
        console.log(`[CDKeyManager] Activation successful for key: ${trimmedKey}`);
        setManualKey('');
        setIsAdding(false);
        alert("Key activated successfully!");
      } else {
        console.error(`[CDKeyManager] Activation logic failed:`, data.error);
        throw new Error(data.error || `Activation failed with status ${res.status}`);
      }
    } catch (err: any) {
      console.error("[CDKeyManager] Activation Error:", err);
      alert(`Activation Error: ${err.message || "Unknown communication error"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivateKey = async (keyId: string) => {
    console.log(`[CDKeyManager] Requesting deactivation for key: ${keyId}`);
    setIsSubmitting(true);
    try {
      const url = '/api/keys/deactivate';
      console.log("Calling API:", url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error || "Failed to deactivate key");
      }
      
      console.log(`[CDKeyManager] Deactivation successful for key: ${keyId}`);
      alert("Key deactivated successfully.");
    } catch (err: any) {
      console.error("[CDKeyManager] Deactivation Error:", err);
      alert(`Deactivation Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveKey = async (keyId: string) => {
    console.log(`[CDKeyManager] Attempting to remove: ${keyId}`);
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'cd_keys', keyId));
      console.log(`[CDKeyManager] Successfully removed: ${keyId}`);
      setConfirmDeleteId(null);
      // Trigger license sync after key removal
      fetch('/api/sync-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      }).then(async r => {
        const data = await r.json().catch(() => ({}));
        console.log('[CDKeyManager] License sync after removal:', data);
      }).catch(err => {
        console.error('[CDKeyManager] License sync after removal failed:', err);
      });
    } catch (err: any) {
      console.error(`[CDKeyManager] Remove failed:`, err);
      try {
        handleFirestoreError(err, OperationType.DELETE, `cd_keys/${keyId}`);
      } catch (formattedErr: any) {
        let msg = formattedErr.message;
        try {
          const data = JSON.parse(formattedErr.message);
          msg = `${data.error}\nPath: ${data.path}`;
        } catch (e) {}
        alert(`Remove Failed: ${msg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#1a1d23] rounded-lg border border-white/5 p-8 shadow-2xl space-y-8">
      <h2 className="text-4xl font-bold text-white tracking-tight">CD Keys</h2>

      <div className="space-y-10">
        {keys.length === 0 ? (
          <p className="text-white/20 font-bold uppercase tracking-widest text-xs italic">No CD Keys found for this account.</p>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="space-y-6">
              <div className="space-y-3">
                <div className="flex flex-col gap-3">
                  <p className="text-white text-lg font-bold">
                    Key: <span className="font-medium opacity-90 break-all">{key.key}</span>
                  </p>
                  <p className="text-white text-lg font-bold">
                    Status: <span className="font-medium opacity-90">{key.status === 'active' ? 'Active' : 'Inactive'}</span>
                  </p>
                  <p className="text-white text-lg font-bold">
                    Last Used: <span className="font-medium opacity-90">
                      {key.lastUsedAt ? key.lastUsedAt.toDate().toLocaleString() : 'Never'}
                    </span>
                  </p>
                </div>

                  <div className="flex flex-wrap gap-4 pt-4">
                    {confirmDeleteId === key.id ? (
                      <div className="flex items-center gap-4 bg-red-500/10 p-4 rounded-lg border border-red-500/20 w-full md:w-auto">
                        <p className="text-xs font-bold text-red-500 uppercase tracking-wider">Permanent Delete?</p>
                        <button 
                          disabled={isSubmitting}
                          onClick={() => handleRemoveKey(key.id)}
                          className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded transition-all disabled:opacity-50"
                        >
                          {isSubmitting ? 'DELETING...' : 'YES'}
                        </button>
                        <button 
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded transition-all"
                        >
                          NO
                        </button>
                      </div>
                    ) : (
                      <>
                        <button 
                          disabled={isSubmitting}
                          onClick={() => handleDeactivateKey(key.id)}
                          className="px-8 py-3 bg-[#dc3545] hover:bg-[#bb2d3b] text-white text-xs font-black uppercase tracking-widest rounded-lg transition-all disabled:opacity-50"
                        >
                          {isSubmitting ? '...' : 'DEACTIVATE'}
                        </button>
                        <button 
                          onClick={() => setConfirmDeleteId(key.id)}
                          className="px-8 py-3 bg-[#dc3545] hover:bg-[#bb2d3b] text-white text-xs font-black uppercase tracking-widest rounded-lg transition-all"
                        >
                          DELETE
                        </button>
                      </>
                    )}
                  </div>
              </div>
              <div className="h-px bg-white/5 w-full" />
            </div>
          ))
        )}
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4 bg-black/30 p-6 rounded-xl border border-white/5"
          >
            <div className="space-y-2">
              <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Enter CD Key Manually</label>
              <input 
                autoFocus
                type="text"
                placeholder="Paste your key here..."
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                className="w-full bg-[#0d0e12] border border-white/10 rounded-lg px-4 py-4 text-white font-mono text-sm outline-none focus:border-green-500/50 transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
              />
            </div>
            <div className="flex gap-3">
              <button 
                disabled={isSubmitting || !manualKey.trim()}
                onClick={handleAddKey}
                className="flex-1 bg-[#198754] hover:bg-[#157347] disabled:opacity-50 text-white font-black uppercase tracking-widest py-4 rounded-lg text-xs transition-colors"
              >
                {isSubmitting ? 'VERIFYING...' : 'ADD KEY'}
              </button>
              <button 
                onClick={() => { setIsAdding(false); setManualKey(''); }}
                className="px-6 bg-white/5 hover:bg-white/10 text-white/40 font-bold rounded-lg text-xs uppercase"
              >
                CANCEL
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!isAdding && (
        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={() => setIsAdding(true)}
            className="px-10 py-4 bg-[#198754] hover:bg-[#157347] text-white text-sm font-black uppercase tracking-widest rounded-lg transition-all shadow-xl shadow-green-950/20"
          >
            ADD NEW CD KEY
          </button>
        </div>
      )}
    </div>
  );
}
