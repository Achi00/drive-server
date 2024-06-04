require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const bodyParser = require("body-parser");
const passport = require("passport");
const session = require("express-session");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet"); // Ensure helmet is required
const passportSetup = require("./config/passport-setup");
const authRoutes = require("./routes/authRoutes");
const logoutRoutes = require("./routes/logoutRoutes");
const fileRoutes = require("./routes/fileRoutes");
const MongoDBStore = require("connect-mongodb-session")(session);

const app = express();

// Middleware
app.use(helmet());
app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: ["http://localhost:3000", "https://your-deployed-url.com"],
    methods: "GET,POST,PUT,DELETE",
    credentials: true,
  })
);

// Session store
const store = new MongoDBStore({
  uri: process.env.MONGODB_URI,
  collection: "sessions",
});

store.on("error", function (error) {
  console.error(error);
});

app.set("trust proxy", 1); // Trust the first proxy

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: store,
    proxy: true,
    cookie: {
      secure: process.env.NODE_ENV === "production", // Set to true if using HTTPS
      httpOnly: true,
      sameSite: "none", // Required for cross-site cookies
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Logging middleware
app.use(morgan("tiny"));

// Body parser middleware
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

app.use((req, res, next) => {
  console.log("Session:", req.session);
  console.log("User:", req.user);
  next();
});

// Routes
app.use("/auth", authRoutes);
app.use("/logout", logoutRoutes);
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
