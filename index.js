require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const bodyParser = require("body-parser");
const passport = require("passport");
const session = require("express-session");
const cors = require("cors");
const morgan = require("morgan");
const passportSetup = require("./config/passport-setup");
const authRoutes = require("./routes/authRoutes");
const logoutRoutes = require("./routes/logoutRoutes");
const fileRoutes = require("./routes/fileRoutes");

const app = express();

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true, // Ensure cookies are only sent over HTTPS
      httpOnly: true,
      sameSite: "none", // Allow cross-site cookies
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000", // Local frontend
      "https://wordcrafter.io", // Custom frontend domain
      "https://api.wordcrafter.io", // Custom backend domain
    ],
    credentials: true, // important for sessions to work across different domains
  })
);

app.use(express.json());
app.use(morgan("tiny"));

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

app.use("/auth", authRoutes);
app.use("/logout", logoutRoutes);
// file upload
app.use("/v1/files", fileRoutes);

app.get("/api/session", (req, res) => {
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
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
