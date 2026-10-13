import { loadDb, getDb, saveDb, nextRestaurantId } from './store.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
loadDb();
const db = getDb();
function now() {
    return new Date().toISOString();
}
async function seed() {
    if (db.restaurants.length > 0) {
        console.log('DB already has restaurants, skipping seed. Delete server/data/db.json to reseed.');
        return;
    }
    console.log('Seeding fresh database...');
    // Admin user
    const adminId = uuidv4();
    const adminHash = await bcrypt.hash('admin123', 10);
    db.users.push({
        id: adminId,
        email: 'admin@roma.co.za',
        password_hash: adminHash,
        full_name: 'Roma Admin',
        phone_number: '012 345 6789',
        role: 'admin',
        created_at: now(),
    });
    // Deliverer
    const delivId = uuidv4();
    const delivHash = await bcrypt.hash('deliverer123', 10);
    db.users.push({
        id: delivId,
        email: 'deliverer@roma.co.za',
        password_hash: delivHash,
        full_name: 'John Deliverer',
        phone_number: '082 123 4567',
        role: 'deliverer',
        created_at: now(),
    });
    // Owner 1
    const owner1Id = uuidv4();
    const owner1Hash = await bcrypt.hash('owner123', 10);
    db.users.push({
        id: owner1Id,
        email: 'owner@roma.co.za',
        password_hash: owner1Hash,
        full_name: 'Maria Owner',
        phone_number: '083 111 2222',
        role: 'restaurant_owner',
        created_at: now(),
    });
    // Customer user
    const customerId = uuidv4();
    const customerHash = await bcrypt.hash('customer123', 10);
    db.users.push({
        id: customerId,
        email: 'customer@test.com',
        password_hash: customerHash,
        full_name: 'Test Customer',
        phone_number: '084 000 0000',
        role: 'user',
        created_at: now(),
    });
    // Restaurants
    const restaurantsSeed = [
        {
            name: "Mama's Kitchen",
            cuisine: 'South African',
            rating: 4.8,
            delivery_time: '25-35 min',
            image_url: '/src/assets/restaurant-1.jpg',
            owner_id: owner1Id,
        },
        {
            name: 'Pretoria Grill House',
            cuisine: 'Grill & BBQ',
            rating: 4.6,
            delivery_time: '20-30 min',
            image_url: '/src/assets/restaurant-2.jpg',
            owner_id: null,
        },
        {
            name: 'Cape Town Fish & Chips',
            cuisine: 'Seafood',
            rating: 4.7,
            delivery_time: '30-40 min',
            image_url: '/src/assets/restaurant-3.jpg',
            owner_id: null,
        },
        {
            name: 'Roma Italian',
            cuisine: 'Italian',
            rating: 4.9,
            delivery_time: '20-35 min',
            image_url: '/src/assets/hero-food.jpg',
            owner_id: null,
        },
    ];
    for (const r of restaurantsSeed) {
        const id = nextRestaurantId();
        db.restaurants.push({
            id,
            name: r.name,
            cuisine: r.cuisine,
            rating: r.rating,
            delivery_time: r.delivery_time,
            image_url: r.image_url,
            owner_id: r.owner_id,
            created_at: now(),
            updated_at: now(),
        });
    }
    // Menu items
    const menuSeed = {
        "Mama's Kitchen": [
            { name: 'Pap & Wors', description: 'Traditional pap with boerewors and chakalaka', price: 85, category: 'Mains' },
            { name: 'Bunny Chow', description: 'Durban style bunny chow with chicken curry', price: 95, category: 'Mains' },
            { name: 'Bobotie', description: 'Cape Malay bobotie with yellow rice', price: 110, category: 'Mains' },
            { name: 'Malva Pudding', description: 'Warm malva pudding with custard', price: 45, category: 'Desserts' },
            { name: 'Rooibos Iced Tea', description: 'Refreshing rooibos iced tea', price: 25, category: 'Drinks' },
        ],
        'Pretoria Grill House': [
            { name: 'T-Bone Steak 500g', description: 'Grilled T-bone with chips and salad', price: 185, category: 'Grill' },
            { name: 'Boerewors Roll', description: 'Boerewors roll with caramelized onions', price: 65, category: 'Grill' },
            { name: 'Mixed Grill Platter', description: 'Steak, wors, chicken, chips for 2', price: 295, category: 'Platters' },
            { name: 'Garlic Bread', description: 'Freshly baked garlic bread', price: 35, category: 'Sides' },
            { name: 'Coke 330ml', description: 'Coca Cola', price: 20, category: 'Drinks' },
        ],
        'Cape Town Fish & Chips': [
            { name: 'Hake & Chips', description: 'Battered hake with chips and tartar sauce', price: 95, category: 'Mains' },
            { name: 'Calamari & Chips', description: 'Crispy calamari rings with chips', price: 110, category: 'Mains' },
            { name: 'Fish Burger', description: 'Grilled fish burger with slaw', price: 75, category: 'Burgers' },
            { name: 'Seafood Platter', description: 'Prawns, calamari, fish, chips', price: 245, category: 'Platters' },
        ],
        'Roma Italian': [
            { name: 'Margherita Pizza', description: 'Tomato, mozzarella, basil', price: 120, category: 'Pizza' },
            { name: 'Spaghetti Carbonara', description: 'Creamy carbonara with bacon', price: 135, category: 'Pasta' },
            { name: 'Lasagna', description: 'Beef lasagna with bechamel', price: 145, category: 'Pasta' },
            { name: 'Tiramisu', description: 'Classic tiramisu', price: 55, category: 'Desserts' },
            { name: 'Espresso', description: 'Double shot espresso', price: 30, category: 'Drinks' },
        ],
    };
    for (const restaurant of db.restaurants) {
        const items = menuSeed[restaurant.name] || [];
        for (const item of items) {
            db.menu_items.push({
                id: uuidv4(),
                restaurant_id: restaurant.id,
                name: item.name,
                description: item.description,
                price: item.price,
                category: item.category,
                created_at: now(),
                updated_at: now(),
            });
        }
    }
    saveDb();
    console.log('Seed complete!');
    console.log(`Admin: admin@roma.co.za / admin123`);
    console.log(`Deliverer: deliverer@roma.co.za / deliverer123`);
    console.log(`Owner: owner@roma.co.za / owner123`);
    console.log(`Customer: customer@test.com / customer123`);
    console.log(`Restaurants: ${db.restaurants.length}, Menu items: ${db.menu_items.length}`);
}
seed();
