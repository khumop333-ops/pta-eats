import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "@/integrations/supabase/lazyClient";

interface Profile {
  full_name: string | null;
  phone_number: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const supabase = await getSupabase();
    const { data } = await supabase
      .from("profiles")
      .select("full_name, phone_number")
      .eq("id", userId)
      .single();
    setProfile(data);
  };

  const refreshProfile = async () => {
    if (session?.user?.id) await fetchProfile(session.user.id);
  };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      const supabase = await getSupabase();
      if (!active) return;

      const { data: authState } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setLoading(false);
        if (nextSession?.user) {
          setTimeout(() => {
            if (active) void fetchProfile(nextSession.user.id);
          }, 0);
        } else {
          setProfile(null);
        }
      });
      unsubscribe = () => authState.subscription.unsubscribe();

      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;
      setSession(sessionData.session);
      setLoading(false);
      if (sessionData.session?.user) {
        void fetchProfile(sessionData.session.user.id);
      }
    };

    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signOut = async () => {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
