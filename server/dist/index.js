import app from './app.js';
import { config } from './config.js';
import { loadDb } from './db/store.js';
loadDb();
const port = config.port;
app.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 PTA Eats Backend running!`);
    console.log(`   Local:   http://localhost:${port}`);
    console.log(`   Health:  http://localhost:${port}/health`);
    console.log(`   API:     http://localhost:${port}/api/restaurants`);
    console.log(`\n📦 Data file: ${config.dataFile}`);
    console.log(`🌐 Frontend URL: ${config.frontendUrl}`);
    console.log(`\n🔑 Default accounts (after seed):`);
    console.log(`   Admin:      admin@roma.co.za / admin123`);
    console.log(`   Deliverer:  deliverer@roma.co.za / deliverer123`);
    console.log(`   Owner:      owner@roma.co.za / owner123`);
    console.log(`   Customer:   customer@test.com / customer123`);
    console.log(`\n`);
});
