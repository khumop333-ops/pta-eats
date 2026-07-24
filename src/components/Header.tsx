import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, User, ClipboardList, Truck, Menu, X, Store } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const Header = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    navigate("/");
  };

  const closeMenu = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4">
        <Link to="/" className="flex items-center gap-2 min-w-0" onClick={closeMenu}>
          <img
            src="/roma-logo.jpg"
            alt="Roma"
            className="h-10 w-10 shrink-0 rounded-xl object-cover"
          />
          <span className="font-display text-xl font-bold text-foreground truncate">
            Roma
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden lg:inline text-sm text-muted-foreground">
                <User className="inline h-4 w-4 mr-1" />
                {profile?.full_name || user.email}
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/my-orders">
                  <ClipboardList className="h-4 w-4 mr-1" /> My Orders
                </Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-1" /> Sign Out
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/auth">Login</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link to="/owner/login">Restaurant Login</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/deliverer/login">
              <Truck className="h-4 w-4 mr-1" /> Deliverer
            </Link>
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted"
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t bg-card">
          <nav className="container mx-auto flex flex-col gap-1 px-4 py-3">
            {user ? (
              <>
                <div className="px-2 py-2 text-sm text-muted-foreground">
                  <User className="inline h-4 w-4 mr-1" />
                  {profile?.full_name || user.email}
                </div>
                <Button variant="ghost" className="justify-start" asChild onClick={closeMenu}>
                  <Link to="/my-orders">
                    <ClipboardList className="h-4 w-4 mr-2" /> My Orders
                  </Link>
                </Button>
                <Button variant="ghost" className="justify-start" onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" /> Sign Out
                </Button>
              </>
            ) : (
              <Button variant="ghost" className="justify-start" asChild onClick={closeMenu}>
                <Link to="/auth">
                  <User className="h-4 w-4 mr-2" /> Login
                </Link>
              </Button>
            )}
            <Button variant="ghost" className="justify-start" asChild onClick={closeMenu}>
              <Link to="/owner/login">
                <Store className="h-4 w-4 mr-2" /> Restaurant Login
              </Link>
            </Button>
            <Button variant="ghost" className="justify-start" asChild onClick={closeMenu}>
              <Link to="/deliverer/login">
                <Truck className="h-4 w-4 mr-2" /> Deliverer
              </Link>
            </Button>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
