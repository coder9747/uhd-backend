import express from "express";
import cors from "cors";
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import { pipeline } from "stream";
import util from "util";
import connectDb from "./database/db.js";
import VideoInfoModel from "./Model/VideoInfoModel.js";

dotenv.config();


const app = express();
const port = process.env.PORT || 10000;


// Middleware
app.use(cors({
    origin: '*',
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

dotenv.config();

// AWS S3 Configuration
const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Multer-S3 configuration for temporary storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Initialize Multipart Upload
app.post("/start-upload", async (req, res) => {
    try {
        const { fileName, fileType } = req.body;
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: fileName,
            ContentType: fileType,
        };

        const command = new CreateMultipartUploadCommand(params);
        const response = await s3.send(command);

        return res.status(200).json({
            success: true,
            uploadId: response.UploadId,
            fileKey: fileName,
        });
    } catch (err) {
        console.error("Error starting multipart upload:", err);
        res.status(500).json({ success: false, error: "Failed to start upload" });
    }
});

// Handle Chunk Uploads
app.post("/upload-chunk", upload.single("chunk"), async (req, res) => {
    const { uploadId, fileKey, chunkIndex } = req.body;

    // Log the chunk size to ensure it's not empty
    console.log(`Chunk ${chunkIndex}:`, req.file ? req.file.size : 'No file received');

    if (!req.file || req.file.size === 0) {
        return res.status(400).json({
            success: false,
            error: "Empty chunk received",
        });
    }
    console.log(req.file);
    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: fileKey,
            PartNumber: parseInt(chunkIndex, 10) + 1,
            UploadId: uploadId,
            Body: req.file.buffer,
        };

        console.log(params);

        const command = new UploadPartCommand(params);
        const response = await s3.send(command);

        console.log(`Chunk ${chunkIndex} upload response:`, response);

        return res.status(200).json({
            success: true,
            ETag: response.ETag,
        });
    } catch (err) {
        console.error("Error uploading chunk:", err);
        res.status(500).json({ success: false, error: "Failed to upload chunk" });
    }
});


// Complete Multipart Upload
app.post("/complete-upload", async (req, res) => {
    const { uploadId, fileKey, parts,fileName } = req.body;

    console.log(req.body);

    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: fileKey,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
        };

        const command = new CompleteMultipartUploadCommand(params);
        const response = await s3.send(command);

        const newVideo = await VideoInfoModel.create({
            key: fileKey,
            location: response.Location,
            originalName: fileName,
            contentType: '',
        });

        return res.status(200).json({
            success: true,
            location: response.Location,
        });
    } catch (err) {
        console.error("Error completing multipart upload:", err);
        res.status(500).json({ success: false, error: "Failed to complete upload" });
    }
});



// Stream Video from S3
app.get("/stream/:id", async (req, res) => {
    const { id } = req.params;



    try {
        const document = await VideoInfoModel.findById(id);
        if (!document) return res.status(404).json({
            success: false,
            message: "Video not found",
        });
        const key = document.key;
        console.log("Key :", key);

        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
        };
        console.log(`Stream request received for key: ${key}`);

        // Fetch metadata to determine video size
        const headObjectCommand = new HeadObjectCommand(params);
        const head = await s3.send(headObjectCommand);

        const range = req.headers.range;

        if (!range) {
            return res.status(400).send("Range header is required");
        }

        const videoSize = head.ContentLength;
        const CHUNK_SIZE = 20 * 1024 * 1024;
        const start = Number(range.replace(/\D/g, ""));
        const end = Math.min(start + CHUNK_SIZE - 1, videoSize - 1);

        const contentLength = end - start + 1;

        // Send the headers before the video stream
        res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${videoSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": contentLength,
            "Content-Type": head.ContentType,
        });

        // Fetch the video chunk
        const streamParams = {
            ...params,
            Range: `bytes=${start}-${end}`,
        };

        const getObjectCommand = new GetObjectCommand(streamParams);
        const videoStream = await s3.send(getObjectCommand);

        // Pipe the video stream directly to the response
        videoStream.Body.pipe(res);

    } catch (error) {
        console.error("Error streaming video:", error);
        res.status(500).send("Failed to stream video");
    }
});



app.get("/get-all-videos", async (req, res) => {
    try {
        const { name } = req.query;

        const query = name
            ? { originalName: { $regex: name, $options: "i" } }
            : {};

        const allVideos = await VideoInfoModel.find(query);

        return res.status(200).json({
            success: true,
            message: "All Data Fetched Successfully",
            data: allVideos,
        });
    } catch (error) {
        console.error("Error fetching videos:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
        });
    }
});


// Health Check Endpoint
app.get("/", (req, res) => {
    res.status(200).send("Server is up and running!");
});



connectDb().then(() => {
    app.listen(port, () => {
        console.log(`Server Running AT Port ${port}`);
    });
}).catch(() => {
    console.error("Error While Connecting");
    process.exit(1);
})

// Start Server
