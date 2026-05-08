import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CreditCard, Zap, ChevronDown, CheckCircle2, Hexagon, FlaskConical } from 'lucide-react';
import { db } from '../lib/firebase';
import { doc, setDoc, updateDoc, getDoc, serverTimestamp, collection, addDoc, deleteField } from 'firebase/firestore';
import PayPalCheckout from './PayPalCheckout';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  userData?: any;
  cart: any[];
  total: number;
  isDiscordLinked: boolean;
  onSuccess: () => void;
}

export function CheckoutModal({ isOpen, onClose, user, userData, cart, total, isDiscordLinked, onSuccess }: CheckoutModalProps) {
  const [step, setStep] = useState<'payment' | 'success'>('payment');
  const [loading, setLoading] = useState(false);
  const [isDiscordLoading, setIsDiscordLoading] = useState(false);

  const handlePayment = async (method: string) => {
    console.log(`[CheckoutModal] Processing payment via ${method}`);
    if (!user) {
      alert("Session expired. Please log in again.");
      return;
    }

    try {
      setLoading(true);
      console.log("[CheckoutModal] Determining plan...");
      
      const hasTrial = cart.some(i => i.type === 'trial');
      const plan = hasTrial ? 'trial' : (cart.some(i => i.type === 'aio') ? 'aio' : 'single');
      const singleClassItem = cart.find(i => i.type === 'one-class');
      const className = singleClassItem?.wowClass || null;

      const expirationDate = new Date();
      // Trial: 3 days, Others: 30 days
      const daysToAdd = plan === 'trial' ? 3 : 30;
      expirationDate.setDate(expirationDate.getDate() + daysToAdd);

      console.log(`[CheckoutModal] User: ${user.uid}, Plan: ${plan}, Days: ${daysToAdd}, Expires: ${expirationDate}, Class: ${className || 'none'}`);

      // 1. Update Profile
      console.log("[CheckoutModal] Updating Firestore profile...");
      const userRef = doc(db, 'users', user.uid);
      const updateData: any = {
        plan: plan,
        accountStatus: 'active',
        updatedAt: serverTimestamp()
      };

      if (hasTrial) {
        updateData.trialUsed = true;
      }

      if (plan === 'aio' || plan === 'trial') {
        // AIO fully replaces single-class entitlements
        updateData.aioExpires = expirationDate;
        updateData.isAio = true;
        updateData.classEntitlements = deleteField();
        updateData.selectedClass = deleteField();
        console.log(`[CheckoutModal] Setting aioExpires=${expirationDate.toISOString()}, cleared classEntitlements`);
      } else if (plan === 'single' && className) {
        // Single class: merge into classEntitlements without overwriting other classes
        updateData.isAio = false;
        // Use dot-path merge via update() to avoid overwriting the whole map
        // Since setDoc with merge:true merges top-level but may replace nested maps,
        // we do a separate update for classEntitlements after the main setDoc
        console.log(`[CheckoutModal] Adding classEntitlements.${className} expires=${expirationDate.toISOString()}`);
      } else {
        // Generic fallback
        updateData.expiresAt = expirationDate;
        console.log(`[CheckoutModal] Setting generic expiresAt=${expirationDate.toISOString()}`);
      }

      await setDoc(userRef, updateData, { merge: true });

      // Separate update for classEntitlements to safely merge one class without overwriting others
      if (plan === 'single' && className) {
        try {
          await updateDoc(userRef, {
            [`classEntitlements.${className}.expires`]: expirationDate,
            [`classEntitlements.${className}.updatedAt`]: serverTimestamp()
          });
          console.log(`[CheckoutModal] classEntitlements.${className} update SUCCESS`);
        } catch (e) {
          console.error(`[CheckoutModal] classEntitlements update failed:`, e);
          // Fallback to setDoc with full classEntitlements object (reads current data first)
          const snap = await getDoc(userRef);
          const existing = snap.exists() ? (snap.data()?.classEntitlements || {}) : {};
          await setDoc(userRef, {
            classEntitlements: {
              ...existing,
              [className]: { expires: expirationDate, updatedAt: new Date() }
            }
          }, { merge: true });
          console.log(`[CheckoutModal] classEntitlements fallback set SUCCESS`);
        }
      }

      console.log("[CheckoutModal] Profile update SUCCESS");

      // 2. Log Purchase
      try {
        console.log("[CheckoutModal] Logging purchase record...");
        await addDoc(collection(db, 'purchases'), {
          userId: user.uid,
          plan,
          amount: total,
          status: 'completed',
          createdAt: serverTimestamp()
        });
        console.log("[CheckoutModal] Purchase log SUCCESS");
      } catch (e) {
        console.warn("[CheckoutModal] Purchase log failed (non-critical):", e);
      }

      // 3. Notify Hub
      console.log("[CheckoutModal] Notifying backend...");
      const notifyUrl = '/api/payment/simulate';
      console.log("Calling API:", notifyUrl);
      fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, plan, amount: total })
      }).then(() => console.log("[CheckoutModal] Backend notified"))
        .catch(err => console.error("[CheckoutModal] Backend notification error:", err));

      // 4. Trigger GitHub license sync
      try {
        const syncRes = await fetch('/api/sync-license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid })
        });
        const syncData = await syncRes.json().catch(() => ({}));
        console.log('[CheckoutModal] License sync result:', syncData);
      } catch (syncErr) {
        console.error('[CheckoutModal] License sync failed (non-critical):', syncErr);
      }

      console.log("[CheckoutModal] Transitioning to success step");
      setStep('success');
    } catch (err: any) {
      console.error("[CheckoutModal] CRITICAL ERROR:", err);
      alert(`Payment sync failed: ${err.message || "Unknown error"}. Please take a screenshot and contact support.`);
    } finally {
      console.log("[CheckoutModal] Payment process finished (finally)");
      setLoading(false);
    }
  };

  const handleDiscordLink = async () => {
    try {
      setIsDiscordLoading(true);
      const roleTypes = Array.from(new Set(cart.map(i => i.type))).join(',');
      const params = new URLSearchParams({
        roleType: roleTypes,
        userId: user.uid,
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
      console.error("[Discord Checkout Error]", err);
      const is404 = err.message.includes('404');
      const errorMsg = err.message || "Unknown error";
      
      const tip = is404 
        ? "\n\nServer 404: The API route is missing or the server restarted. Try again in 5 seconds."
        : `\n\nDebug Info:\nOrigin: ${window.location.origin}\nUser: ${user?.uid}\n\nEnsure this EXACT URL is in your Discord Portal:\n${window.location.origin}/auth/discord/callback`;
          
      alert(`Discord Error: ${errorMsg}${tip}`);
    } finally {
      setIsDiscordLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/90 backdrop-blur-xl"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-[#1a1d23] border border-white/10 rounded-[32px] shadow-2xl overflow-hidden"
          >
            <div className="p-10 pt-12 pb-10">
              <button 
                onClick={onClose}
                className="absolute top-6 right-6 p-2 text-white/40 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              {step === 'payment' ? (
                <div className="space-y-8">
                  <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black font-display uppercase tracking-widest italic text-white">Checkout</h2>
                    <p className="text-white/40 text-sm font-medium">
                      {cart.some(i => i.name.includes("Upgrade")) ? 'Prorated Difference: ' : 'Billed monthly: '}
                      <span className="text-primary font-bold italic">${total}</span>
                    </p>
                    {cart.some(i => i.name.includes("Upgrade")) && (
                      <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 mt-2">
                        <Zap className="w-3 h-3 text-primary" />
                        <p className="text-[10px] text-primary font-black uppercase tracking-widest">Upgrade Proration Applied</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    {/* Normal users: real PayPal checkout only */}
                    {userData?.role !== 'admin' && userData?.role !== 'owner' ? (
                      <div className="space-y-4">
                        {(() => {
                          const singleClassItem = cart.find(i => i.type === 'one-class');
                          const plan = cart.some(i => i.type === 'trial')
                            ? 'trial'
                            : cart.some(i => i.type === 'aio')
                              ? 'aio'
                              : 'single';
                          return (
                            <PayPalCheckout
                              plan={plan}
                              className={singleClassItem?.wowClass || undefined}
                              amount={String(total)}
                              userId={user?.uid}
                              onSuccess={(result) => {
                                console.log('[CheckoutModal] PayPal success:', result);
                                setStep('success');
                                onSuccess();
                              }}
                              onError={(err) => {
                                console.error('[CheckoutModal] PayPal error:', err);
                                alert('Payment failed. Please try again.');
                              }}
                            />
                          );
                        })()}
                      </div>
                    ) : (
                      <>
                        {/* Admin/Owner: real PayPal + DEV TEST options */}
                        <div className="space-y-4">
                          {(() => {
                            const singleClassItem = cart.find(i => i.type === 'one-class');
                            const plan = cart.some(i => i.type === 'trial')
                              ? 'trial'
                              : cart.some(i => i.type === 'aio')
                                ? 'aio'
                                : 'single';
                            return (
                              <PayPalCheckout
                                plan={plan}
                                className={singleClassItem?.wowClass || undefined}
                                amount={String(total)}
                                userId={user?.uid}
                                onSuccess={(result) => {
                                  console.log('[CheckoutModal] PayPal success:', result);
                                  setStep('success');
                                  onSuccess();
                                }}
                                onError={(err) => {
                                  console.error('[CheckoutModal] PayPal error:', err);
                                  alert('Payment failed. Please try again.');
                                }}
                              />
                            );
                          })()}
                        </div>

                        <div className="relative flex items-center justify-center">
                          <div className="absolute inset-0 border-t border-white/5" />
                          <span className="relative px-3 text-[10px] font-black uppercase tracking-widest text-white/20 bg-[#1a1d23]">
                            Dev Tools
                          </span>
                        </div>

                        <button
                          disabled={loading}
                          onClick={() => handlePayment('DevTest')}
                          className="w-full p-6 rounded-2xl border border-yellow-500/10 bg-yellow-500/5 hover:bg-yellow-500/10 hover:border-yellow-500/30 transition-all flex items-center justify-between group disabled:opacity-50"
                        >
                          <div className="flex items-center gap-4 text-left">
                            <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-yellow-500/60 group-hover:text-yellow-500">
                              {loading ? <div className="w-5 h-5 border-2 border-yellow-500 border-t-transparent animate-spin rounded-full" /> : <FlaskConical />}
                            </div>
                            <div>
                              <p className="font-bold text-white uppercase tracking-widest text-sm">Dev Grant</p>
                              <p className="text-[10px] text-yellow-500/40 font-bold uppercase tracking-widest">Skip Payment · Admin Only</p>
                            </div>
                          </div>
                          <ChevronDown className="w-5 h-5 -rotate-90 text-white/10 group-hover:text-yellow-500 transition-colors" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-8 text-center">
                  <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto border border-primary/20">
                    <CheckCircle2 className="w-10 h-10 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-3xl font-black font-display uppercase tracking-widest italic text-white">Success!</h2>
                    <p className="text-white/60 text-sm">Membership activated.</p>
                  </div>

                  <div className="p-6 rounded-3xl bg-primary/5 border border-primary/20 space-y-6">
                    <div className="flex items-center gap-4">
                      <Hexagon className="w-10 h-10 text-primary" />
                      <div className="text-left font-bold uppercase tracking-tight">
                        <p className="text-[10px] text-primary tracking-widest">Next Step</p>
                        <p className="text-white">Get Discord Roles</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleDiscordLink}
                      disabled={isDiscordLoading || isDiscordLinked}
                      className={`w-full h-14 rounded-xl text-white text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 ${isDiscordLinked ? 'bg-green-500' : 'bg-[#5865F2] hover:bg-[#4752C4]'}`}
                    >
                      {isDiscordLoading ? 'Connecting...' : isDiscordLinked ? 'Discord Linked' : 'Link Discord'}
                    </button>
                  </div>

                  <button 
                    onClick={() => {
                      onSuccess();
                      onClose();
                    }}
                    className="w-full text-xs font-black text-white/30 hover:text-white uppercase tracking-[0.3em] transition-colors"
                  >
                    Return to Dashboard
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
