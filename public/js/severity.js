const Jimp = require("jimp"); // this package is used to read the image and main perpose is to calculate the severity of the disease in the leaf by counting the number of infected pixels and comparing it to the total number of pixels in the image. The function takes the file path of the image as input, resizes it to match the (model) input size, and then loops over all pixels to count how many are classified as "diseased" based on a simple color threshold. Finally, it calculates the percentage of infected pixels and assigns a severity level (Mild, Moderate, Severe) based on that percentage.

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