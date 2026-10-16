import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Phone,
  Mail,
  MessageCircle,
  ShieldCheck,
  Flame,
  Dumbbell,
  Clock,
  ArrowRight,
  Volume2,
  VolumeX,
  MapPin,
  Sparkles,
  User,
  LogOut,
  LogIn,
  Layers,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { playNotificationBeep } from '@/utils/audioAlert';

export interface CustomerPunchData {
  id: string;
  customer_id: string;
  customer_name: string;
  person_name?: string;
  user_role?: string;
  avatar?: string | null;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  age?: number | null;
  weight?: number | null;
  height?: number | null;
  bmi?: number | null;
  goal?: string | null;
  fitness_level?: string | null;
  membership_plan?: string | null;
  membership_status?: string | null;
  membership_expiry?: string | null;
  due_amount?: number;
  total_visits?: number;
  timestamp?: string;
  event_type?: string;
  device_name?: string;
  direction?: 'CHECK_IN' | 'CHECK_OUT';
  status?: string;
  confidence_score?: number;
  confidence_percentage?: string;
  branch?: string;
  notes?: string;
}

interface LiveAttendanceBottomPopupProps {
  queue: CustomerPunchData[];
  currentIndex: number;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  autoCloseSeconds?: number;
}

export function LiveAttendanceBottomPopup({
  queue,
  currentIndex,
  onClose,
  onNext,
  onPrev,
  autoCloseSeconds = 30,
}: LiveAttendanceBottomPopupProps) {
  const navigate = useNavigate();
  const currentPunch = queue[currentIndex] || null;

  // 30-second countdown timer state (in milliseconds)
  const totalDurationMs = autoCloseSeconds * 1000;
  const [timeLeftMs, setTimeLeftMs] = useState<number>(totalDurationMs);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('fitclub_attendance_sound_muted') === 'true';
  });

  const lastPunchIdRef = useRef<string | null>(null);

  // Play audio alert and reset timer whenever a new punch arrives
  useEffect(() => {
    if (currentPunch && currentPunch.id !== lastPunchIdRef.current) {
      lastPunchIdRef.current = currentPunch.id;
      setTimeLeftMs(totalDurationMs);
      setIsClosing(false);

      if (!isMuted) {
        playNotificationBeep('alert');
      }
    }
  }, [currentPunch?.id, totalDurationMs, isMuted]);

  // Handle countdown timer ticking down
  useEffect(() => {
    if (!currentPunch || isHovered || isClosing) return;

    const intervalTime = 100; // updates every 100ms for ultra-smooth circular SVG progress
    const timer = setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev <= intervalTime) {
          clearInterval(timer);
          handleSmoothClose();
          return 0;
        }
        return prev - intervalTime;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [currentPunch, isHovered, isClosing]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSmoothClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSmoothClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 350);
  };

  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    localStorage.setItem('fitclub_attendance_sound_muted', String(newMuted));
  };

  const handleViewProfile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentPunch?.customer_id) {
      handleSmoothClose();
      navigate(`/owner/customers/${currentPunch.customer_id}`);
    }
  };

  if (!currentPunch) return null;

  const isCheckIn = (currentPunch.direction || 'CHECK_IN') === 'CHECK_IN';
  const remainingSeconds = Math.max(0, Math.ceil(timeLeftMs / 1000));
  const progressRatio = Math.max(0, Math.min(1, timeLeftMs / totalDurationMs));

  // Circular timer SVG calculations
  const strokeWidth = 3;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progressRatio);

  // Formatting timestamp
  const formattedTime = (() => {
    if (!currentPunch.timestamp) return 'Just now';
    try {
      const d = new Date(currentPunch.timestamp);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return 'Just now';
    }
  })();

  // Contact helpers
  const cleanPhone = (currentPunch.phone || '').replace(/\D/g, '');
  const whatsAppUrl = cleanPhone
    ? `https://wa.me/${cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`}?text=${encodeURIComponent(
        `Hi ${currentPunch.customer_name}, welcome to FIT CLUB! Your attendance was recorded.`
      )}`
    : null;

  const initials = (currentPunch.customer_name || 'Member')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`fixed bottom-5 right-4 left-4 sm:left-auto sm:right-6 sm:w-[560px] max-w-[calc(100vw-2rem)] z-[99999] transition-all duration-350 ease-out transform ${
        isClosing ? 'translate-y-28 opacity-0 scale-95 pointer-events-none' : 'translate-y-0 opacity-100 scale-100'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="dialog"
      aria-live="assertive"
      aria-label="Live Customer Attendance Notification"
    >
      {/* Outer Glow Container with Multi-Color Ambient Backlight */}
      <div
        className={`relative overflow-hidden rounded-3xl backdrop-blur-2xl border shadow-2xl transition-all duration-500 ${
          isCheckIn
            ? 'bg-slate-950/95 border-emerald-500/40 shadow-[0_20px_60px_-15px_rgba(16,185,129,0.35)]'
            : 'bg-slate-950/95 border-amber-500/40 shadow-[0_20px_60px_-15px_rgba(245,158,11,0.35)]'
        }`}
      >
        {/* Animated Top Multi-Color Laser Gradient Bar */}
        <div
          className={`h-1.5 w-full bg-gradient-to-r ${
            isCheckIn
              ? 'from-emerald-400 via-teal-300 to-cyan-400 animate-pulse'
              : 'from-amber-400 via-rose-400 to-orange-400 animate-pulse'
          }`}
        />

        {/* Shimmer Ambient Background Orbs */}
        <div
          className={`absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl pointer-events-none opacity-25 ${
            isCheckIn ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
        />
        <div
          className={`absolute -bottom-16 -left-16 w-44 h-44 rounded-full blur-3xl pointer-events-none opacity-20 ${
            isCheckIn ? 'bg-cyan-500' : 'bg-rose-500'
          }`}
        />

        {/* Content Box */}
        <div className="relative p-4 sm:p-5 text-white">
          {/* Header Row: Direction Badge, Multiple Punch Navigation, Timer, Close */}
          <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-white/10">
            {/* Live Status Badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase shadow-md ${
                  isCheckIn
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                }`}
              >
                {isCheckIn ? <LogIn className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
                <span>{isCheckIn ? 'CUSTOMER CHECK-IN' : 'CUSTOMER CHECK-OUT'}</span>
                <span className="w-2 h-2 rounded-full bg-current animate-ping ml-0.5" />
              </span>

              {/* Time Pill */}
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/5 border border-white/10 text-slate-300">
                <Clock className="w-3 h-3 text-cyan-400" />
                {formattedTime}
              </span>

              {/* Queue navigation indicator if multiple punches */}
              {queue.length > 1 && (
                <div className="flex items-center gap-1 bg-white/10 rounded-full px-2 py-0.5 text-[10px] font-bold text-slate-200">
                  <Layers className="w-3 h-3 text-indigo-400" />
                  <span>
                    {currentIndex + 1} of {queue.length}
                  </span>
                  {onPrev && currentIndex > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPrev();
                      }}
                      className="hover:text-white p-0.5"
                      title="Previous punch"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                  )}
                  {onNext && currentIndex < queue.length - 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNext();
                      }}
                      className="hover:text-white p-0.5"
                      title="Next punch"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right Controls: Sound Toggle, 30s Countdown Ring, Close Button */}
            <div className="flex items-center gap-2">
              {/* Sound Toggle */}
              <button
                type="button"
                onClick={toggleSound}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer"
                title={isMuted ? 'Unmute check-in audio alert' : 'Mute check-in audio alert'}
                aria-label="Toggle Sound"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
              </button>

              {/* 30-Second Countdown Radial Ring */}
              <div
                className="relative flex items-center justify-center w-9 h-9 cursor-help group"
                title={isHovered ? 'Timer paused while inspecting' : `Auto-closing in ${remainingSeconds}s`}
              >
                <svg className="w-9 h-9 transform -rotate-90" viewBox="0 0 38 38">
                  {/* Background Track */}
                  <circle
                    cx="19"
                    cy="19"
                    r={radius}
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                  />
                  {/* Animated Progress Stroke */}
                  <circle
                    cx="19"
                    cy="19"
                    r={radius}
                    stroke={isCheckIn ? '#10b981' : '#f59e0b'}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-[stroke-dashoffset] duration-100 ease-linear"
                  />
                </svg>
                <span className="absolute text-[10px] font-black text-white">
                  {isHovered ? '⏸' : `${remainingSeconds}s`}
                </span>
              </div>

              {/* Manual Close Button */}
              <button
                type="button"
                onClick={handleSmoothClose}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-rose-500/80 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer group"
                title="Close popup (Esc)"
                aria-label="Close notification"
              >
                <X className="w-4 h-4 group-hover:scale-110 transition-transform" />
              </button>
            </div>
          </div>

          {/* Main Body: Customer Identity & High-Impact Avatar Card */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {/* Left: Glowing Avatar with Face ID Match Badge */}
            <div className="relative shrink-0 self-center sm:self-auto">
              <div
                className={`relative w-20 h-20 rounded-2xl overflow-hidden p-0.5 border-2 shadow-xl ${
                  isCheckIn
                    ? 'border-emerald-400/80 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
                    : 'border-amber-400/80 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
                }`}
              >
                {currentPunch.avatar ? (
                  <img
                    src={currentPunch.avatar}
                    alt={currentPunch.customer_name}
                    className="w-full h-full object-cover rounded-xl"
                  />
                ) : (
                  <div
                    className={`w-full h-full rounded-xl flex items-center justify-center font-black text-2xl tracking-wider text-white bg-gradient-to-br ${
                      isCheckIn ? 'from-emerald-600 via-teal-700 to-cyan-800' : 'from-amber-600 via-rose-700 to-purple-800'
                    }`}
                  >
                    {initials}
                  </div>
                )}
              </div>

              {/* Verified Face ID Tag Over Avatar */}
              <div
                className={`absolute -bottom-2 -right-2 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold flex items-center gap-1 shadow-md border ${
                  isCheckIn
                    ? 'bg-emerald-500 text-slate-950 border-emerald-200'
                    : 'bg-amber-500 text-slate-950 border-amber-200'
                }`}
                title={`Biometric Confidence: ${currentPunch.confidence_percentage || '99%'}`}
              >
                <ShieldCheck className="w-3 h-3" />
                <span>{currentPunch.confidence_percentage || '99%'}</span>
              </div>
            </div>

            {/* Middle: Full Customer Metadata & Identity */}
            <div className="flex-1 min-w-0 w-full">
              <div className="flex flex-col">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-black text-white tracking-tight truncate">
                    {currentPunch.customer_name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-indigo-500/25 text-indigo-300 border border-indigo-400/30">
                    {currentPunch.user_role || 'CUSTOMER'}
                  </span>
                </div>

                {/* Contact Pill Row */}
                <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-slate-300">
                  {currentPunch.phone && (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={`tel:${currentPunch.phone}`}
                        className="inline-flex items-center gap-1 text-slate-300 hover:text-emerald-400 transition-colors"
                        title="Call Customer"
                      >
                        <Phone className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-medium">{currentPunch.phone}</span>
                      </a>

                      {whatsAppUrl && (
                        <a
                          href={whatsAppUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 transition-all"
                          title="Open WhatsApp chat"
                        >
                          <MessageCircle className="w-3 h-3 text-emerald-400" />
                          <span>WhatsApp</span>
                        </a>
                      )}
                    </div>
                  )}

                  {currentPunch.email && (
                    <a
                      href={`mailto:${currentPunch.email}`}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300 transition-colors truncate max-w-[200px]"
                      title={currentPunch.email}
                    >
                      <Mail className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{currentPunch.email}</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Color Rich Grid Badges (The "All Customer Data" Requirement) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-white/10 text-xs">
            {/* 1. Membership Plan & Status (Purple / Indigo Accent) */}
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-indigo-950/60 to-purple-900/30 border border-indigo-500/30 flex flex-col justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-indigo-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                MEMBERSHIP
              </span>
              <div className="mt-1">
                <div className="font-extrabold text-white text-xs truncate">
                  {currentPunch.membership_plan || 'Active Pass'}
                </div>
                <div className="text-[10px] text-indigo-200/80 font-medium flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {currentPunch.membership_status || 'ACTIVE'}
                  {currentPunch.membership_expiry && ` • Exp: ${currentPunch.membership_expiry}`}
                </div>
              </div>
            </div>

            {/* 2. Frequency & Streak (Amber / Flame Accent) */}
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-950/60 to-orange-900/30 border border-amber-500/30 flex flex-col justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-amber-300 flex items-center gap-1">
                <Flame className="w-3 h-3 text-amber-400" />
                ATTENDANCE
              </span>
              <div className="mt-1">
                <div className="font-extrabold text-white text-xs">
                  {currentPunch.total_visits || 1} Visits Total
                </div>
                <div className="text-[10px] text-amber-200/90 font-medium mt-0.5 flex items-center gap-1">
                  <span>🔥 Regular Member</span>
                </div>
              </div>
            </div>

            {/* 3. Health & Fitness Goal (Teal / Sky Accent) */}
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-cyan-950/60 to-teal-900/30 border border-cyan-500/30 flex flex-col justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-cyan-300 flex items-center gap-1">
                <Dumbbell className="w-3 h-3 text-cyan-400" />
                GOAL & BMI
              </span>
              <div className="mt-1">
                <div className="font-extrabold text-white text-xs truncate">
                  {currentPunch.goal || 'Fitness & Strength'}
                </div>
                <div className="text-[10px] text-cyan-200/80 font-medium mt-0.5">
                  {currentPunch.bmi ? `BMI ${currentPunch.bmi}` : 'Active'} • {currentPunch.fitness_level || 'Member'}
                </div>
              </div>
            </div>

            {/* 4. Device & Branch Location (Emerald / Green Accent) */}
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-emerald-950/60 to-teal-950/30 border border-emerald-500/30 flex flex-col justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-300 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-emerald-400" />
                LOCATION & SCAN
              </span>
              <div className="mt-1">
                <div className="font-extrabold text-white text-xs truncate">
                  {currentPunch.branch || 'Main Branch'}
                </div>
                <div className="text-[10px] text-emerald-200/80 font-medium truncate mt-0.5">
                  {currentPunch.device_name || currentPunch.event_type || 'Mobile App Face ID'}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Action Footer */}
          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/10">
            {/* Timer Hint */}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isHovered ? 'bg-amber-400 animate-bounce' : 'bg-emerald-400'
                }`}
              />
              <span>
                {isHovered ? (
                  <strong className="text-amber-300 font-semibold">Inspection Mode: Timer Paused</strong>
                ) : (
                  <>Auto-closing in <strong className="text-white font-bold">{remainingSeconds}s</strong></>
                )}
              </span>
            </div>

            {/* Action Buttons: Dismiss & View Customer 360 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSmoothClose}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                Dismiss
              </button>

              <button
                type="button"
                onClick={handleViewProfile}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-lg transition-all cursor-pointer transform active:scale-95 ${
                  isCheckIn
                    ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-emerald-500/25'
                    : 'bg-gradient-to-r from-amber-500 via-rose-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-amber-500/25'
                }`}
              >
                <span>View Customer 360</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
