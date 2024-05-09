const router = require("express").Router();
const passport = require("passport");

// auth login

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

// authRoute.js

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
  }),
  (req, res) => {
    if (req.user) {
      // Save more data to session if needed
      req.session.user = {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        picture: req.user.picture,
      };
      // Redirect to the client-side application
      res.redirect("http://localhost:3000/dashboard");
    } else {
      res.redirect("/login");
    }
  }
);

router.post("/logout", (req, res) => {
  req.logout();
  res.json({ message: "Logged out successfully" });
});

module.exports = router;
