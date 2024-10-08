require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { Pool } = require("pg");
const { verifyMessage } = require("ethers");

const app = express();
app.use(cors());
const PORT = 3003;

// Middleware to parse JSON bodies
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
});

// Function to verify the message
const isMessageValid = async ({ message, address, signature }) => {
  try {
    const signerAddr = await verifyMessage(message, signature);
    return signerAddr.toLowerCase() === address.toLowerCase();
  } catch (err) {
    console.error("Verification error:", err);
    return false;
  }
};

const panelRoutes = require("./routes/panel")(pool);
app.use("/panel", panelRoutes);

// Endpoint to handle the POST request from agent.sh
app.post("/checkin", async (req, res) => {
  const client = await pool.connect(); // Get a client from the pool
  try {
    // Start a transaction
    await client.query("BEGIN");

    const { key: signature, timestamp, address, peer_count } = req.body;

    if (!signature || !timestamp || !address || !peer_count) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Concatenate the address and timestamp to form the message
    const message = `${address}${timestamp}`;

    // Verify the signature
    const isValid = await isMessageValid({ message, address, signature });

    if (!isValid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Insert the check-in data into the validator_checkin table
    await client.query(
      "INSERT INTO validator_checkin (address, timestamp, peer_count) VALUES ($1, $2, $3)",
      [address.toLowerCase(), timestamp, peer_count]
    );

    // Commit the transaction
    await client.query("COMMIT");

    res.status(200).json({ status: "ok" });
  } catch (err) {
    await client.query("ROLLBACK"); // Rollback the transaction on error

    console.error("Error processing check-in:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release(); // Release the client back to the pool
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
