import { useEffect, useState } from 'react';

interface PayPalCheckoutProps {
  plan: string;
  className?: string;
  amount: string;
  userId: string;
  onSuccess: (details: any) => void;
  onError: (error: any) => void;
}

function loadPayPalScript(clientId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).paypal) {
      resolve();
      return;
    }
    const existing = document.getElementById('paypal-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('PayPal script load failed')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'paypal-script';
    script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('PayPal script load failed'));
    document.body.appendChild(script);
  });
}

export default function PayPalCheckout({ plan, className, amount, userId, onSuccess, onError }: PayPalCheckoutProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paypalReady, setPaypalReady] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    if (!clientId) {
      setError('PayPal client ID not configured');
      return;
    }
    loadPayPalScript(clientId)
      .then(() => setReady(true))
      .catch(e => setError(e.message || 'Failed to load PayPal'));
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    const paypal = (window as any).paypal;
    if (!paypal || !paypal.Buttons) return;

    const container = document.getElementById('paypal-button-container');
    if (!container) return;
    container.innerHTML = '';

    paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },
      createOrder: async () => {
        try {
          const res = await fetch('/api/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, plan, className, amount })
          });
          const data = await res.json();
          if (!res.ok || !data.orderId) {
            throw new Error(data.error || 'Failed to create order');
          }
          return data.orderId;
        } catch (e: any) {
          setError(e.message);
          throw e;
        }
      },
      onApprove: async (data: any) => {
        try {
          const res = await fetch('/api/paypal/capture-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID, userId })
          });
          const result = await res.json();
          if (!res.ok || !result.success) {
            throw new Error(result.error || 'Capture failed');
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
    }).render('#paypal-button-container');

    setPaypalReady(true);
  }, [ready, plan, className, amount, userId]);

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
        <span>Total</span>
        <span className="text-white/60">${amount} USD</span>
      </div>
      <div id="paypal-button-container" className="min-h-[120px]" />
      {!paypalReady && (
        <div className="text-center text-[10px] font-black uppercase tracking-widest text-white/20 py-4">
          Loading PayPal...
        </div>
      )}
    </div>
  );
}
