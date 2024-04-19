const express = require("express");
const multer = require("multer");
const File = require("../models/File");
const path = require("path");
const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Correct path to the uploads folder
    const uploadPath = path.resolve(__dirname, "../uploads/");
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const filename =
      file.fieldname + "-" + Date.now() + "-" + file.originalname;
    cb(null, filename);
  },
});

// Define the file filter to check supported types
const fileFilter = (req, file, cb) => {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "text/plain",
  ];
  if (supportedTypes.includes(file.mimetype)) {
    cb(null, true); // Accept file
  } else {
    req.fileValidationError = "Unsupported file type!"; // Set error message on the request
    cb(null, false); // Reject file silently
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // for example, 10 MB limit
});

const isAuthenticated = (req, res, next) => {
  console.log("Session data:", req.session); // Log session data
  console.log("User data:", req.user); // Log user data

  if (!req.user) {
    return res.status(401).send("User not authenticated");
  }
  next();
};

// List all files
router.get("/files", isAuthenticated, async (req, res) => {
  try {
    const files = await File.find({ user: req.user._id });
    res.json(files);
  } catch (error) {
    res.status(500).send("Failed to retrieve files.");
  }
});

// Upload a file route
router.post(
  "/upload",
  isAuthenticated,
  upload.single("file"),
  async (req, res) => {
    if (!req.user) {
      return res.status(401).send("User not authenticated");
    }

    // Check if the file was rejected by the file filter
    if (req.fileValidationError) {
      return res.status(400).send(req.fileValidationError);
    }

    // Check if the file was not uploaded
    if (!req.file) {
      return res.status(400).send("No file was uploaded.");
    }

    // Proceed if the file was accepted
    const newFile = new File({
      user: req.user._id,
      name: req.file.originalname,
      size: req.file.size,
      fileType: req.file.mimetype,
      path: req.file.path,
      createdAt: new Date(),
    });

    try {
      await newFile.save();
      res.status(201).send("File uploaded successfully");
    } catch (error) {
      res.status(400).send("Failed to upload file: " + error.message);
    }
  }
);

// Download a file
router.get("/download/:fileId", async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    res.download(file.path);
  } catch (error) {
    res.status(500).send("Error downloading file: " + error.message);
  }
});

// Delete a file
router.delete("/:fileId", async (req, res) => {
  try {
    await File.findByIdAndDelete(req.params.fileId);
    res.status(200).send("File deleted successfully");
  } catch (error) {
    res.status(500).send("Error deleting file: " + error.message);
  }
});

module.exports = router;
