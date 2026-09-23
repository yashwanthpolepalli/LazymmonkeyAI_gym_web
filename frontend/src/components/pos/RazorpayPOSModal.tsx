import React, { useState, useEffect, useRef } from 'react';
import {
  QrCode,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  CreditCard,
  RotateCw,
  Send,
} from 'lucide-react';
import { apiClient } from '@/services/apiClient';

interface RazorpayPOSModalProps {
  isOpen: boolean;
  amount: number;
  billNumber: string;
  customerMobile?: string;
  customerName?: string;
  onClose: () => void;
  onSuccess: (paymentData: {
    paymentMethod: string;
    amount: number;
    paymentId: string;
    orderId: string;
  }) => void;
}

export function RazorpayPOSModal({
  isOpen,
  amount,
  billNumber,
  customerMobile = '',
  customerName = 'Valued Customer',
  onClose,
  onSuccess,
}: RazorpayPOSModalProps) {
  const [mobile, setMobile] = useState(customerMobile);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);
  const [qrData, setQrData] = useState<any>(null);
  const [paymentLink, setPaymentLink] = useState<string>('');
  const [isPaid, setIsPaid] = useState(false);
  const [activeTab, setActiveTab] = useState<'qr' | 'checkout' | 'link'>('qr');
  const [smsSent, setSmsSent] = useState(false);
  const pollingRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      setMobile(customerMobile);
      setIsPaid(false);
      setSmsSent(false);
      setErrorMessage(null);
      initiateOrderAndQR();
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setOrder(null);
      setQrData(null);
      setIsPaid(false);
      setErrorMessage(null);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [isOpen]);

  const initiateOrderAndQR = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      // 1. Create authentic order
      const ordRes = await apiClient.post<any>('/payments/razorpay/create-order', {
        amount,
        receipt: billNumber || `POS-${Date.now().toString().slice(-6)}`,
        notes: { customer_mobile: mobile, customer_name: customerName },
      });
      setOrder(ordRes);

      // 2. Create Dynamic QR / Payment Link QR
      const qrRes = await apiClient.post<any>('/payments/razorpay/qr-code', {
        amount,
        receipt: billNumber || ordRes?.receipt,
        notes: { order_id: ordRes?.id },
      });
      setQrData(qrRes);

      // 3. Create SMS Payment Link if mobile provided
      if (mobile) {
        const linkRes = await apiClient.post<any>('/payments/razorpay/payment-link', {
          amount,
          customer_phone: mobile,
          customer_name: customerName,
          bill_number: billNumber,
        });
        if (linkRes?.short_url) {
          setPaymentLink(linkRes.short_url);
        }
      }

      // 4. Start polling for payment confirmation
      if (qrRes?.id) {
        startPolling(qrRes.id, qrRes.is_link_fallback);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Unable to connect to Razorpay API';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (paymentRefId: string, isLink: boolean) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const endpoint = isLink
          ? `/payments/razorpay/payment-link/${paymentRefId}/status`
          : `/payments/razorpay/qr/${paymentRefId}/status`;
        const res = await apiClient.get<any>(endpoint);
        if (res?.is_paid || res?.status === 'paid' || res?.status === 'closed') {
          clearInterval(pollingRef.current);
          setIsPaid(true);
          setTimeout(() => {
            onSuccess({
              paymentMethod: 'Razorpay UPI',
              amount,
              paymentId: res.payment_id || `pay_${Date.now().toString().slice(-10)}`,
              orderId: order?.id || paymentRefId,
            });
          }, 800);
        }
      } catch {
        // Polling silent retry
      }
    }, 3000);
  };

  const handleManualCheckStatus = async () => {
    if (!qrData?.id) return;
    try {
      const endpoint = qrData.is_link_fallback
        ? `/payments/razorpay/payment-link/${qrData.id}/status`
        : `/payments/razorpay/qr/${qrData.id}/status`;
      const res = await apiClient.get<any>(endpoint);
      if (res?.is_paid || res?.status === 'paid') {
        setIsPaid(true);
        setTimeout(() => {
          onSuccess({
            paymentMethod: 'Razorpay UPI',
            amount,
            paymentId: res.payment_id || `pay_${Date.now().toString().slice(-10)}`,
            orderId: order?.id || qrData.id,
          });
        }, 800);
      }
    } catch {
      // Manual check completed
    }
  };

  const handleSendSms = async () => {
    if (!mobile) return;
    setSmsSent(true);
    try {
      const res = await apiClient.post<any>('/payments/razorpay/payment-link', {
        amount,
        customer_phone: mobile,
        customer_name: customerName,
        bill_number: billNumber,
      });
      if (res?.short_url) {
        setPaymentLink(res.short_url);
      }
    } catch {}
  };

  if (!isOpen) return null;

  const qrImageUrl =
    qrData?.image_url ||
    (qrData?.upi_intent || qrData?.short_url
      ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
          qrData.upi_intent || qrData.short_url
        )}`
      : null);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scale-up">
        {/* Top Header matching Screenshot 2 (Blue Solid Banner) */}
        <div className="px-6 py-5 bg-blue-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-white text-blue-600 font-black text-xs flex items-center justify-center shadow-md shrink-0">
              RZP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-sm text-white">Razorpay Payment Gateway</h3>
                <span className="text-[10px] font-black bg-blue-500 text-white px-2 py-0.5 rounded-md border border-blue-400/50 uppercase tracking-wider">
                  LIVE API
                </span>
              </div>
              <p className="text-[11px] text-blue-100 font-medium mt-0.5">
                Real-time Online &amp; Counter Checkout
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-blue-700/50 hover:bg-blue-700 text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Controls matching Screenshot 2 */}
        <div className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/70">
            <button
              type="button"
              onClick={() => setActiveTab('qr')}
              className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'qr'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <QrCode size={13} />
              <span>Dynamic QR</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('checkout')}
              className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'checkout'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CreditCard size={13} />
              <span>Checkout</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('link')}
              className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer ${
                activeTab === 'link'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone size={13} />
              <span>SMS Link</span>
            </button>
          </div>
        </div>

        {/* Total Payable Amount Banner matching Screenshot 2 */}
        <div className="px-6 pt-2">
          <div className="bg-blue-50/70 border border-blue-200/70 rounded-3xl p-5 text-center space-y-1">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-600">
              TOTAL PAYABLE AMOUNT
            </span>
            <div className="text-3xl font-black text-slate-900">₹{amount.toFixed(2)}</div>
            <div className="text-xs text-slate-500 font-mono">
              Bill #{billNumber || 'POS-192331'}
            </div>
          </div>
        </div>

        {/* Tab Content matching Screenshot 2 */}
        <div className="p-6 pt-3 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isPaid ? (
            <div className="border border-emerald-200 bg-emerald-50/50 rounded-3xl p-8 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-base font-black text-emerald-800">Payment Verified!</h3>
              <p className="text-xs text-slate-500">Transaction completed successfully via Razorpay.</p>
            </div>
          ) : activeTab === 'qr' ? (
            <div className="border border-slate-100 rounded-3xl p-5 text-center space-y-3 bg-white">
              {/* QR Image box */}
              <div className="w-56 h-56 mx-auto border border-slate-200 rounded-3xl flex flex-col items-center justify-center p-4 bg-white shadow-xs">
                {loading ? (
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <Loader2 size={32} className="animate-spin text-blue-600" />
                    <span className="text-xs font-semibold">Generating Dynamic QR...</span>
                  </div>
                ) : qrImageUrl ? (
                  <img
                    src={qrImageUrl}
                    alt="UPI QR Code"
                    className="w-full h-full object-contain rounded-2xl"
                  />
                ) : (
                  <div className="text-center space-y-2 p-4">
                    <QrCode size={44} className="mx-auto text-slate-300" />
                    <p className="text-xs font-medium text-slate-400 leading-relaxed">
                      Unable to load QR. Please use Checkout or SMS Link tab.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-black text-slate-900">Scan with Any UPI App or Camera</p>
                <div className="flex items-center justify-center gap-2 pt-2.5 flex-wrap text-xs font-bold text-slate-700">
                  <span className="px-3 py-1 bg-slate-100 rounded-xl">GPay</span>
                  <span className="px-3 py-1 bg-slate-100 rounded-xl">PhonePe</span>
                  <span className="px-3 py-1 bg-slate-100 rounded-xl">Paytm</span>
                  <span className="px-3 py-1 bg-slate-100 rounded-xl">Cred / BHIM</span>
                </div>
              </div>
            </div>
          ) : activeTab === 'checkout' ? (
            <div className="border border-slate-200 rounded-3xl p-6 text-center space-y-3 bg-white">
              <CreditCard size={36} className="mx-auto text-blue-600" />
              <h4 className="text-xs font-bold text-slate-900">Razorpay Live Standard Checkout</h4>
              <p className="text-[11px] text-slate-500">
                Launch secure hosted checkout supporting Cards, Netbanking, EMIs, and Wallets.
              </p>
              {paymentLink ? (
                <a
                  href={paymentLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2"
                >
                  <span>Open Checkout Gateway</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={initiateOrderAndQR}
                  className="btn-primary w-full py-2.5 text-xs font-bold"
                >
                  Generate Checkout Link
                </button>
              )}
            </div>
          ) : (
            <div className="border border-slate-200 rounded-3xl p-6 text-center space-y-3 bg-white">
              <Smartphone size={36} className="mx-auto text-blue-600" />
              <h4 className="text-xs font-bold text-slate-900">SMS / WhatsApp Payment Link</h4>
              <input
                type="tel"
                placeholder="Customer 10-digit mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-center"
              />
              <button
                type="button"
                onClick={handleSendSms}
                className="btn-primary w-full py-2 text-xs font-bold flex items-center justify-center gap-2"
              >
                <Send size={13} />
                <span>{smsSent ? 'Link Dispatched to Phone!' : 'Send Payment Link via SMS'}</span>
              </button>
            </div>
          )}

          {/* Bottom Polling Status Bar matching Screenshot 2 */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-600">
              <RotateCw size={14} className="text-blue-600 animate-spin" />
              <span>Listening for customer payment...</span>
            </div>
            <button
              type="button"
              onClick={handleManualCheckStatus}
              className="text-blue-600 font-bold hover:underline cursor-pointer"
            >
              Re-check Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
