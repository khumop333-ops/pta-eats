import restaurant1 from "@/assets/restaurant-1.jpg";
import restaurant2 from "@/assets/restaurant-2.jpg";
import restaurant3 from "@/assets/restaurant-3.jpg";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
}

export interface Restaurant {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  image: string;
  deliveryTime: string;
  menu: MenuItem[];
}

export const restaurants: Restaurant[] = [
  {
    id: 1,
    name: "Tshwane Kitchen",
    cuisine: "Traditional South African",
    rating: 4.5,
    image: restaurant1,
    deliveryTime: "25–35 min",
    menu: [
      { id: "tk-s1", name: "Chakalaka Dip", description: "Spicy vegetable relish with toasted bread.", price: 45, category: "Starters" },
      { id: "tk-s2", name: "Mielie Soup", description: "Creamy sweetcorn soup with herbs.", price: 40, category: "Starters" },
      { id: "tk-m1", name: "Chicken Bunny Chow", description: "Half loaf filled with mild or hot curry.", price: 85, category: "Mains" },
      { id: "tk-m2", name: "Braai Platter", description: "Boerewors, lamb chops, pap & chakalaka.", price: 145, category: "Mains" },
      { id: "tk-m3", name: "Bobotie", description: "Classic Cape Malay spiced mince with yellow rice.", price: 95, category: "Mains" },
      { id: "tk-m4", name: "Shisa Nyama Combo", description: "Grilled meat with pap, gravy & coleslaw.", price: 110, category: "Mains" },
      { id: "tk-d1", name: "Malva Pudding", description: "Warm apricot sponge with custard.", price: 45, category: "Desserts" },
      { id: "tk-d2", name: "Koeksisters", description: "Crispy syrup-soaked dough twists (3 pcs).", price: 35, category: "Desserts" },
      { id: "tk-dr1", name: "Rooibos Iced Tea", description: "Chilled rooibos with lemon & honey.", price: 25, category: "Drinks" },
      { id: "tk-dr2", name: "Ginger Beer", description: "Home-brewed spicy ginger beer.", price: 30, category: "Drinks" },
    ],
  },
  {
    id: 2,
    name: "Church Street Eats",
    cuisine: "Street Food & Grills",
    rating: 4.3,
    image: restaurant2,
    deliveryTime: "20–30 min",
    menu: [
      { id: "cs-s1", name: "Vetkoek Bites", description: "Mini fried dough balls with mince.", price: 40, category: "Starters" },
      { id: "cs-s2", name: "Chicken Wings", description: "Peri-peri grilled wings (6 pcs).", price: 55, category: "Starters" },
      { id: "cs-m1", name: "Boerewors Roll", description: "Grilled boerewors in a roll with relish.", price: 65, category: "Mains" },
      { id: "cs-m2", name: "Loaded Kota", description: "Quarter bread filled with chips, polony & atchar.", price: 55, category: "Mains" },
      { id: "cs-m3", name: "Flame-Grilled Burger", description: "Beef patty, cheese, pickles & sauce.", price: 85, category: "Mains" },
      { id: "cs-d1", name: "Peppermint Crisp Tart", description: "Layered caramel and cream dessert.", price: 40, category: "Desserts" },
      { id: "cs-dr1", name: "Cream Soda", description: "Classic green cream soda.", price: 20, category: "Drinks" },
      { id: "cs-dr2", name: "Iron Brew", description: "South African favourite fizzy drink.", price: 20, category: "Drinks" },
    ],
  },
  {
    id: 3,
    name: "Sunnyside Spices",
    cuisine: "Indian & African Fusion",
    rating: 4.7,
    image: restaurant3,
    deliveryTime: "30–40 min",
    menu: [
      { id: "ss-s1", name: "Samoosas", description: "Crispy pastry with spiced lamb filling (4 pcs).", price: 45, category: "Starters" },
      { id: "ss-s2", name: "Bhajias", description: "Onion and spinach fritters with chutney.", price: 35, category: "Starters" },
      { id: "ss-m1", name: "Butter Chicken", description: "Creamy tomato curry with basmati rice.", price: 95, category: "Mains" },
      { id: "ss-m2", name: "Lamb Rogan Josh", description: "Slow-cooked lamb in aromatic spices.", price: 120, category: "Mains" },
      { id: "ss-m3", name: "Vegetable Biryani", description: "Fragrant rice with mixed vegetables.", price: 75, category: "Mains" },
      { id: "ss-m4", name: "Durban Prawn Curry", description: "Spicy prawn curry with roti.", price: 130, category: "Mains" },
      { id: "ss-d1", name: "Gulab Jamun", description: "Warm syrup-soaked dumplings (3 pcs).", price: 35, category: "Desserts" },
      { id: "ss-dr1", name: "Mango Lassi", description: "Smooth mango yoghurt drink.", price: 30, category: "Drinks" },
      { id: "ss-dr2", name: "Masala Chai", description: "Spiced Indian tea with milk.", price: 25, category: "Drinks" },
    ],
  },
];

export const getRestaurantById = (id: number): Restaurant | undefined =>
  restaurants.find((r) => r.id === id);
