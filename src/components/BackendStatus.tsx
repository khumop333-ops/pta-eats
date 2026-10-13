import { useEffect, useState } from "react";
import { checkBackendHealth, backendEnabled } from "@/lib/backend";

export default function BackendStatus() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isBackendMode, setIsBackendMode] = useState(backendEnabled);

  useEffect(() => {
    setIsBackendMode(backendEnabled);
    checkBackendHealth().then((ok) => {
      setStatus(ok ? "online" : "offline");
    });
    const interval = setInterval(() => {
      checkBackendHealth().then((ok) => setStatus(ok ? "online" : "offline"));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  if (status === "checking") {
    return (
      <div className="fixed bottom-4 right-4 z-50 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground shadow">
        Checking backend…
      </div>
    );
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-lg transition-all ${
        status === "online"
          ? "bg-green-100 text-green-800 border border-green-200"
          : "bg-amber-100 text-amber-800 border border-amber-200"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${status === "online" ? "bg-green-500 animate-pulse" : "bg-amber-500"}`}
      />
      {status === "online" ? (
        <>
          <span className="font-medium">Backend Online</span>
          <span className="opacity-70">:3001</span>
          {isBackendMode && <span className="ml-1 rounded bg-green-200 px-1.5 py-0.5 text-[10px]">ACTIVE</span>}
        </>
      ) : (
        <>
          <span className="font-medium">Backend Offline</span>
          <span className="opacity-70">- using Supabase</span>
        </>
      )}
    </div>
  );
}
