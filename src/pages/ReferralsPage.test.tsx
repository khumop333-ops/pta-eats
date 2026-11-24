import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  openWhatsApp: vi.fn((_link: string) => true),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/context/AuthContext", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
    },
  },
}));
vi.mock("@/lib/whatsapp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp")>()),
  openWhatsApp: mocks.openWhatsApp,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import ReferralsPage from "./ReferralsPage";
import AuthPage from "./AuthPage";
import CampaignBanner from "@/components/storefront/CampaignBanner";

function queryChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

describe("ReferralsPage & referral sign-up campaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  it("explains the 3-step free delivery and referral campaign to guests", () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      profile: null,
      loading: false,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/referrals"]}>
        <Routes>
          <Route path="/referrals" element={<ReferralsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /Free First Delivery & Referral Rewards/i })).toBeInTheDocument();
    expect(screen.getByText(/1\. Sign up, get 1st delivery free/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Earn 1 free delivery per friend/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Create account & get free delivery/i }),
    ).toHaveAttribute("href", "/auth?mode=signup");
  });

  it("shows signed-in customers their free delivery balance, shareable referral link and friend statuses", async () => {
    const refreshProfile = vi.fn();
    mocks.useAuth.mockReturnValue({
      user: { id: "user-1", email: "thabo@example.com" },
      profile: {
        full_name: "Thabo Mokoena",
        phone_number: "072 123 4567",
        referral_code: "ROMA-7K3P9X",
        referred_by_user_id: null,
        free_delivery_credits: 2,
        orders_placed_count: 0,
      },
      loading: false,
      signOut: vi.fn(),
      refreshProfile,
    });

    mocks.from.mockImplementation((table: string) =>
      queryChain(
        table === "referrals"
          ? {
              data: [
                {
                  id: "ref-1",
                  referrer_id: "user-1",
                  referred_user_id: "user-2",
                  referred_name: "Lerato",
                  status: "rewarded",
                  rewarded_at: "2026-11-24T10:00:00Z",
                  created_at: "2026-11-23T10:00:00Z",
                },
                {
                  id: "ref-2",
                  referrer_id: "user-1",
                  referred_user_id: "user-3",
                  referred_name: "Sipho",
                  status: "pending_first_order",
                  rewarded_at: null,
                  created_at: "2026-11-24T11:00:00Z",
                },
              ],
              error: null,
            }
          : {
              data: [
                {
                  id: "red-1",
                  user_id: "user-1",
                  promo_code: "FD-8M2K9P",
                  restaurant_name: "Magwinya Zone",
                  restaurant_slug: "magwinya-zone",
                  saved_amount: 15,
                  order_subtotal: 90,
                  customer_name: "Thabo Mokoena",
                  customer_phone: "072 123 4567",
                  order_id: null,
                  created_at: "2026-11-24T09:00:00Z",
                },
              ],
              error: null,
            },
      ),
    );

    render(
      <MemoryRouter initialEntries={["/referrals"]}>
        <Routes>
          <Route path="/referrals" element={<ReferralsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Lerato")).toBeInTheDocument();
    expect(screen.getByText("+1 Free delivery earned")).toBeInTheDocument();
    expect(screen.getByText("Sipho")).toBeInTheDocument();
    expect(screen.getByText("Awaiting 1st order")).toBeInTheDocument();
    expect(screen.getByText("FD-8M2K9P")).toBeInTheDocument();
    expect(screen.getByText("Saved R 15.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("ROMA-7K3P9X"));

    fireEvent.click(screen.getByRole("button", { name: /Share invite on WhatsApp/i }));
    expect(mocks.openWhatsApp).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(mocks.openWhatsApp.mock.calls[0][0])).toContain("ROMA-7K3P9X");
  });

  it("pre-fills the referral code on /auth?mode=signup&ref=... and forwards it in sign-up metadata", async () => {
    mocks.useAuth.mockReturnValue({
      user: null,
      profile: null,
      loading: false,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });
    mocks.signUp.mockResolvedValue({ data: { session: { user: { id: "new-user" } } }, error: null });

    render(
      <MemoryRouter initialEntries={["/auth?mode=signup&ref=roma-7k3p9x"]}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/Referral Code/i)).toHaveValue("ROMA-7K3P9X");

    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Naledi Khumalo" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "naledi@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Account & Claim Free Delivery/i }));

    await waitFor(() => {
      expect(mocks.signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "naledi@example.com",
          password: "secret123",
          options: expect.objectContaining({
            data: {
              full_name: "Naledi Khumalo",
              referral_code: "ROMA-7K3P9X",
            },
          }),
        }),
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Welcome to Roma! Your first delivery is FREE.");
  });

  it("renders 'Order now' on CampaignBanner without any stars icon", () => {
    mocks.useAuth.mockReturnValue({
      user: { id: "user-1", email: "thabo@example.com" },
      profile: {
        full_name: "Thabo Mokoena",
        referral_code: "ROMA-7K3P9X",
        free_delivery_credits: 1,
        orders_placed_count: 0,
      },
      loading: false,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <CampaignBanner />
      </MemoryRouter>,
    );

    const orderNowLink = screen.getByRole("link", { name: "Order now" });
    expect(orderNowLink).toHaveAttribute("href", "/r");
    expect(orderNowLink.querySelector("svg")).toBeNull();
  });
});
