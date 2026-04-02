const Jimp = require("jimp"); // this package is used to read the image and convert it to buffer, then we can send that buffer to ml server for severity prediction.

async function calculateSeverity(filePath) {
  const image = await Jimp.read(filePath);
  image.resize(160, 160); // match model input size

  let infectedPixels = 0;
  const totalPixels = image.bitmap.width * image.bitmap.height;

  // Loop over all pixels
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
    const r = image.bitmap.data[idx + 0];
    const g = image.bitmap.data[idx + 1];
    const b = image.bitmap.data[idx + 2];

    // Example: simple rule for "diseased" pixel (brownish/yellowish)
    if (r > 100 && g < 100 && b < 50) {
      infectedPixels++;
    }
  });

  const percentage = (infectedPixels / totalPixels) * 100;

  // Assign severity
  if (percentage < 30) return "Mild";
  if (percentage < 70) return "Moderate";
  return "Severe";
}

module.exports = { calculateSeverity };