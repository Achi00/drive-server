const express = require("express");
const multer = require("multer");
const File = require("../models/File");
const User = require("../models/User");
const path = require("path");
const router = express.Router();
const { Storage } = require("@google-cloud/storage");

const storage = new Storage({
  keyFilename: path.join(__dirname, "../gcloud.json"),
});
const bucketName = "drive-app";
const bucket = storage.bucket(bucketName);

const gcsStorage = multer.memoryStorage();

// Define the file filter to check supported types
const fileFilter = (req, file, cb) => {
  console.log("Checking file type:", file.mimetype); // Debugging log
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "text/plain",
  ];
  if (!supportedTypes.includes(file.mimetype)) {
    req.fileValidationError = req.fileValidationError || [];
    req.fileValidationError.push(
      file.originalname + " rejected due to unsupported file type"
    );
    cb(null, false); // Reject unsupported files
  } else {
    cb(null, true); // Accept supported files
  }
};

const upload = multer({
  storage: gcsStorage,
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

router.get("/files/:id", isAuthenticated, async (req, res) => {
  try {
    const parentId = req.params.id;
    const files = await File.find({ user: req.user._id, parent: parentId });
    res.json(files);
  } catch (error) {
    res.status(500).send("Failed to retrieve files.");
  }
});

// Upload a file route
router.post(
  "/upload",
  isAuthenticated,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      console.log("User before upload:", user); // Debugging log

      // Set default value for storageLimit if it is not defined
      user.storageLimit = user.storageLimit || 1024 * 1024 * 1024; // Default to 1GB

      console.log("User after setting default values:", user); // Debugging log

      // Proceed with Multer upload inside this block
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

        const rejectedFiles = req.fileValidationError || [];
        if (
          (!req.files || req.files.length === 0) &&
          rejectedFiles.length === 0
        ) {
          return res.status(400).json({
            message: "No files were provided for upload.",
          });
        }

        console.log("Uploaded files:", req.files); // Debugging log
        console.log("Rejected files:", rejectedFiles); // Debugging log

        // Calculate new potential storage total
        const totalSizeOfNewFiles = (req.files || []).reduce(
          (acc, file) => acc + file.size,
          0
        );
        const newStorageTotal = user.totalStorageUsed + totalSizeOfNewFiles;

        console.log("Total size of new files:", totalSizeOfNewFiles); // Debugging log
        console.log("New storage total:", newStorageTotal); // Debugging log

        if (newStorageTotal > user.storageLimit) {
          return res.status(400).json({
            message: "Storage limit exceeded. Unable to upload more files.",
          });
        }

        req.rejectedFiles = rejectedFiles;
        next(); // Proceed if there are files and no critical upload errors
      });
    } catch (error) {
      console.error("Error during file upload:", error);
      return res.status(500).send("Server error while checking user storage.");
    }
  },
  async (req, res) => {
    const results = {
      uploaded: [],
      rejected: req.rejectedFiles || [],
      duplicates: [],
      totalStorageUsed: 0,
      location: null,
    };

    const fileNames = new Set(); // Track file names in the current batch for duplicate detection
    const uploads = (req.files || []).map((file) => {
      if (fileNames.has(file.originalname)) {
        results.duplicates.push(file.originalname);
        return Promise.resolve(); // Skip upload but resolve the promise
      }
      fileNames.add(file.originalname);

      const blob = bucket.file(file.originalname);
      const blobStream = blob.createWriteStream({
        resumable: false,
      });

      return new Promise((resolve, reject) => {
        blobStream.on("error", (err) => reject(err));
        blobStream.on("finish", async () => {
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
          const newFile = new File({
            user: req.user._id,
            name: file.originalname,
            size: file.size,
            fileType: file.mimetype,
            path: publicUrl,
            parent: req.body.parent || undefined,
            createdAt: new Date(),
          });
          await newFile.save();
          results.uploaded.push(file.originalname);
          results.totalStorageUsed += file.size;
          resolve();
        });
        blobStream.end(file.buffer);
      });
    });

    try {
      await Promise.all(uploads);
    } catch (error) {
      return res.status(500).send("Error uploading files: " + error.message);
    }

    console.log("Upload results:", results); // Debugging log

    // Update the user's storage usage in the database
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $inc: { totalStorageUsed: results.totalStorageUsed },
      },
      { new: true }
    );

    // Retrieve the parent folder name if a parent ID is provided
    if (req.body.parent) {
      try {
        const parentFolder = await File.findById(req.body.parent);
        if (parentFolder && parentFolder.type === "folder") {
          results.location = parentFolder.name;
        }
      } catch (error) {
        console.error("Error retrieving parent folder:", error);
      }
    }

    console.log("Updated user:", updatedUser); // Debugging log

    const formattedStorage = formatBytes(updatedUser.totalStorageUsed);
    const availableStorage = Math.max(
      updatedUser.storageLimit - updatedUser.totalStorageUsed,
      0
    );
    const formattedAvailableStorage = formatBytes(availableStorage);

    console.log("Formatted storage:", formattedStorage); // Debugging log
    console.log("Available storage:", availableStorage); // Debugging log
    console.log("Formatted available storage:", formattedAvailableStorage); // Debugging log

    if (
      results.uploaded.length > 0 ||
      results.rejected.length > 0 ||
      results.duplicates.length > 0
    ) {
      res.status(207).json({
        message: "File upload completed with some issues.",
        uploaded: results.uploaded,
        rejected: results.rejected,
        duplicates: results.duplicates,
        location: results.location,
        totalStorageUsed: formattedStorage,
        availableStorage: formattedAvailableStorage,
      });
    } else {
      res.status(201).json({
        message: "All files uploaded successfully",
        uploaded: results.uploaded,
        location: results.location,
        totalStorageUsed: formattedStorage,
        availableStorage: formattedAvailableStorage,
      });
    }
  }
);

router.post("/folders", isAuthenticated, async (req, res) => {
  try {
    const { name, parent } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }
    const newFolder = new File({
      user: req.user._id,
      name,
      parent: parent || undefined,
      type: "folder",
    });
    await newFolder.save();
    res.status(201).json(newFolder);
  } catch (error) {
    res.status(500).send("Error creating folder: " + error.message);
  }
});

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
