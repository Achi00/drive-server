require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
const cors = require("cors");
const morgan = require("morgan");
const passportSetup = require("./config/passport-setup");
const authRoutes = require("./routes/authRoutes");
const logoutRoutes = require("./routes/logoutRoutes");
const fileRoutes = require("./routes/fileRoutes");

const app = express();

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "https://drive-server-dksb.onrender.com"],
    credentials: true, // important for sessions to work across different domains
  })
);

app.use(express.json());
app.use(morgan("tiny"));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      secure: true, // Set to true in production if using HTTPS
      httpOnly: true,
      domain: ".onrender.com",
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: "None",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  console.log("Cookies:", req.cookies);
  next();
});

app.use("/auth", authRoutes);
app.use("/logout", logoutRoutes);
app.use("/v1/files", fileRoutes);

// Test endpoint to check session data
app.get("/test-session", (req, res) => {
  console.log("Session data on /test-session:", req.session);
  console.log("Session cookie:", req.cookies["connect.sid"]);
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ message: "You are not authenticated" });
  }
});

app.get("/api/session", (req, res) => {
  console.log("Session data:", req.session);
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ message: "You are not authenticated" });
  }
});

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define routes
app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Start the server
const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
