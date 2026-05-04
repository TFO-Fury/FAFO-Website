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
  CreditCard
} from "lucide-react";
import { useState, useEffect } from "react";

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
  type: 'one-class' | 'aio';
  wowClass?: string;
};

export default function App() {
  const [selectedClass, setSelectedClass] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showError, setShowError] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

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
    // Check if duplicate for one-class or AIO
    const isDuplicate = cart.find(i => 
      (i.type === 'aio' && item.type === 'aio') || 
      (i.type === 'one-class' && item.type === 'one-class' && i.wowClass === item.wowClass)
    );

    if (isDuplicate) {
      setLastAdded("Already in cart");
      return;
    }

    setCart(prev => [...prev, item]);
    setLastAdded(`${item.name} added!`);
    setIsCartOpen(true);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
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
    addToCart({
      id: `aio-${Date.now()}`,
      name: "All-In-One Access Plan",
      price: 50,
      type: 'aio'
    });
  };

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'payment' | 'success'>('payment');
  const total = cart.reduce((acc, item) => acc + item.price, 0);
  const [isDiscordLinked, setIsDiscordLinked] = useState(false);

  // Listen for OAuth Success from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Basic origin check for security
      if (!event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) {
        return;
      }

      if (event.data?.type === 'DISCORD_AUTH_SUCCESS') {
        setIsDiscordLinked(true);
        setLastAdded("Roles applied successfully!");
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleCheckout = () => {
    setIsCartOpen(false);
    setCheckoutStep('payment');
    setIsCheckoutOpen(true);
  };

  const handlePaymentComplete = (method: string) => {
    console.log(`Payment via ${method} complete`);
    setCheckoutStep('success');
  };

  return (
    <div className="min-h-screen flex flex-col selection:bg-primary selection:text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-primary">
              <Hexagon className="w-8 h-8 fill-primary/20" />
            </div>
            <span className="text-xl font-bold tracking-tight font-display">FAFO Rotations</span>
          </div>

          <nav className="hidden md:flex items-center gap-10">
            {NAV_LINKS.map(link => (
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
            <button className="px-6 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:scale-105 active:scale-95 transition-all glow-primary">
              Login
            </button>
          </div>
        </div>
      </header>

      {/* Cart Drawer */}
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
                  <p className="text-[10px] text-white/20 text-center font-medium uppercase tracking-[0.2em]">
                    Billed monthly. Cancel anytime at terminal.
                  </p>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCheckoutOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-surface-dark border border-white/10 rounded-[32px] overflow-hidden shadow-2xl flex flex-col pt-12 pb-10 px-10"
            >
              <button 
                onClick={() => setIsCheckoutOpen(false)}
                className="absolute top-6 right-6 p-2 text-white/40 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <AnimatePresence mode="wait">
                {checkoutStep === 'payment' ? (
                  <motion.div 
                    key="payment-step"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-8"
                  >
                    <div className="text-center space-y-2">
                      <h2 className="text-2xl font-black font-display uppercase tracking-widest italic">Secure Checkout</h2>
                      <p className="text-white/40 text-sm font-medium tracking-tight">Total due: <span className="text-primary">${total}</span> billed monthly</p>
                    </div>

                    <div className="space-y-4">
                      {/* Stripe Option */}
                      <button 
                        onClick={() => handlePaymentComplete('Stripe')}
                        className="w-full p-6 rounded-2xl border border-white/5 bg-background/50 hover:bg-background hover:border-primary/50 transition-all flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-white/60 group-hover:text-[#635BFF] transition-colors">
                            <CreditCard className="w-6 h-6" />
                          </div>
                          <div className="text-left">
                            <p className="font-bold text-white uppercase tracking-widest text-sm">Pay with Card</p>
                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Secured by Stripe</p>
                          </div>
                        </div>
                        <ChevronDown className="w-5 h-5 -rotate-90 text-white/20 group-hover:text-primary transition-colors" />
                      </button>

                      {/* PayPal Option */}
                      <button 
                        onClick={() => handlePaymentComplete('PayPal')}
                        className="w-full p-6 rounded-2xl border border-white/5 bg-background/50 hover:bg-background hover:border-primary/50 transition-all flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-white/60 group-hover:text-[#003087] transition-colors">
                            <Zap className="w-6 h-6" />
                          </div>
                          <div className="text-left">
                            <p className="font-bold text-white uppercase tracking-widest text-sm">PayPal Checkout</p>
                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Fast & Secure Payment</p>
                          </div>
                        </div>
                        <ChevronDown className="w-5 h-5 -rotate-90 text-white/20 group-hover:text-primary transition-colors" />
                      </button>
                    </div>

                    <div className="pt-4 flex flex-col items-center gap-4">
                      <div className="flex items-center gap-8 opacity-20 grayscale">
                        <CreditCard className="w-6 h-6" />
                        <Hexagon className="w-6 h-6" />
                        <Shield className="w-6 h-6" />
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="success-step"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    <div className="text-center space-y-4">
                      <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
                        <CheckCircle2 className="w-10 h-10 text-primary" />
                      </div>
                      <h2 className="text-3xl font-black font-display uppercase tracking-widest italic">Payment Successful!</h2>
                      <p className="text-white/60 text-sm font-medium tracking-tight">Your membership is ready. Finalize your account below.</p>
                    </div>

                    {/* Discord Link Step */}
                    <div className="p-6 rounded-3xl bg-primary/5 border border-primary/20 flex flex-col gap-6 shadow-inner">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#5865F2] flex items-center justify-center shadow-lg shadow-[#5865F2]/20">
                          <Hexagon className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-left">
                          <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-1">Final Step</p>
                          <p className="text-sm font-bold text-white tracking-tight">Sync Discord Roles</p>
                          <p className="text-[10px] text-white/30 font-medium uppercase tracking-widest">Applying roles for {cart.length} active plans</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {isDiscordLinked ? (
                          <div className="w-full p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-500 text-center space-y-2">
                            <p className="text-xs font-black uppercase tracking-widest">Discord Linked</p>
                            <p className="text-[10px] font-bold opacity-80 uppercase tracking-tight">Roles have been applied to your account.</p>
                          </div>
                        ) : (
                          <button 
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/auth/discord/url');
                                if (!res.ok) throw new Error('Failed to get auth URL');
                                const { url } = await res.json();
                                
                                const width = 500;
                                const height = 750;
                                const left = window.screenX + (window.outerWidth - width) / 2;
                                const top = window.screenY + (window.outerHeight - height) / 2;
                                
                                const authWindow = window.open(
                                  url,
                                  'discord_auth',
                                  `width=${width},height=${height},left=${left},top=${top}`
                                );

                                if (!authWindow) {
                                  alert("Popup blocked! Please allow popups to link your Discord account.");
                                }
                              } catch (err) {
                                console.error(err);
                                alert("Configuration Error: Please ensure DISCORD_CLIENT_ID is set in your secrets.");
                              }
                            }}
                            className="w-full h-14 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#5865F2]/20 active:scale-95"
                          >
                            Link Discord & Get Roles
                          </button>
                        )}
                        <p className="text-[9px] text-white/20 font-bold uppercase tracking-[0.3em] text-center">
                          Required to access rotation files and support
                        </p>
                      </div>
                    </div>

                    <button 
                      onClick={() => {
                        setCart([]);
                        setIsCheckoutOpen(false);
                      }}
                      className="w-full text-xs font-black text-white/30 hover:text-white uppercase tracking-[0.3em] transition-colors"
                    >
                      Return to Dashboard
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-8">
                <p className="text-[10px] text-white/20 font-medium uppercase tracking-[0.2em] text-center">
                  Encrypted transaction. No card data is stored.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="flex-1 pt-20">
        {/* Notification Toast */}
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
        </AnimatePresence>

        {/* Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
              className="space-y-8"
            >
              <div className="space-y-4">
                <h1 className="text-6xl md:text-8xl font-black font-display leading-[1] tracking-tighter uppercase italic">
                  Master your class with <span className="text-primary italic">One Button.</span>
                </h1>
                <p className="text-lg md:text-xl text-white/40 leading-relaxed max-w-xl font-medium tracking-tight">
                  One-button WoW rotations built for PvP and PvE. Smart cooldowns, defensives, and full automation. Stay ahead of the curve.
                </p>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative aspect-[4/5] rounded-3xl overflow-hidden border border-white/10 group shadow-2xl"
            >
              <div className="absolute inset-0 bg-primary/10 group-hover:bg-primary/5 transition-colors duration-500 z-10" />
              <img 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_RvsT5naFa0_NRqPhIJ0zOn_9vsqJwwuPXaiPnYQtb2Br13wT_ps2yRb_cCuopvl8LUR45gD09LMOolu_5KAaAEHKNmEA_Z9JN_xHtx2uNPNxFNdpjPTFASPBFjlLIgJGOHKSRYKBGYrTQxLOetur2PWRtsnLyvfXy0NKpEYD1LtXKOeMBp3lPRl3Q_gGVMQK-qZwDWVZgZN6t1hLOs2U7eaxnxcJVPfYrgCAREv35Jw7dSJ57-DJ7PxNLjgm9iAZpwHuIia-WKA" 
                alt="Dark Fantasy Warrior"
                className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-700 active:scale-105"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] z-20" />
            </motion.div>
          </div>
        </section>

        {/* Feature Chips */}
        <section className="pb-24">
          <div className="max-w-7xl mx-auto px-6 md:px-12">
            <div className="flex flex-wrap gap-4 justify-center">
              {FEATURES.map((feature, index) => (
                <motion.div 
                  key={feature.text}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  viewport={{ once: true }}
                  className="flex items-center gap-3 px-6 py-4 rounded-xl bg-surface-dark border border-white/5 hover:border-primary/50 transition-colors group cursor-default"
                >
                  <span className="text-primary group-hover:scale-110 transition-transform">
                    {feature.icon}
                  </span>
                  <span className="text-sm font-bold font-display tracking-widest text-white/90">
                    {feature.text}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="plans" className="py-32 bg-[#12070d] relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 blur-[150px] pointer-events-none rounded-full" />
          
          <div className="max-w-7xl mx-auto px-6 md:px-12 relative z-10">
            <div className="text-center mb-20 space-y-4">
              <span className="text-primary font-bold tracking-[0.3em] text-xs uppercase block">Contract Tiers</span>
              <h2 className="text-5xl md:text-6xl font-black font-display tracking-tighter uppercase italic">Choose Your Plan</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-4xl mx-auto items-stretch">
              {/* Card 1: One Class */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="flex flex-col p-8 md:p-10 rounded-3xl bg-surface-dark border border-white/5 hover:border-white/20 transition-all group"
              >
                <div className="mb-8">
                  <h3 className="text-white/40 font-bold text-sm tracking-[0.2em] uppercase mb-1">One Class</h3>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black font-display text-white">$35</span>
                    <span className="text-white/30 font-medium tracking-tight">/mo</span>
                  </div>
                </div>

                <ul className="flex-1 space-y-5 mb-10 text-white/70">
                  <li className="flex items-center gap-3 font-medium">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 transition-transform group-hover:scale-110" />
                    <span className="text-sm">All specs for one class</span>
                  </li>
                  <li className="flex items-center gap-3 font-medium">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 transition-transform group-hover:scale-110" />
                    <span className="text-sm">Fully optimized rotations</span>
                  </li>
                  <li className="flex items-center gap-3 font-medium">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 transition-transform group-hover:scale-110" />
                    <span className="text-sm">Standard support</span>
                  </li>
                  <li className="flex items-center gap-3 font-medium p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <Hexagon className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-50">Discord Role</span>
                      <span className="text-xs font-bold text-white">Single Class Member</span>
                    </div>
                  </li>
                </ul>

                <div className="space-y-4 pt-6 border-t border-white/5 flex flex-col">
                  <div className="relative">
                    <select 
                      value={selectedClass}
                      onChange={(e) => {
                        setSelectedClass(e.target.value);
                        setShowError(false);
                      }}
                      className={`w-full h-14 pl-5 pr-12 rounded-xl bg-background border ${showError ? 'border-red-500 animate-shake' : 'border-white/10'} text-white font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none cursor-pointer transition-all hover:bg-background/80`}
                    >
                      <option value="" disabled>Select Your Class</option>
                      {WORLD_OF_WARCRAFT_CLASSES.map(cls => (
                        <option key={cls} value={cls.toLowerCase()}>{cls}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  </div>
                  
                  <AnimatePresence>
                    {showError && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2 text-red-500 text-[10px] font-black uppercase tracking-widest"
                      >
                        <AlertCircle className="w-3 h-3" />
                        Please select a class first
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button 
                    onClick={handleAddOneClass}
                    className="w-full h-14 rounded-xl border-2 border-primary/30 text-white font-black tracking-widest uppercase text-sm hover:bg-primary hover:border-primary transition-all duration-300 active:scale-95 shadow-lg shadow-black/20"
                  >
                    Select Plan
                  </button>
                </div>
              </motion.div>

              {/* Card 2: AIO Access */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="relative flex flex-col p-8 md:p-10 rounded-3xl bg-[#3d1a2d] border-2 border-primary glow-primary-strong z-10 overflow-hidden"
              >
                {/* Popular Badge */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] font-black px-6 py-1.5 rounded-b-xl uppercase tracking-[0.2em] shadow-lg">
                  Most Popular
                </div>

                <div className="mb-8 mt-4">
                  <h3 className="text-white/80 font-bold text-sm tracking-[0.2em] uppercase mb-1 italic">AIO Access</h3>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black font-display text-white">$50</span>
                    <span className="text-white/40 font-medium tracking-tight">/mo</span>
                  </div>
                </div>

                <ul className="flex-1 space-y-5 mb-10">
                  {[
                    "All classes and specs",
                    "Full access and updates",
                    "Priority Discord access",
                    "Early beta features"
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0 fill-primary/20" />
                      <span className="text-sm font-bold text-white tracking-tight">{item}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-3 font-medium p-3 rounded-lg bg-white/5 border border-white/10">
                    <Hexagon className="w-5 h-5 text-primary shrink-0 transition-transform hover:rotate-180 duration-1000" />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-50">Unlocked Role</span>
                      <span className="text-xs font-bold text-white">AIO Member</span>
                    </div>
                  </li>
                </ul>

                <button 
                  onClick={handleAddAIO}
                  className="w-full h-14 rounded-xl bg-primary text-white font-black tracking-[0.1em] uppercase text-sm shadow-xl shadow-primary/25 hover:bg-orange-600 active:scale-95 transition-all duration-300"
                >
                  Get AIO Access
                </button>
              </motion.div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-20 border-t border-white/5 bg-background">
        <div className="max-w-7xl mx-auto px-6 md:px-12 text-center space-y-8">
          <div className="flex flex-col items-center gap-8">
            <div className="flex items-center gap-3 text-white/40 grayscale opacity-80">
              <Hexagon className="w-6 h-6" />
              <span className="text-base font-bold tracking-tight">FAFO Rotations</span>
            </div>
            
            <p className="max-w-md text-white/30 text-xs leading-relaxed font-medium uppercase tracking-widest">
              © 2024 FAFO Rotations. For educational and automation purposes only. <br />
              All rights reserved. Use at your own risk.
            </p>

            <div className="flex gap-8">
              {['Terms of Service', 'Privacy Policy', 'Support'].map(link => (
                <a key={link} href="#" className="text-xs font-bold text-white/30 hover:text-primary tracking-widest uppercase transition-colors">
                  {link}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
