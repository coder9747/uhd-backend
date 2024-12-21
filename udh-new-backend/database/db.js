import mongoose from "mongoose";

const connectDb = async () => {
    try {

        await mongoose.connect(`${process.env.MONGO_URI}`, { dbName: "uhd" });
        console.log("Database Connect Succesfully");

    } catch (error) {
        console.error("Error Connecting To Database ", error);
    }
};

export default connectDb;