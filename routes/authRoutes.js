const router = require("express").Router();
const passport = require("passport");

router.get(
  "/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
  }),
  (req, res) => {
    if (req.user) {
      // Save more data to session
      req.session.user = {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        picture: req.user.picture,
      };
      console.log("User authenticated and session set:", req.session.user);
      // Redirect to the client-side application
      res.redirect("http://localhost:3000/dashboard");
    } else {
      console.log("User not authenticated");
      res.redirect("/login");
    }
  }
);

router.post("/logout", (req, res) => {
  req.logout();
  res.json({ message: "Logged out successfully" });
});

module.exports = router;
