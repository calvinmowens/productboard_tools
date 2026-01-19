import { useEffect, useRef, useCallback, useState } from "react";

interface UseInactivityTimeoutOptions {
  /** Time in milliseconds before showing warning (default: 25 minutes) */
  warningMs?: number;
  /** Time in milliseconds before timeout (default: 30 minutes) */
  timeoutMs?: number;
  /** Whether the timeout is active (e.g., only when authenticated) */
  enabled?: boolean;
}

interface UseInactivityTimeoutReturn {
  /** Whether the warning should be shown */
  showWarning: boolean;
  /** Time remaining until timeout (in seconds) */
  timeRemaining: number;
  /** Dismiss the warning and reset the timer */
  dismissWarning: () => void;
  /** Manually reset the inactivity timer */
  resetTimer: () => void;
}

const DEFAULT_WARNING_MS = 25 * 60 * 1000; // 25 minutes
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Hook to track user inactivity and trigger callbacks for warning and timeout.
 * Resets timer on user activity (mouse, keyboard, touch, scroll).
 */
export function useInactivityTimeout(
  onTimeout: () => void,
  options: UseInactivityTimeoutOptions = {}
): UseInactivityTimeoutReturn {
  const {
    warningMs = DEFAULT_WARNING_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    enabled = true,
  } = options;

  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(Math.floor((timeoutMs - warningMs) / 1000));

  const lastActivityRef = useRef<number>(0);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  const clearAllTimers = useCallback(() => {
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
      warningTimeoutRef.current = null;
    }
    if (finalTimeoutRef.current) {
      clearTimeout(finalTimeoutRef.current);
      finalTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    clearAllTimers();

    if (!enabled) return;

    lastActivityRef.current = Date.now();

    // Set warning timer
    warningTimeoutRef.current = setTimeout(() => {
      setShowWarning(true);
      setTimeRemaining(Math.floor((timeoutMs - warningMs) / 1000));

      // Start countdown
      countdownIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - lastActivityRef.current;
        const remaining = Math.max(0, Math.floor((timeoutMs - elapsed) / 1000));
        setTimeRemaining(remaining);

        if (remaining <= 0) {
          clearAllTimers();
          setShowWarning(false);
          onTimeout();
        }
      }, 1000);
    }, warningMs);

    // Set final timeout as backup
    finalTimeoutRef.current = setTimeout(() => {
      clearAllTimers();
      setShowWarning(false);
      onTimeout();
    }, timeoutMs);
  }, [enabled, warningMs, timeoutMs, onTimeout, clearAllTimers]);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    startTimers();
  }, [startTimers]);

  const dismissWarning = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  // Reset state when disabled
  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      initializedRef.current = false;
      // Use setTimeout to avoid synchronous setState during render
      const id = setTimeout(() => setShowWarning(false), 0);
      return () => clearTimeout(id);
    }
  }, [enabled, clearAllTimers]);

  // Set up activity listeners when enabled
  useEffect(() => {
    if (!enabled) return;

    // Initialize lastActivityRef on first enable
    if (!initializedRef.current) {
      lastActivityRef.current = Date.now();
      initializedRef.current = true;
    }

    const handleActivity = () => {
      // Only reset if warning is not showing (once warning shows, only explicit dismiss resets)
      if (!showWarning) {
        lastActivityRef.current = Date.now();
      }
    };

    // Activity events to track
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click"];

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start the timers
    startTimers();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      clearAllTimers();
    };
  }, [enabled, startTimers, clearAllTimers, showWarning]);

  return {
    showWarning,
    timeRemaining,
    dismissWarning,
    resetTimer,
  };
}
