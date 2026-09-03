import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export default function OwnerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleOwnerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    setLoading(false);

    if (error) {
      toast.error("Login failed: " + error.message);
      return;
    }

    toast.success("Logged in successfully!");
    // Ensure this matches the route in App.tsx
    navigate('/owner'); 
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <form onSubmit={handleOwnerLogin} className="w-full max-w-sm space-y-4 bg-card p-6 rounded-lg border shadow-sm">
        <h1 className="text-2xl font-bold text-center">Owner Login</h1>
        
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input 
            type="email" 
            placeholder="owner@example.com" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="w-full border p-2 rounded bg-background"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input 
            type="password" 
            placeholder="••••••••" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            className="w-full border p-2 rounded bg-background"
          />
        </div>

        <button 
          type="submit" 
          disabled={loading} 
          className="w-full bg-primary text-primary-foreground p-2 rounded font-medium hover:opacity-90 transition"
        >
          {loading ? 'Logging in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
