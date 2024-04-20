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
  if (!supportedTypes.includes(file.mimetype)) {
    // Add to file validation error if unsupported
    if (!req.fileValidationError) {
      req.fileValidationError = [];
    }
    req.fileValidationError.push(
      file.originalname + " rejected due to unsupported file type"
    );
    cb(null, false); // Reject unsupported files
  } else {
    cb(null, true); // Accept supported files
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // for example, 10 MB limit
}).array("files", 5);

const isAuthenticated = (req, res, next) => {
  // console.log("Session data:", req.session); // Log session data
  // console.log("User data:", req.user); // Log user data

  if (!req.user) {
    return res.status(401).send("User not authenticated");
  }
  next();
};

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

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
  (req, res, next) => {
    upload(req, res, function (error) {
      if (
        error instanceof multer.MulterError &&
        error.code === "LIMIT_UNEXPECTED_FILE"
      ) {
        return res.status(400).json({
          message: "Error: Too many files. Maximum 5 files allowed.",
        });
      } else if (error) {
        return res.status(500).send(error.message);
      }
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          message: "No files were provided for upload.",
        });
      }
      if (req.fileValidationError) {
        req.rejectedFiles = req.fileValidationError;
      }
      next(); // Continue to process valid files if any
    });
  },
  async (req, res) => {
    const results = {
      uploaded: [],
      rejected: req.rejectedFiles || [],
      duplicates: [],
      totalStorageUsed: 0, // Initialize the storage used counter
    };

    const fileNames = new Set();
    const duplicateTracker = {};

    // Identify and save files while checking for duplicates
    await Promise.all(
      req.files.map(async (file) => {
        if (duplicateTracker[file.originalname]) {
          if (!results.duplicates.includes(file.originalname)) {
            results.duplicates.push(file.originalname); // Record only once
          }
        } else {
          fileNames.add(file.originalname);
          duplicateTracker[file.originalname] = true; // Mark as having duplicates

          const newFile = new File({
            user: req.user._id,
            name: file.originalname,
            size: file.size,
            fileType: file.mimetype,
            path: file.path,
            createdAt: new Date(),
          });
          await newFile.save();
          results.uploaded.push(file.originalname);
          results.totalStorageUsed += file.size; // Accumulate the file size
        }
      })
    );

    const formattedStorage = formatBytes(results.totalStorageUsed);

    // Decide the response based on the presence of duplicates, rejections, or successful uploads
    if (results.duplicates.length > 0 || results.rejected.length > 0) {
      res.status(207).json({
        message: "File upload completed with some issues.",
        uploaded: results.uploaded,
        rejected: results.rejected,
        duplicates: results.duplicates,
        totalStorageUsed: formattedStorage,
      });
    } else if (results.uploaded.length > 0) {
      res.status(201).json({
        message: "All files uploaded successfully",
        uploaded: results.uploaded,
        totalStorageUsed: formattedStorage,
      });
    } else {
      res.status(400).json({
        message: "No valid files were uploaded.",
        rejected: results.rejected,
      });
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
