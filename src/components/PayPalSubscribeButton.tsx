import { useEffect, useState } from 'react';

interface PayPalSubscribeButtonProps {
  userId: string;
  user: any;
  onSuccess: (details: any) => void;
  onError: (error: any) => void;
}

// Separate from PayPalCheckout.tsx's one-time-order SDK load: subscriptions
// need the SDK loaded with intent=subscription&vault=true, a different
// config than the order-intent script, so this uses its own script tag
// rather than risking reuse of a differently-configured cached instance.
function loadPayPalSubscriptionScript(clientId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('paypal-script-subscription');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('PayPal script load failed')));
      if ((existing as any)._loaded) resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'paypal-script-subscription';
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&vault=true&intent=subscription`;
    script.onload = () => {
      (script as any)._loaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('PayPal script load failed'));
    document.body.appendChild(script);
  });
}

export default function PayPalSubscribeButton({ userId, user, onSuccess, onError }: PayPalSubscribeButtonProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paypalReady, setPaypalReady] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    const planId = import.meta.env.VITE_PAYPAL_AIO_PLAN_ID;
    if (!clientId) {
      setError('PayPal client ID not configured');
      return;
    }
    if (!planId) {
      setError('AIO subscription plan not configured');
      return;
    }
    loadPayPalSubscriptionScript(clientId)
      .then(() => setReady(true))
      .catch(e => setError(e.message || 'Failed to load PayPal'));
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    const paypal = (window as any).paypal;
    if (!paypal || !paypal.Buttons) return;

    const container = document.getElementById('paypal-subscribe-button-container');
    if (!container) return;
    container.innerHTML = '';

    const planId = import.meta.env.VITE_PAYPAL_AIO_PLAN_ID;

    paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'subscribe' },
      createSubscription: (_data: any, actions: any) => {
        return actions.subscription.create({
          plan_id: planId,
          custom_id: userId
        });
      },
      onApprove: async (data: any) => {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch('/api/paypal/confirm-subscription', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({ userId, subscriptionId: data.subscriptionID })
          });
          const result = await res.json();
          if (!res.ok || !result.success) {
            throw new Error(result.error || 'Subscription confirmation failed');
          }
          onSuccess(result);
        } catch (e: any) {
          setError(e.message);
          onError(e);
        }
      },
      onError: (err: any) => {
        setError('PayPal checkout error');
        onError(err);
      }
    }).render('#paypal-subscribe-button-container');

    setPaypalReady(true);
  }, [ready, userId]);

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
        PayPal Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-white/40">
        <span>Billed every 30 days</span>
        <span className="text-white/60">$35 USD</span>
      </div>
      <div id="paypal-subscribe-button-container" className="min-h-[120px]" />
      {!paypalReady && (
        <div className="text-center text-[10px] font-black uppercase tracking-widest text-white/20 py-4">
          Loading PayPal...
        </div>
      )}
    </div>
  );
}
