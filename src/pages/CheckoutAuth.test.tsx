import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useCart: vi.fn(),
  invoke: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/context/CartContext", () => ({ useCart: mocks.useCart }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
    },
  },
}));
vi.mock("@/components/Header", () => ({ default: () => <header>Roma</header> }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import AuthPage from "./AuthPage";
import Checkout from "./Checkout";
import { getAuthReturnPath } from "@/lib/authRedirect";

function LocationDisplay() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </output>
  );
}

function CheckoutRoutes() {
  return (
    <MemoryRouter initialEntries={["/checkout"]}>
      <Routes>
        <Route path="/checkout" element={<Checkout />} />
        <Route
          path="/auth"
          element={
            <>
              <p>Auth screen</p>
              <LocationDisplay />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function AuthRoutes() {
  return (
    <MemoryRouter
      initialEntries={[
        { pathname: "/auth", state: { from: "/checkout" } },
      ]}
    >
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route
          path="/checkout"
          element={
            <>
              <p>Checkout destination</p>
              <LocationDisplay />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("checkout sign-in return flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCart.mockReturnValue({
      items: [{ id: "menu-item-1", name: "Kota", price: 45, quantity: 1, restaurantId: 1 }],
      subtotal: 45,
      clearCart: vi.fn(),
    });
  });

  it("waits for auth loading before redirecting a guest and preserves checkout as the return path", async () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, loading: true });
    const { rerender } = render(<CheckoutRoutes />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking your account");
    expect(screen.queryByText("Auth screen")).not.toBeInTheDocument();

    mocks.useAuth.mockReturnValue({ user: null, profile: null, loading: false });
    rerender(<CheckoutRoutes />);

    await screen.findByText("Auth screen");
    expect(screen.getByTestId("location").textContent).toBe('/auth|{"from":"/checkout"}');
    expect(mocks.toastError).toHaveBeenCalledWith("Please sign in to checkout");
  });

  it("returns to the saved route once the auth context confirms sign-in", async () => {
    mocks.useAuth.mockReturnValue({ user: null, profile: null, loading: false });
    mocks.signInWithPassword.mockResolvedValue({ data: { user: {} }, error: null });

    const { rerender } = render(<AuthRoutes />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "customer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: "customer@example.com",
        password: "password123",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Welcome back!");
    expect(screen.queryByText("Checkout destination")).not.toBeInTheDocument();

    mocks.useAuth.mockReturnValue({
      user: { id: "customer-1", email: "customer@example.com" },
      profile: null,
      loading: false,
    });
    rerender(<AuthRoutes />);

    await screen.findByText("Checkout destination");
    expect(screen.getByTestId("location").textContent).toBe("/checkout|null");
  });

  it("rejects external or malformed return targets", () => {
    expect(getAuthReturnPath({ from: "/checkout" })).toBe("/checkout");
    expect(getAuthReturnPath({ from: "https://example.com" })).toBe("/");
    expect(getAuthReturnPath({ from: "//example.com" })).toBe("/");
    expect(getAuthReturnPath(null)).toBe("/");
  });
});
