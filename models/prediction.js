const mongoose = require("mongoose");

const predictionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    crop: { 
        type: String, default: "Unknown" 
    },
    disease: { 
        type: String, required: true 
    },
    confidence: { 
        type: Number, required: true 
    },
    imageUrl: { 
        type: String 
    },
  },
  { 
    timestamps: true 
    // automatically adds the field of "createdAt" in  table
    // it is option in mongoose so it is outside the main schema.
  }
)

module.exports = mongoose.model("Prediction", predictionSchema);