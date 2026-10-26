import { useState } from "react";

const KEY = "readiness.warehouse";

/** Per-viewer remembered warehouse filter. */
export function useWarehouseChoice(): [string, (v: string) => void] {
  const [wh, setWh] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) ?? "wh_west";
    } catch {
      return "wh_west";
    }
  });
  return [wh, (v: string) => {
    setWh(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  }];
}
