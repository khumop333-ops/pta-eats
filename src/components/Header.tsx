import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UtensilsCrossed, LogOut, User, ClipboardList, Truck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const Header = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <UtensilsCrossed className="h-7 w-7 text-primary" />
          <span className="font-display text-xl font-bold text-foreground">
            Roma
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden sm:inline text-sm text-muted-foreground">
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
      </div>
    </header>
  );
};

export default Header;
