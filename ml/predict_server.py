from flask import Flask, request, jsonify
import tensorflow as tf
from tensorflow.keras.preprocessing import image
import numpy as np
from io import BytesIO
import os

app = Flask(__name__)

# Load trained model
model = tf.keras.models.load_model("model.h5")

# Define image size (must match training)
IMG_SIZE = 160

# Get class labels
DATASET_PATH = "dataset"

class_labels = sorted(os.listdir(DATASET_PATH))

@app.route("/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"})

    file = request.files["image"]

    # Convert file to BytesIO
    img = image.load_img(BytesIO(file.read()), target_size=(IMG_SIZE, IMG_SIZE))
    img_array = image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0)
    img_array = img_array / 255.0

    prediction = model.predict(img_array)
    predicted_class = np.argmax(prediction)
    confidence = float(np.max(prediction))

    predicted_label = class_labels[predicted_class]

    return jsonify({
        "disease": predicted_label,
        "confidence": round(confidence * 100, 2)
    })

if __name__ == "__main__":
    app.run(port=5000)