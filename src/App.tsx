/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { 
  Swords, 
  Zap, 
  Timer, 
  Shield, 
  CheckCircle2, 
  ChevronDown, 
  Hexagon,
  ShoppingCart,
  X,
  Trash2,
  AlertCircle,
  CreditCard,
  User as UserIcon,
  LayoutDashboard,
  Settings,
  LogOut
} from "lucide-react";
import { useState, useEffect } from "react";
import { auth, db } from "./lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, addDoc, setDoc } from "firebase/firestore";
import { Auth, logout } from "./components/Auth";
import { Dashboard } from "./components/Dashboard";
import { AdminPanel } from "./components/AdminPanel";
import { CheckoutModal } from "./components/CheckoutModal";

const NAV_LINKS = [
  { name: "Pricing", href: "#plans" }
];

const FEATURES = [
  { icon: <Swords className="w-5 h-5" />, text: "PVP READY" },
  { icon: <Zap className="w-5 h-5" />, text: "PVE READY" },
  { icon: <Timer className="w-5 h-5" />, text: "SMART COOLDOWNS" },
  { icon: <Shield className="w-5 h-5" />, text: "ADVANCED DEFENSIVES" },
];

const WORLD_OF_WARCRAFT_CLASSES = [
  "Death Knight", "Demon Hunter", "Druid", "Evoker", "Hunter", 
  "Mage", "Monk", "Paladin", "Priest", "Rogue", "Shaman", 
  "Warlock", "Warrior"
];

type CartItem = {
  id: string;
  name: string;
  price: number;
  type: 'one-class' | 'aio' | 'trial';
  wowClass?: string;
};

type View = 'landing' | 'dashboard' | 'admin';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
  const [view, setView] = useState<View>('landing');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showError, setShowError] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Auth & Profile Listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      if (!authUser) {
        setUserData(null);
        setView('landing');
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    const userPath = `users/${user.uid}`;
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserData(snapshot.data());
      }
    }, (err) => {
      console.error("Profile sync error:", err);
      // Don't use handleFirestoreError here as it might trigger a loop if the UI reacts to the thrown error
    });

    return () => unsubProfile();
  }, [user]);

  // Auto-hide error and notification
  useEffect(() => {
    if (showError) {
      const timer = setTimeout(() => setShowError(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showError]);

  useEffect(() => {
    if (lastAdded) {
      const timer = setTimeout(() => setLastAdded(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastAdded]);

  const addToCart = (item: CartItem) => {
    const isDuplicate = cart.find(i => 
      (i.type === 'aio' && item.type === 'aio') || 
      (i.type === 'trial' && item.type === 'trial') ||
      (i.type === 'one-class' && item.type === 'one-class' && i.wowClass === item.wowClass)
    );

    if (isDuplicate) {
      console.log(`[Cart] Item already in cart: ${item.name}`);
      setLastAdded("Already in cart");
      return;
    }

    // Trial limit check
    if (item.type === 'trial' && userData?.trialUsed) {
      console.log("[Cart] Trial already used");
      setLastAdded("Trial already used");
      return;
    }

    console.log(`[Cart] Adding item: ${item.name}`);
    setCart(prev => [...prev, item]);
    setLastAdded(`${item.name} added!`);
    setIsCartOpen(true);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const handleAddTrial = () => {
    if (userData?.trialUsed) {
      alert("You have already used your 3-day trial.");
      return;
    }
    addToCart({
      id: `trial-${Date.now()}`,
      name: "3-Day Free Trial",
      price: 0,
      type: 'trial'
    });
  };

  const handleAddOneClass = () => {
    if (!selectedClass) {
      setShowError(true);
      return;
    }
    const className = WORLD_OF_WARCRAFT_CLASSES.find(c => c.toLowerCase() === selectedClass);
    addToCart({
      id: `one-class-${selectedClass}-${Date.now()}`,
      name: `Rotation: ${className}`,
      price: 35,
      type: 'one-class',
      wowClass: selectedClass
    });
  };

  const handleAddAIO = () => {
    let price = 50;
    let name = "All-In-One Access Plan";

    if (user && userData?.plan === 'single' && userData?.updatedAt) {
      try {
        const lastBillingDate = userData.updatedAt.toDate();
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - lastBillingDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Simple simulation: 30 day month
        const daysLeft = Math.max(0, 30 - (diffDays % 30));
        const proportion = daysLeft / 30;
        
        // All-In-One (50) - Single (35) = 15 difference
        const upgradeDiff = 15 * proportion;
        price = Math.round(upgradeDiff * 100) / 100; // Round to 2 decimals
        name = "All-In-One Upgrade (Prorated)";
        
        console.log(`[Upgrade] Calculated prorated price: ${price} based on ${daysLeft} days remaining.`);
      } catch (e) {
        console.warn("[Upgrade] Could not calculate proration accurately, using full difference of $15", e);
        price = 15;
      }
    }

    addToCart({
      id: `aio-${Date.now()}`,
      name: name,
      price: price,
      type: 'aio'
    });
  };

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const total = cart.reduce((acc, item) => acc + item.price, 0);
  const [isDiscordLinked, setIsDiscordLinked] = useState(false);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Allow messages from our own domain or localhost
      if (!event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) return;
      
      if (event.data?.type === 'DISCORD_AUTH_SUCCESS' && user) {
        const discordId = event.data.discordId;
        
        try {
          const { updateDoc, doc, serverTimestamp } = await import('firebase/firestore');
          await updateDoc(doc(db, 'users', user.uid), {
            discordId: discordId,
            updatedAt: serverTimestamp()
          });
          setIsDiscordLinked(true);
          setLastAdded("Account Linked!");
        } catch (err) {
          console.error("Failed to link discord client-side:", err);
          alert("Discord linked, but failed to update profile. Please refresh.");
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user]);

  const toggleCart = () => setIsCartOpen(!isCartOpen);

  const handleCheckout = () => {
    console.log("[Cart] Proceeding to checkout. Current cart:", cart);
    if (!user) {
      console.log("[Cart] User not logged in, opening auth modal");
      setIsAuthOpen(true);
      setIsCartOpen(false);
      return;
    }
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-primary selection:text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-20 flex items-center justify-between">
          <button 
            onClick={() => setView('landing')}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="text-primary">
              <Hexagon className="w-8 h-8 fill-primary/20" />
            </div>
            <span className="text-xl font-bold tracking-tight font-display">FAFO</span>
          </button>

          <nav className="hidden md:flex items-center gap-10">
            {view === 'landing' && NAV_LINKS.map(link => (
              <a 
                key={link.name} 
                href={link.href} 
                className="text-sm font-medium text-white/70 hover:text-primary transition-colors uppercase tracking-widest"
              >
                {link.name}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            {((userData?.isAdmin) || (user?.email?.toLowerCase() === 'nick9284@gmail.com')) && (
              <button 
                onClick={() => setView('admin')}
                className={`px-4 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest border border-white shadow-2xl ${view === 'admin' ? 'bg-primary text-white shadow-lg shadow-primary/20 border-primary' : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary hover:text-white'}`}
              >
                Admin
              </button>
            )}

            <button 
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 text-white/70 hover:text-white transition-colors"
            >
              <ShoppingCart className="w-6 h-6" />
              {cart.length > 0 && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center translate-x-1/2 -translate-y-1/2">
                  {cart.length}
                </span>
              )}
            </button>

            {cart.length > 0 && !isCheckoutOpen && !userData?.plan && (
              <button 
                onClick={handleCheckout}
                className="hidden lg:flex px-6 py-2 rounded-xl border border-primary/50 text-white text-xs font-bold hover:bg-primary transition-all"
              >
                Checkout
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setView('dashboard')}
                  className={`p-2 rounded-xl transition-all ${view === 'dashboard' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-white/40 hover:text-white'}`}
                >
                  <LayoutDashboard className="w-6 h-6" />
                </button>
                <button 
                  onClick={logout}
                  className="p-2 text-white/20 hover:text-red-500 transition-colors"
                >
                  <LogOut className="w-6 h-6" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setIsAuthOpen(true)}
                className="px-6 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:scale-105 active:scale-95 transition-all glow-primary"
              >
                Login
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AnimatePresence>
        {isAuthOpen && <Auth onClose={() => setIsAuthOpen(false)} />}
      </AnimatePresence>

      {/* Cart Drawer ... (existing implementation) */}
      <AnimatePresence>
        {isCartOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-surface-dark border-l border-white/5 z-[70] shadow-2xl p-8 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="w-6 h-6 text-primary" />
                  <h2 className="text-xl font-bold font-display uppercase tracking-widest">Your Cart</h2>
                </div>
                <button 
                  onClick={() => setIsCartOpen(false)}
                  className="p-2 text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                    <ShoppingCart className="w-16 h-16" />
                    <p className="text-sm font-medium tracking-widest uppercase">Your cart is empty</p>
                  </div>
                ) : (
                  cart.map(item => (
                    <motion.div 
                      layout
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-5 rounded-2xl bg-background border border-white/5 flex items-center justify-between gap-4 group"
                    >
                      <div className="space-y-1">
                        <p className="font-bold text-white tracking-tight">{item.name}</p>
                        <p className="text-xs font-bold text-primary tracking-widest uppercase italic">${item.price} / mo</p>
                      </div>
                      <button 
                        onClick={() => removeFromCart(item.id)}
                        className="p-2 text-white/20 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </motion.div>
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 font-bold uppercase tracking-widest text-xs">Total Monthly</span>
                    <span className="text-3xl font-black font-display text-white italic">${total}</span>
                  </div>
                  <button 
                    onClick={handleCheckout}
                    className="w-full h-16 rounded-2xl bg-primary text-white font-black tracking-widest uppercase text-sm shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                  >
                    Proceed to Checkout
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <CheckoutModal 
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        user={user}
        userData={userData}
        cart={cart}
        total={total}
        isDiscordLinked={isDiscordLinked}
        onSuccess={() => {
          setCart([]);
          setView('dashboard');
        }}
      />

      <main className="flex-1 pt-20">
        <AnimatePresence>
          {lastAdded && (
            <motion.div 
              initial={{ opacity: 0, y: -20, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -20, x: "-50%" }}
              className="fixed top-24 left-1/2 z-[100] px-6 py-3 bg-primary rounded-full shadow-2xl flex items-center gap-3"
            >
              <CheckCircle2 className="w-4 h-4 text-white" />
              <span className="text-white text-xs font-black tracking-widest uppercase">{lastAdded}</span>
            </motion.div>
          )}
          {showError && (
            <motion.div 
              initial={{ opacity: 0, y: -20, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -20, x: "-50%" }}
              className="fixed top-24 left-1/2 z-[100] px-6 py-3 bg-red-500 rounded-full shadow-2xl flex items-center gap-3"
            >
              <AlertCircle className="w-4 h-4 text-white" />
              <span className="text-white text-xs font-black tracking-widest uppercase text-center">Please select a class first!</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* View Routing */}
        <div className="min-h-screen flex flex-col">
          {view === 'landing' ? (
            <>
              {/* Hero Section ... (existing hero code) */}
              <section className="relative py-20 md:py-32 overflow-hidden">
                <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                    <div className="space-y-4">
                      <h1 className="text-6xl md:text-8xl font-black font-display leading-[1] tracking-tighter uppercase italic">
                        Master your class with <span className="text-primary italic">One Button.</span>
                      </h1>
                      <p className="text-lg md:text-xl text-white/40 leading-relaxed max-w-xl font-medium tracking-tight">
                        One-button WoW rotations built for PvP and PvE. Smart cooldowns, defensives, and full automation.
                      </p>
                    </div>
                  </motion.div>

                  <div className="relative aspect-[4/5] rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                    <img 
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_RvsT5naFa0_NRqPhIJ0zOn_9vsqJwwuPXaiPnYQtb2Br13wT_ps2yRb_cCuopvl8LUR45gD09LMOolu_5KAaAEHKNmEA_Z9JN_xHtx2uNPNxFNdpjPTFASPBFjlLIgJGOHKSRYKBGYrTQxLOetur2PWRtsnLyvfXy0NKpEYD1LtXKOeMBp3lPRl3Q_gGVMQK-qZwDWVZgZN6t1hLOs2U7eaxnxcJVPfYrgCAREv35Jw7dSJ57-DJ7PxNLjgm9iAZpwHuIia-WKA" 
                      alt="Dark Fantasy Warrior"
                      className="w-full h-full object-cover grayscale-[0.2]"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
              </section>

              <section className="pb-24">
                <div className="max-w-7xl mx-auto px-6 md:px-12 flex flex-wrap gap-4 justify-center">
                  {FEATURES.map((feature, index) => (
                    <div key={feature.text} className="flex items-center gap-3 px-6 py-4 rounded-xl bg-surface-dark border border-white/5">
                      <span className="text-primary">{feature.icon}</span>
                      <span className="text-sm font-bold font-display tracking-widest text-white/90">{feature.text}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Pricing Section ... (existing pricing code) */}
              <section id="plans" className="py-32 bg-[#12070d] relative">
                <div className="max-w-7xl mx-auto px-6 md:px-12 text-center mb-20 space-y-4">
                  <h2 className="text-5xl md:text-6xl font-black font-display tracking-tighter uppercase italic">Choose Your Plan</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto items-stretch">
                  {/* Trial Plan */}
                  <div className="p-8 rounded-3xl bg-surface-dark border border-white/5 space-y-8 flex flex-col hover:border-primary/20 transition-colors group">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-white/40 font-bold text-xs tracking-widest uppercase italic">New Users</h3>
                        <div className="px-2 py-1 rounded bg-primary/10 border border-primary/20">
                          <span className="text-[10px] text-primary font-black uppercase tracking-widest">3 Days</span>
                        </div>
                      </div>
                      <p className="text-4xl font-black font-display text-white italic">FREE TRIAL</p>
                      <p className="text-[10px] text-white/20 font-bold tracking-widest uppercase mt-2">No commitment</p>
                    </div>

                    <ul className="flex-1 space-y-4 pt-4">
                      {["Full AIO access", "3 day duration", "Standard support", "Trial Discord Role"].map(item => (
                        <li key={item} className="flex items-center gap-3 text-white/50">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                          <span className="text-xs font-medium tracking-tight">{item}</span>
                        </li>
                      ))}
                    </ul>

                    <button 
                      onClick={handleAddTrial}
                      disabled={userData?.trialUsed}
                      className="w-full h-14 rounded-xl border border-white/10 text-white font-black tracking-widest uppercase text-xs hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {userData?.trialUsed ? 'Trial Used' : 'Start Trial'}
                    </button>
                  </div>

                  {/* One Class */}
                  <div className="p-8 rounded-3xl bg-surface-dark border border-white/5 space-y-8 flex flex-col group hover:border-white/10 transition-colors">
                    <div>
                      <h3 className="text-white/40 font-bold text-xs tracking-widest uppercase italic mb-4">One Class</h3>
                      <p className="text-4xl font-black font-display text-white italic">$35<span className="text-xs">/mo</span></p>
                    </div>

                    <ul className="flex-1 space-y-4 pt-4">
                      {["All specs for one class", "Fully optimized rotations", "Standard support", "Discord Role"].map(item => (
                        <li key={item} className="flex items-center gap-3 text-white/70">
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-xs font-medium tracking-tight">{item}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="space-y-3 pt-6 border-t border-white/5">
                      <div className="relative">
                        <select 
                          value={selectedClass}
                          onChange={(e) => setSelectedClass(e.target.value)}
                          className="w-full h-12 pl-4 pr-10 rounded-xl bg-background border border-white/10 text-white font-bold text-xs outline-none appearance-none hover:border-white/20 cursor-pointer transition-all"
                        >
                          <option value="" disabled>Select Class</option>
                          {WORLD_OF_WARCRAFT_CLASSES.map(cls => (
                            <option key={cls} value={cls.toLowerCase()} className="bg-[#1a1d23]">{cls}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
                      </div>
                      <button onClick={handleAddOneClass} className="w-full h-12 rounded-xl border-2 border-primary/30 text-white font-black tracking-widest uppercase text-xs hover:bg-primary hover:border-primary transition-all active:scale-95">Select Plan</button>
                    </div>
                  </div>

                  {/* AIO Access */}
                  <div className="p-8 rounded-3xl bg-[#2a121e]/50 border-2 border-primary glow-primary-strong space-y-8 flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 bg-primary text-white text-[9px] font-black px-4 py-1 rounded-bl-xl uppercase tracking-widest">Popular</div>
                    
                    <div>
                      <h3 className="text-white/80 font-bold text-xs tracking-widest uppercase italic mb-4">AIO Access</h3>
                      <p className="text-5xl font-black font-display text-white italic">$50<span className="text-xs">/mo</span></p>
                    </div>

                    <ul className="flex-1 space-y-4 pt-4">
                      {["All classes & specs", "Priority updates", "VIP Discord access", "Beta access"].map(item => (
                        <li key={item} className="flex items-center gap-3 text-white">
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-bold tracking-tight italic">{item}</span>
                        </li>
                      ))}
                    </ul>

                    <button onClick={handleAddAIO} className="w-full h-14 rounded-xl bg-primary text-white font-black tracking-widest uppercase text-sm shadow-xl shadow-primary/25 hover:scale-[1.02] active:scale-95 transition-all">Get AIO Access</button>
                  </div>
                </div>
              </section>
            </>
          ) : view === 'dashboard' ? (
            <Dashboard onUpgrade={() => {
              if (userData?.plan === 'aio') {
                alert("You are already on the highest plan!");
                return;
              }
              handleAddAIO();
            }} />
          ) : view === 'admin' ? (
            <AdminPanel />
          ) : null}
        </div>
      </main>

      <footer className="py-20 border-t border-white/5 bg-background">
        <div className="max-w-7xl mx-auto px-6 md:px-12 text-center text-white/20 text-[10px] font-bold uppercase tracking-[0.2em]">
          © 2024 FAFO Rotations. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
