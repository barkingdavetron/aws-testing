require('dotenv').config(); // Load environment variables
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const Tesseract = require("tesseract.js");
const AWS = require("aws-sdk");
const sharp = require("sharp");
const axios = require("axios");

const app = express();
const saltRounds = 10;
const SECRET_KEY = process.env.SECRET_KEY || "fallback_secret";

const rekognition = new AWS.Rekognition({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "eu-west-1",
});

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: "Token missing" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(401).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

// DB SETUP
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error("Database error:", err.message);
  else {
    console.log("Connected to SQLite DB");
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      score INTEGER DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity TEXT NOT NULL,
      expiry TEXT,
      user_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS calories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      food TEXT NOT NULL,
      calories INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS shopping_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      quantity TEXT NOT NULL,
      user_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
  }
});

// Routes
app.get("/", (req, res) => res.json({ message: "Server is running" }));

app.post("/register", (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "Please fill all fields" });

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, existingUser) => {
    if (existingUser) return res.status(400).json({ error: "Email already registered" });

    bcrypt.hash(password, saltRounds, (err, hash) => {
      if (err) return res.status(500).json({ error: "Error hashing password" });

      db.run("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [username, email, hash], function (err) {
        if (err) return res.status(500).json({ error: "Registration failed" });
        res.json({ message: "User registered", userId: this.lastID });
      });
    });
  });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Please fill all fields" });

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Invalid credentials" });

    bcrypt.compare(password, user.password_hash, (err, match) => {
      if (!match) return res.status(401).json({ error: "Invalid credentials" });

      const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, SECRET_KEY, { expiresIn: "1h" });
      res.json({ id: user.id, email: user.email, username: user.username, token });
    });
  });
});

app.post("/ingredients", authenticateToken, (req, res) => {
  const { name, quantity, expiry } = req.body;
  const userId = req.user.id;

  if (!name || !quantity)
    return res.status(400).json({ error: "Missing fields" });

  db.run("INSERT INTO ingredients (name, quantity, expiry, user_id) VALUES (?, ?, ?, ?)", [name, quantity, expiry, userId], function (err) {
    if (err) return res.status(500).json({ error: "Failed to add ingredient" });
    res.json({ message: "Ingredient added", ingredientId: this.lastID });
  });
});

app.get("/getIngredients", authenticateToken, (req, res) => {
  const userId = req.user.id;
  db.all("SELECT * FROM ingredients WHERE user_id = ?", [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch ingredients" });
    res.json({ ingredients: rows });
  });
});

app.post("/calories", authenticateToken, (req, res) => {
  const { food, calories } = req.body;
  const userId = req.user.id;
  if (!food || !calories) return res.status(400).json({ error: "Food and calories are required." });

  db.run("INSERT INTO calories (food, calories, user_id) VALUES (?, ?, ?)", [food, calories, userId], function (err) {
    if (err) return res.status(500).json({ error: "Failed to log calories." });
    res.json({ message: "Calories logged.", entryId: this.lastID });
  });
});

app.get("/calories", authenticateToken, (req, res) => {
  const userId = req.user.id;
  db.all("SELECT * FROM calories WHERE user_id = ? ORDER BY created_at DESC", [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch data." });
    res.json({ entries: rows });
  });
});

const upload = multer({ dest: "uploads/" });

app.post("/scan-expiry", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  const filePath = req.file.path;

  try {
    const { data } = await Tesseract.recognize(filePath, "eng");
    const ocrText = data.text;
    const dateRegex = /(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4}|\d{2}[-/]\d{2}[-/]\d{2}|\b\d{1,2}[-/]\d{1,2}\b)/;
    const matchedDate = ocrText.match(dateRegex);
    const extractedDate = matchedDate ? matchedDate[0] : "No expiry date found";

    const buffer = await sharp(filePath).resize({ width: 800 }).toBuffer();
    const rekogParams = {
      Image: { Bytes: buffer },
      MaxLabels: 10,
      MinConfidence: 85,
    };

    const rekogResult = await rekognition.detectLabels(rekogParams).promise();
    const foodLabels = rekogResult.Labels?.filter(label =>
      label.Parents?.some(parent => parent.Name === "Food")
    ).map(label => label.Name) || [];

    res.json({ text: ocrText, expiryDate: extractedDate, labels: foodLabels });
  } catch (error) {
    res.status(500).json({ error: "Failed to process image" });
  } finally {
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      console.warn("Failed to delete temp file:", err);
    }
  }
});

app.get("/shopping-list", authenticateToken, (req, res) => {
  const userId = req.user.id;
  db.all("SELECT * FROM shopping_list WHERE user_id = ?", [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to load shopping list" });
    res.json({ items: rows });
  });
});

app.post("/shopping-list", authenticateToken, (req, res) => {
  const { name, quantity } = req.body;
  const userId = req.user.id;
  if (!name || !quantity) return res.status(400).json({ error: "Missing fields" });

  db.run("INSERT INTO shopping_list (name, quantity, user_id) VALUES (?, ?, ?)", [name, quantity, userId], function (err) {
    if (err) return res.status(500).json({ error: "Failed to add item" });
    res.json({ message: "Item added", itemId: this.lastID });
  });
});

app.delete("/shopping-list/:id", authenticateToken, (req, res) => {
  const itemId = req.params.id;
  const userId = req.user.id;
  db.run("DELETE FROM shopping_list WHERE id = ? AND user_id = ?", [itemId, userId], function (err) {
    if (err) return res.status(500).json({ error: "Failed to delete item" });
    res.json({ message: "Item deleted" });
  });
});

app.get("/leaderboard", (req, res) => {
  db.all("SELECT username, score AS points FROM users ORDER BY score DESC LIMIT 5", [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to retrieve leaderboard" });
    res.json({ leaderboard: rows });
  });
});

app.get("/ingredients-list", authenticateToken, (req, res) => {
  const userId = req.user.id;
  db.all("SELECT name FROM ingredients WHERE user_id = ?", [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch ingredients" });
    const ingredientList = rows.map(r => r.name).join(",");
    res.json({ ingredients: ingredientList });
  });
});

app.get("/recipes", async (req, res) => {
  const query = req.query.query;
  if (!query) return res.status(400).json({ error: "Missing query" });

  try {
    const response = await axios.get("https://api.spoonacular.com/recipes/complexSearch", {
      params: {
        query,
        number: 10,
        apiKey: process.env.SPOONACULAR_API_KEY,
      },
    });
    const recipes = response.data.results;
    res.json({ recipes });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

module.exports = { app, db };

