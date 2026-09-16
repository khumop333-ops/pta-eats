// Keep the Supabase SDK out of the initial application chunk. Auth and data
// modules load it on demand when the app needs to talk to Supabase.
export const getSupabase = async () => {
  const { supabase } = await import("./client");
  return supabase;
};
