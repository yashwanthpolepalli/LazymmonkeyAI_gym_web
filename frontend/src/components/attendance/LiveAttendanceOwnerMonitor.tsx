import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/services/api';
import {
  LiveAttendanceBottomPopup,
  type CustomerPunchData,
} from './LiveAttendanceBottomPopup';

export function LiveAttendanceOwnerMonitor() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<CustomerPunchData[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialFetchDoneRef = useRef<boolean>(false);

  // Only run live attendance polling for owners and super admins
  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'super_admin';

  const addPunchToQueue = useCallback((punch: CustomerPunchData) => {
    if (!punch || !punch.id) return;
    if (seenIdsRef.current.has(punch.id)) return;

    seenIdsRef.current.add(punch.id);

    setQueue((prev) => {
      // Avoid duplicate punches
      if (prev.some((p) => p.id === punch.id)) return prev;
      return [...prev, punch];
    });
  }, []);

  // 1. Initial snapshot & continuous polling for customer punches
  useEffect(() => {
    if (!isOwnerOrAdmin) return;

    let isMounted = true;

    // Check for recent customer check-ins
    const checkForCustomerPunches = async () => {
      try {
        // Try dedicated latest customer punch endpoint first
        const res = await api.biometrics.latestCustomerPunch().catch(() => null);

        if (res && res.has_new && res.punch) {
          const punch = res.punch as CustomerPunchData;

          // On first load, record existing punch ID to avoid alerting on old historical events
          if (!initialFetchDoneRef.current) {
            seenIdsRef.current.add(punch.id);
            initialFetchDoneRef.current = true;
            return;
          }

          if (isMounted) {
            addPunchToQueue(punch);
          }
        } else {
          // Fallback to recent check-ins if latestCustomerPunch returned nothing or on cold start
          const recents = await api.biometrics.recent(8, 'CUSTOMER').catch(() => []);
          if (Array.isArray(recents) && recents.length > 0) {
            if (!initialFetchDoneRef.current) {
              recents.forEach((r: any) => {
                if (r && r.id) seenIdsRef.current.add(r.id);
              });
              initialFetchDoneRef.current = true;
            } else if (isMounted) {
              // Check the top item
              const top = recents[0];
              if (top && top.id && !seenIdsRef.current.has(top.id)) {
                addPunchToQueue(top as CustomerPunchData);
              }
            }
          } else {
            initialFetchDoneRef.current = true;
          }
        }
      } catch (err) {
        // Silent fail on polling error to avoid disrupting owner UI
        console.warn('Attendance live feed poll notice:', err);
      }
    };

    // Run first check immediately
    checkForCustomerPunches();

    // Poll every 3.5 seconds
    const interval = setInterval(checkForCustomerPunches, 3500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOwnerOrAdmin, addPunchToQueue]);

  // 2. Custom window event listener for instant developer/manual testing
  useEffect(() => {
    const handleCustomTrigger = (event: Event) => {
      const customEvent = event as CustomEvent<CustomerPunchData>;
      if (customEvent.detail) {
        addPunchToQueue(customEvent.detail);
      }
    };

    window.addEventListener('fitclub:live-attendance', handleCustomTrigger);

    return () => {
      window.removeEventListener('fitclub:live-attendance', handleCustomTrigger);
    };
  }, [addPunchToQueue]);

  // Handle close / dismissal
  const handleClose = () => {
    setQueue((prev) => {
      // Remove current item or clear queue
      if (prev.length <= 1) {
        setCurrentIndex(0);
        return [];
      }
      const updated = [...prev];
      updated.splice(currentIndex, 1);
      setCurrentIndex((curr) => Math.min(curr, updated.length - 1));
      return updated;
    });
  };

  const handleNext = () => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  if (!isOwnerOrAdmin || queue.length === 0) {
    return null;
  }

  return (
    <LiveAttendanceBottomPopup
      queue={queue}
      currentIndex={currentIndex}
      onClose={handleClose}
      onNext={handleNext}
      onPrev={handlePrev}
      autoCloseSeconds={30}
    />
  );
}
