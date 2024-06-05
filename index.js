require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const passport = require("passport");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const passportSetup = require("./config/passport-setup");
const authRoutes = require("./routes/authRoutes");
const logoutRoutes = require("./routes/logoutRoutes");
const fileRoutes = require("./routes/fileRoutes");

const app = express();

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "https://api.wordcrafter.io"],
    credentials: true,
  })
);

app.use(express.json());
app.use(morgan("tiny"));
app.use(cookieParser());

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      domain: ".wordcrafter.io",
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: "none",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  console.log("Cookies middleware:", req.cookies);
  next();
});

app.use("/auth", authRoutes);
app.use("/logout", logoutRoutes);
app.use("/v1/files", fileRoutes);

app.get("/api/session", (req, res) => {
  console.log("Session data:", req.session);
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ message: "You are not authenticated" });
  }
});

app.get("/test-session", (req, res) => {
  console.log("Session data on /test-session:", req.session);
  console.log("Session cookie:", req.cookies["connect.sid"]);
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
