"use client";
import { useCallback, useEffect, useState } from "react";

export function useApi<T>(fetcher: () => Promise<T>): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    fetcher()
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}
