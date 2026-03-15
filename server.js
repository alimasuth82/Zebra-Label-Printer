import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT_NUMBER = process.env.PORT || 3000;

// Store access tokens (in production, use a proper database)
let accessTokenStore = {};

// Middleware
app.use(express.json());
app.use(express.static("public"));

app.get("/connect/square", (req, res) => {
  console.log("Redirecting to Square");

  const scopes = [
    "MERCHANT_PROFILE_READ",
    "ITEMS_READ",
    "ORDERS_READ",
    "PAYMENTS_READ",
    "CUSTOMERS_READ"
  ];

  const authUrl =
    "https://connect.squareup.com/oauth2/authorize" +
    `?client_id=${process.env.SQUARE_APP_ID}` +
    `&scope=${encodeURIComponent(scopes.join(' '))}` +
    `&redirect_url=${encodeURIComponent(
      `${process.env.BASE_URL}/oauth/callback`
    )}`;
  res.redirect(authUrl);
});

app.get("/oauth/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(`OAuth error: ${error}`);
  }

  if (!code) {
    return res.send("No authorization code received");
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://connect.squareup.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": "2024-12-18"
      },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APP_ID,
        client_secret: process.env.SQUARE_APP_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: `${process.env.BASE_URL}/oauth/callback`
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      // Store the access token (use merchant_id as key)
      const merchantId = tokenData.merchant_id;
      accessTokenStore[merchantId] = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at
      };

      // Fetch merchant information
      const merchantResponse = await fetch(`https://connect.squareup.com/v2/merchants/${merchantId}`, {
        headers: {
          "Square-Version": "2024-12-18",
          "Authorization": `Bearer ${tokenData.access_token}`
        }
      });

      const merchantData = await merchantResponse.json();
      
      if (merchantData.merchant) {
        accessTokenStore[merchantId].merchant_name = merchantData.merchant.business_name || 'User';
      }

      // Redirect to home page with merchant_id
      res.redirect(`/?merchant_id=${merchantId}`);
    } else {
      res.send(`Error obtaining access token: ${JSON.stringify(tokenData)}`);
    }
  } catch (err) {
    console.error("Error exchanging code for token:", err);
    res.send(`Error: ${err.message}`);
  }
});

// Optimized endpoint to fetch orders with ALL details included
app.get("/api/orders", async (req, res) => {
  const merchantId = req.query.merchant_id;

  if (!merchantId || !accessTokenStore[merchantId]) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { access_token } = accessTokenStore[merchantId];

  try {
    // 1. Get Locations (Square requires a location ID to search orders)
    const locRes = await fetch("https://connect.squareup.com/v2/locations", {
      headers: { "Square-Version": "2024-12-18", "Authorization": `Bearer ${access_token}` }
    });
    const locData = await locRes.json();
    const locationIds = locData.locations?.map(loc => loc.id) || [];

    // 2. Search for Orders
    const ordersRes = await fetch("https://connect.squareup.com/v2/orders/search", {
      method: "POST",
      headers: {
        "Square-Version": "2024-12-18",
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        location_ids: locationIds,
        query: {
          filter: { state_filter: { states: ["COMPLETED", "OPEN"] } },
          sort: { sort_field: "CREATED_AT", sort_order: "DESC" }
        }
      })
    });

    const ordersData = await ordersRes.json();
    if (!ordersData.orders) return res.json({ orders: [] });

    // 3. ENRICH DATA (The "Human" Way)
    // We loop through the orders once and attach customer and item info directly
    const enrichedOrders = await Promise.all(
      ordersData.orders.map(async (order) => {
        
        // Attach Customer Info
        if (order.customer_id) {
          const custRes = await fetch(`https://connect.squareup.com/v2/customers/${order.customer_id}`, {
            headers: { "Square-Version": "2024-12-18", "Authorization": `Bearer ${access_token}` }
          });
          const custData = await custRes.json();
          order.customer = custData.customer;
        }

        // Attach Item/Catalog Info (to check if it's a service)
        if (order.line_items) {
          await Promise.all(order.line_items.map(async (item) => {
            if (item.catalog_object_id) {
              const catRes = await fetch(`https://connect.squareup.com/v2/catalog/object/${item.catalog_object_id}?include_related_objects=true`, {
                headers: { "Square-Version": "2024-12-18", "Authorization": `Bearer ${access_token}` }
              });
              const catData = await catRes.json();
              // Find the 'ITEM' details to get the product_type (e.g., APPOINTMENTS_SERVICE)
              const itemObj = catData.related_objects?.find(obj => obj.type === 'ITEM');
              item.product_type = itemObj?.item_data?.product_type || 'REGULAR';
            }
          }));
        }
        return order;
      })
    );

    res.json({ orders: enrichedOrders });
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// We can now DELETE the old /api/order-items route because /api/orders does it all!

app.get("/api/merchant", (req, res) => {
  const merchantId = req.query.merchant_id;
  if (!merchantId || !accessTokenStore[merchantId]) return res.status(401).json({ error: "Not authenticated" });
  res.json({
    merchant_name: accessTokenStore[merchantId].merchant_name || 'User',
    merchant_id: merchantId
  });
});

app.listen(PORT_NUMBER, () => console.log(`Server running on port ${PORT_NUMBER}`));