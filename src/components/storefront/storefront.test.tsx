import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StorefrontImage from "./StorefrontImage";
import { isUsableImageSrc } from "./imageSrc";
import StorefrontRestaurantCard from "./StorefrontRestaurantCard";
import { StorefrontNotice } from "./StorefrontState";

const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("storefront image handling", () => {
  it("treats blank, missing and legacy placeholder paths as no photo", () => {
    expect(isUsableImageSrc(undefined)).toBe(false);
    expect(isUsableImageSrc(null)).toBe(false);
    expect(isUsableImageSrc("   ")).toBe(false);
    expect(isUsableImageSrc("/placeholder.svg")).toBe(false);
    expect(isUsableImageSrc("/restaurant-1.jpg")).toBe(true);
  });

  it("shows the Roma fallback instead of an empty img when there is no photo", () => {
    renderWithRouter(<StorefrontImage src="" alt="Magwinya Zone" className="h-20 w-20" />);

    expect(screen.queryByRole("img", { name: "Magwinya Zone" })).toBeNull();
    expect(screen.getByRole("img", { name: "Magwinya Zone — no photo yet" })).toBeInTheDocument();
  });

  it("falls back to the Roma mark when a photo URL is dead", () => {
    renderWithRouter(<StorefrontImage src="/gone.jpg" alt="Sheamus" className="h-20 w-20" />);

    const image = screen.getByRole("img", { name: "Sheamus" });
    fireEvent.error(image);

    expect(screen.queryByRole("img", { name: "Sheamus" })).toBeNull();
    expect(screen.getByRole("img", { name: "Sheamus — no photo yet" })).toBeInTheDocument();
  });
});

describe("storefront restaurant card", () => {
  it("renders the shared tile for any link target", () => {
    renderWithRouter(
      <StorefrontRestaurantCard
        to="/r/thuba-rush"
        name="Thuba Rush"
        cuisine="Grill & BBQ"
        rating={4.6}
        deliveryTime="20-30 min"
      />,
    );

    const card = screen.getByRole("link", { name: "Thuba Rush — view menu" });
    expect(card).toHaveAttribute("href", "/r/thuba-rush");
    expect(screen.getByText("Thuba Rush")).toBeInTheDocument();
    expect(screen.getByText("20-30 min")).toBeInTheDocument();
    expect(screen.getByText(/Grill & BBQ/)).toBeInTheDocument();
  });

  it("uses the fallback blurb when a restaurant has no description", () => {
    renderWithRouter(
      <StorefrontRestaurantCard to="/r/magwinya-zone" name="Magwinya Zone" blurb="   " />,
    );

    expect(
      screen.getByText("Discover a local favourite in Pretoria Central."),
    ).toBeInTheDocument();
  });
});

describe("storefront states", () => {
  it("marks errors as alert and offers a retry", () => {
    const onAction = vi.fn();
    renderWithRouter(
      <StorefrontNotice
        tone="error"
        title="Restaurants couldn’t be loaded right now"
        message="Please try again."
        actionLabel="Try again"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("keeps an empty state calm and links instead of retrying", () => {
    renderWithRouter(
      <StorefrontNotice
        title="Roma is onboarding restaurants"
        message="Check back soon."
        actionLabel="Browse the directory"
        actionHref="/r"
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Browse the directory" })).toHaveAttribute(
      "href",
      "/r",
    );
  });
});
