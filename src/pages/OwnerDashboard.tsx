import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

export default function OwnerDashboard() {
  const navigate = useNavigate();
  
  // Restaurant Form State
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantAddress, setRestaurantAddress] = useState('');
  const [restaurantPhone, setRestaurantPhone] = useState('');

  // Deliverer Form State
  const [delivererName, setDelivererName] = useState('');
  const [delivererPhone, setDelivererPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('Car');

  // Status Messages
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Handle Add Restaurant
  const handleAddRestaurant = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const { error } = await supabase
      .from('restaurants')
      .insert([
        {
          name: restaurantName,
          address: restaurantAddress,
          phone: restaurantPhone,
        },
      ]);

    setLoading(false);

    if (error) {
      setMessage(`Error adding restaurant: ${error.message}`);
    } else {
      setMessage('Restaurant added successfully!');
      setRestaurantName('');
      setRestaurantAddress('');
      setRestaurantPhone('');
    }
  };

  // Handle Add Deliverer
  const handleAddDeliverer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const { error } = await supabase
      .from('deliverers')
      .insert([
        {
          name: delivererName,
          phone: delivererPhone,
          vehicle_type: vehicleType,
          status: 'active',
        },
      ]);

    setLoading(false);

    if (error) {
      setMessage(`Error adding deliverer: ${error.message}`);
    } else {
      setMessage('Deliverer added successfully!');
      setDelivererName('');
      setDelivererPhone('');
      setVehicleType('Car');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Owner Dashboard</h1>
          <button 
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
          >
            Logout
          </button>
        </div>

        {message && (
          <div className="mb-6 p-4 rounded bg-blue-100 text-blue-800 font-medium">
            {message}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          {/* Add Restaurant Form */}
          <div className="bg-white p-6 rounded-lg shadow-md border">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Add New Restaurant</h2>
            <form onSubmit={handleAddRestaurant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Restaurant Name</label>
                <input
                  type="text"
                  required
                  value={restaurantName}
                  onChange={(e) => setRestaurantName(e.target.value)}
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Pretoria Eats Diner"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address / Location</label>
                <input
                  type="text"
                  required
                  value={restaurantAddress}
                  onChange={(e) => setRestaurantAddress(e.target.value)}
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Hatfield, Pretoria"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={restaurantPhone}
                  onChange={(e) => setRestaurantPhone(e.target.value)}
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="012 345 6789"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded font-medium"
              >
                {loading ? 'Adding...' : 'Add Restaurant'}
              </button>
            </form>
          </div>

          {/* Add Deliverer Form */}
          <div className="bg-white p-6 rounded-lg shadow-md border">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Add New Deliverer</h2>
            <form onSubmit={handleAddDeliverer} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={delivererName}
                  onChange={(e) => setDelivererName(e.target.value)}
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={delivererPhone}
                  onChange={(e) => setDelivererPhone(e.target.value)}
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="082 123 4567"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Vehicle Type</label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Car">Car</option>
                  <option value="Motorbike">Motorbike</option>
                  <option value="Bicycle">Bicycle</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-medium"
              >
                {loading ? 'Adding...' : 'Add Deliverer'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
