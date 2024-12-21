import mongoose from "mongoose";

const VideoInfoSchema = new mongoose.Schema({
    key: { type: String, required: true },
    location: { type: String, required: true },
    contentType: { type: String, },
    size: { type: Number, },
    originalName: { type: String },
}, { timestamps: true });

export default mongoose.model("video_info", VideoInfoSchema);
