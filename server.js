import express from "express";
import dotenv from "dotenv";
import { exec } from "child_process";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Store tokens (for small internal use this is OK)
let accessTokenStore = {};

// Middleware
app.use(express.json());
app.use(express.static("public"));

/*
------------------------------------------------
CONNECT TO SQUARE
------------------------------------------------
*/
app.get("/connect/square", (req, res) => {

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
    `&scope=${encodeURIComponent(scopes.join(" "))}` +
    `&redirect_url=${encodeURIComponent(
      `${process.env.BASE_URL}/oauth/callback`
    )}`;

  res.redirect(authUrl);
});


/*
------------------------------------------------
OAUTH CALLBACK
------------------------------------------------
*/
app.get("/oauth/callback", async (req, res) => {

  const { code, error } = req.query;

  if (error) {
    console.error("OAuth Error:", error);
    return res.send(`OAuth error: ${error}`);
  }

  if (!code) {
    return res.send("No authorization code received.");
  }

  try {

    const tokenResponse = await fetch(
      "https://connect.squareup.com/oauth2/token",
      {
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
          redirect_url: `${process.env.BASE_URL}/oauth/callback`
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error("Token Error:", tokenData);
      return res.send(`Token error: ${JSON.stringify(tokenData)}`);
    }

    const merchantId = tokenData.merchant_id;

    accessTokenStore[merchantId] = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at
    };

    /*
    ------------------------------------
    Fetch merchant name
    ------------------------------------
    */
    const merchantResponse = await fetch(
      `https://connect.squareup.com/v2/merchants/${merchantId}`,
      {
        headers: {
          "Square-Version": "2024-12-18",
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    const merchantData = await merchantResponse.json();

    if (merchantData.merchant) {
      accessTokenStore[merchantId].merchant_name =
        merchantData.merchant.business_name || "User";
    }

    res.redirect(`/?merchant_id=${merchantId}`);

  } catch (err) {
    console.error("OAuth exchange error:", err);
    res.status(500).send(err.message);
  }
});


/*
------------------------------------------------
GET ORDERS
------------------------------------------------
*/
app.get("/api/orders", async (req, res) => {

  const merchantId = req.query.merchant_id;

  if (!merchantId || !accessTokenStore[merchantId]) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { access_token } = accessTokenStore[merchantId];

  try {

    /*
    --------------------------
    Get locations
    --------------------------
    */
    const locRes = await fetch(
      "https://connect.squareup.com/v2/locations",
      {
        headers: {
          "Square-Version": "2024-12-18",
          Authorization: `Bearer ${access_token}`
        }
      }
    );

    const locData = await locRes.json();

    const locationIds =
      locData.locations?.map(loc => loc.id) || [];

    /*
    --------------------------
    Search orders
    --------------------------
    */
    const ordersRes = await fetch(
      "https://connect.squareup.com/v2/orders/search",
      {
        method: "POST",
        headers: {
          "Square-Version": "2024-12-18",
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          location_ids: locationIds,
          query: {
            filter: {
              state_filter: {
                states: ["COMPLETED", "OPEN"]
              }
            },
            sort: {
              sort_field: "CREATED_AT",
              sort_order: "DESC"
            }
          }
        })
      }
    );

    const ordersData = await ordersRes.json();

    if (!ordersData.orders) {
      return res.json({ orders: [] });
    }

    /*
    --------------------------
    Enrich orders
    --------------------------
    */
    const enrichedOrders = await Promise.all(

      ordersData.orders.map(async (order) => {

        /*
        CUSTOMER INFO
        */
        if (order.customer_id) {

          try {

            const custRes = await fetch(
              `https://connect.squareup.com/v2/customers/${order.customer_id}`,
              {
                headers: {
                  "Square-Version": "2024-12-18",
                  Authorization: `Bearer ${access_token}`
                }
              }
            );

            const custData = await custRes.json();

            order.customer = custData.customer;

          } catch (err) {
            console.error("Customer fetch error", err);
          }
        }

        /*
        ITEM INFO
        */
        if (order.line_items) {

          await Promise.all(
            order.line_items.map(async (item) => {

              if (!item.catalog_object_id) return;

              try {

                const catRes = await fetch(
                  `https://connect.squareup.com/v2/catalog/object/${item.catalog_object_id}?include_related_objects=true`,
                  {
                    headers: {
                      "Square-Version": "2024-12-18",
                      Authorization: `Bearer ${access_token}`
                    }
                  }
                );

                const catData = await catRes.json();

                const itemObj =
                  catData.related_objects?.find(
                    obj => obj.type === "ITEM"
                  );

                item.product_type =
                  itemObj?.item_data?.product_type ||
                  "REGULAR";

              } catch (err) {
                console.error("Catalog fetch error", err);
              }

            })
          );
        }

        return order;

      })
    );

    res.json({ orders: enrichedOrders });

  } catch (err) {

    console.error("Orders endpoint error:", err);

    res.status(500).json({
      error: err.message
    });

  }

});


/*
------------------------------------------------
MERCHANT INFO
------------------------------------------------
*/
app.get("/api/merchant", (req, res) => {

  const merchantId = req.query.merchant_id;

  if (!merchantId || !accessTokenStore[merchantId]) {
    return res.status(401).json({
      error: "Not authenticated"
    });
  }

  res.json({
    merchant_name:
      accessTokenStore[merchantId].merchant_name ||
      "User",
    merchant_id: merchantId
  });

});


/*
------------------------------------------------
START SERVER
------------------------------------------------
*/
app.listen(PORT, () => {
  console.log(`The server is now running.`);
  exec(`start http://localhost:${PORT}`);
});
