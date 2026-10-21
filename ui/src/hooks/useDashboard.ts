import { useCallback, useEffect, useRef, useState } from "react";
import type { BufferStatus, DashboardData } from "@feedback/contracts";
import { api, errorMessage } from "../api.ts";

export function useDashboard(query: string) {
  const [buffer, setBuffer] = useState<BufferStatus | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [bufferError, setBufferError] = useState("");
  const [dashboardError, setDashboardError] = useState("");
  const refreshDashboard = useRef<() => Promise<void>>(async () => {});
  const refreshBuffer = useRef<() => Promise<void>>(async () => {});
  // Buffer polling is independent: invalid filters must not disable collection/flush.
  useEffect(() => {
    let active = true;
    let flight: Promise<void> | null = null;
    const refresh = (): Promise<void> => {
      if (flight) return flight;
      flight = api
        .buffer()
        .then((value) => {
          if (active) {
            setBuffer(value);
            setBufferError("");
          }
        })
        .catch((error) => {
          if (active)
            setBufferError(`Buffer refresh failed: ${errorMessage(error)}`);
        })
        .finally(() => {
          flight = null;
        });
      return flight;
    };
    refreshBuffer.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let flight: Promise<void> | null = null;
    setData(null);
    setDashboardError("");
    const refresh = (): Promise<void> => {
      if (flight) return flight;
      flight = api
        .dashboard(query, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setData(value);
            setDashboardError("");
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setDashboardError(
              `Live refresh failed: ${errorMessage(error)} Displayed data may be stale.`,
            );
        })
        .finally(() => {
          flight = null;
        });
      return flight;
    };
    refreshDashboard.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [query]);
  const refresh = useCallback(async () => {
    await Promise.all([refreshBuffer.current(), refreshDashboard.current()]);
  }, []);
  return {
    buffer,
    data,
    pollError: [bufferError, dashboardError].filter(Boolean).join(" "),
    refresh,
  };
}
