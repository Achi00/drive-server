// routes/authRoutes.js

const router = require("express").Router();
const passport = require("passport");

// auth login

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
  }),
  (req, res) => {
    if (req.user) {
      req.session.userId = req.user._id; // Store the user ID in the session
    }
    res.redirect("/"); // Or redirect to a dashboard or other appropriate page
  }
);

module.exports = router;
