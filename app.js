// start command - npm start

require('dotenv').config();

const express = require("express");
const app = express();
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const mongoose = require("mongoose");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const multer = require("multer");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const FormData = require("form-data");
const fs = require("fs");
const axios = require("axios");
const Prediction = require("./models/prediction");

const { calculateSeverity } = require("./public/js/severity"); // import the severity calculation function


// _______________________________________________________________________________
// if we are using render then predict-disease route will use render ml server,
// and if we are running the website locally then predict-disease route will use local ml server -> http://127.0.0.1:5000

// When your app runs on Render, Render automatically sets some environment variables inside the server.
// It sets,
// RENDER = true
// and
// 🖥 On your local machine:
// process.env.RENDER = undefined

const isRender = !!process.env.RENDER;
const ML_URL = isRender
  ? "https://smart-crop-disease-detection-ml-server.onrender.com"
  : "http://127.0.0.1:5000";

// console.log("isRender:", isRender);

// ________________________________________________________________________________
// this is used to make the uploads section to store the image then render can use it for detecting disease.
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
// ___________________________________________________________________________________

//authentication
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user.js");
const { runInNewContext } = require('vm');

// ____________________________________________________________________
//Atlas DB URL
const dbUrl = process.env.MONGO_URL;
console.log("DB URL:", dbUrl);

main()
 .then(()=>{
    console.log("connected to DB");
 })
 .catch((err)=>{
    console.log(err)
 })

 async function main(){
    await mongoose.connect(dbUrl);
 }
  
// ________________________________________________________________________________

app.set("views",path.join(__dirname,"views"));
app.set("view engine","ejs");

app.use(express.json()); 
app.use(express.urlencoded({extended:true}));
app.use(methodOverride("_method"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.engine("ejs",ejsMate);//boilderplating.
app.use(express.static(path.join(__dirname,"/public")));
app.use(express.static("public"));
// ____________________________________________________________________________

const store = MongoStore.create({
    mongoUrl : dbUrl,
    // crypto: {
    //     secret: process.env.SECRET,
    // },
    collectionName: "sessions",
    touchAfter: 24 * 3600,
});

store.on("error", (err)=>{
    console.log('error in mongo session store', err);
});

const sessionOptions = {
    store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,

    cookie:{
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly:true,
    },
};

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req,res,next)=>{
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  next();
})
// _________________________________________________________________________________________________

app.get("/", (req,res)=>{
    console.log("root");
    res.render("index");
})

app.get("/signup", (req, res)=>{
    res.render("users/sign-up");
})

app.post("/signup",async (req,res)=>{
  try{
    let {username, email, password} = req.body;
    const newUser = new User({email, username});
    const registeredUser = await User.register(newUser, password);
    console.log(registeredUser);
    req.login(registeredUser, (err)=>{
      console.log("Inside login callback");
      if(err){
        console.log(err);
        return res.redirect("/signup");
      }
      req.flash("success", "user was registered");
      res.redirect("/home");
    })
  }catch(e){
    req.flash("error",e.message);
    res.redirect("/signup");
  }
})

app.get("/login", (req, res)=>{
    res.render("users/login");
})

app.post(
  "/login",
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  async (req, res) => {
    try {
      // Update last login in the User model
      req.user.lastLogin = new Date();
      await req.user.save(); // save to MongoDB

      req.flash("success", "Welcome back!");
      res.redirect("/home");
    } catch (err) {
      console.error("Failed to update last login:", err);
      res.redirect("/home");
    }
  }
);

app.get("/logout", (req,res)=>{
  req.logout((err)=>{
    if(err){
      console.log("err");
    }
    req.flash("success","you are logged out!");
    res.redirect("/");
  })
})

// -___________________________________________________________________________________________________________________

// multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

app.post("/upload", upload.single("image"), (req, res) => {
  res.json({
    message: "Image uploaded successfully",
    file: req.file,
  });
});
// _____________________________________________________________________________________________________


app.post("/predict", (req, res) => {

  console.log("BODY:", req.body);

  if (!req.body?.cropType) {
    return res.status(400).json({ error: "cropType is required" });
  }

  const cropType = req.body.cropType;

  res.json({
    crop: cropType,
    disease: "Leaf Blight",
    severity: "Moderate",
    recommendation: "Use fungicide spray"
  });
});

app.post("/test", (req, res) => {
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  res.json({ received: req.body });
});

app.get("/home", async (req, res) => {
  try {
    const user = req.user; // logged-in farmer

    // Fetch predictions from MongoDB
    const scans = await Prediction.find({ userId: user._id }).sort({ createdAt: -1 });

    // Crop summary
    const totalCrops = scans.length;
    const healthyCrops = scans.filter(s => s.disease === "Healthy").length;
    const diseasedCrops = totalCrops - healthyCrops;

    // Recent activity (last 3 predictions)
    const recentActivity = scans.slice(-3).reverse().map(p => ({
      action: "Disease detected",
      detail: p.disease
    }));

    // Alerts: any severe diseases + example alerts
    const alerts = scans
      .filter(p => p.severity === "Severe")
      .map(p => `🚨 Disease detected in ${p.disease}`);
    alerts.push("💧 Low soil moisture");
    alerts.push("🌧 Rain expected tomorrow");

    // Weather example (replace with live API if needed)
    const weather = {
      temperature: 29,
      humidity: 65,
      condition: "Partly Cloudy",
      wind: "8 km/h",
      rainChance: "10%"
    };

    // Render the dashboard template with dynamic data
    res.render("home", {
      user,
      scans,
      totalCrops,
      healthyCrops,
      diseasedCrops,
      recentActivity,
      alerts,
      weather
    });
  } catch (err) {
    console.error(err);
    res.render("home", {
      user: req.user,
      scans: [],
      totalCrops: 0,
      healthyCrops: 0,
      diseasedCrops: 0,
      recentActivity: [],
      alerts: [],
      weather: {}
    });
  }
});

// ____________________________________________________________________________________________________________________
app.get("/detect-disease", (req, res) => {
    console.log("user id:", req.user._id);
    res.render("cards/detect-disease");
});


// wake up ml flask server before calling it.
// const ML_HEALTH_URL = `${ML_URL}/health`;
// console.log("HEALTH:", ML_HEALTH_URL);
const ML_PREDICT_URL = `${ML_URL}/predict`;
console.log("POSTING TO:", ML_PREDICT_URL);


const treatment = require("./treatments.json");



app.post("/detect-disease", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.render("cards/detect-disease", {
        prediction: null,
        imageUrl: null,
        error: "Please upload an image."
      });
    }

    const formData = new FormData();
    formData.append("image", fs.createReadStream(req.file.path));

    const response = await axios.post(ML_PREDICT_URL, formData, {
      headers: formData.getHeaders(),
      timeout: 180000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const severity = await calculateSeverity(req.file.path);
    console.log("image path:", req.file.path);
    console.log("calculated severity:", severity);


    
    const imageUrl = `/uploads/${req.file.filename}`;

    // sending treatment based on disease
    const disease = response.data.disease;

    const suggestion = treatment[disease] || {treatment : "No data", prevention: "No data"}; // we require json data in treatment object.
    console.log(suggestion);

    // saving prediction in database with severity and leaf name
    const dataTreatment = require("./treatments.json");
    const info = dataTreatment[disease];
    const leafName = disease.split("___")[0];

    // console.log(JSON.stringify(updatedData, null, 2));
    console.log("leaf name:", leafName);

    console.log("ML Response:", response.data); 
    console.log("image url:", imageUrl); 
    
    const data = { 
      userId: req.user._id,
      disease: response.data.disease,
      confidence: response.data.confidence,
      leafName,
      severity,
      imageUrl: `/uploads/${req.file.filename}`,
    }

    let predictionData = new Prediction(data);
    let x = await predictionData.save();

    console.log(x);

    // // sending treatment based on disease
    // const disease = response.data.disease;

    // const suggestion = treatment[disease] || {treatment : "No data", prevention: "No data"}; // we require json data in treatment object.
    // console.log(suggestion);



    return res.render("cards/detect-disease", {
      prediction: { ...response.data, severity },
      imageUrl,
      suggestion
    });

  } catch (err) {
    console.log(err?.message || err);
    return res.render("cards/detect-disease", {
      prediction: null,
      imageUrl: null,
      error: "Prediction failed. ML server not reachable."
    });
  }
});

// ______________________________________________________________________________________________________________
app.get("/weekly-analysis", async (req, res) => {
  try {
    // if you use login middleware, put it here
    // if (!req.isAuthenticated()) return res.redirect("/login");

    const userId = req.user?._id; // assume logged in
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);

    const scans = await Prediction.find({
      userId,
      createdAt: { $gte: fromDate }
    }).sort({ createdAt: 1 });

    const totalScans = scans.length;

    // Most common disease
    const freq = {};
    scans.forEach(s => {
      freq[s.disease] = (freq[s.disease] || 0) + 1;
    });
    const topDisease = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || "No data";

    // Average confidence
    const avgConfidence = totalScans
      ? (scans.reduce((sum, s) => sum + s.confidence, 0) / totalScans).toFixed(2)
      : 0;

    // Trend vs previous scan (simple)
    let trend = "No Data";
    let suggestion = "Upload weekly images to see progress and suggestions.";

    const reports = suggestion;
    if (totalScans >= 2) {
      const prev = scans[totalScans - 2];
      const curr = scans[totalScans - 1];

      if (prev.disease !== "Tomato - Healthy" && curr.disease === "Tomato - Healthy") {
        trend = "Improving ✅";
        suggestion = "Great improvement! Continue the same care and monitor weekly.";
      } else if (prev.disease === curr.disease) {
        if (curr.confidence > prev.confidence) {
          trend = "Worsening 📈";
          suggestion = "Disease is getting stronger. Take treatment and consult Krushi Kendra.";
        } else {
          trend = "Recovering 📉";
          suggestion = "Looks like recovery. Continue treatment and avoid over-watering.";
        }
      } else {
        trend = "Changing 🔄";
        suggestion = "Disease type changed. Re-check leaf photo and follow new treatment guidance.";
      }
    }

    res.render("cards/weekly-analysis", {
      totalScans,
      topDisease,
      avgConfidence,
      trend,
      suggestion,
      scans
    }); 

  } catch (err) {
    console.log(err);
    res.render("cards/weekly-analysis", {
      totalScans: 0,
      topDisease: "No data",
      avgConfidence: 0,
      trend: "No Data",
      suggestion: "Error loading weekly analysis.",
      scans: []
    });
  }
});



app.get("/prediction/:id", async (req, res) => {
  try {
    const prediction = await Prediction.findById(req.params.id);

    if (!prediction) {
      req.flash("error", "Prediction not found");
      return res.redirect("/home");
    }

    // Render a page showing the prediction details
    res.render("cards/prediction-detail", { prediction });
  } catch (err) {
    console.error(err);
    req.flash("error", "Something went wrong");
    res.redirect("/home");
  }
});

// ______________________________________________________________________________________



app.get("/generate-report", async (req, res) => {
  try {
    // Fetch all predictions for the logged-in user
    const reports = await Prediction.find({ userId: req.user._id }).sort({ createdAt: -1 });

    // Render the Digital Report page with dynamic data
    res.render("cards/digital-report", { reports, treatment, farmer: req.user });
  } catch (err) {
    console.error(err);
    res.render("cards/digital-report", { reports: [], treatment });
  }
});

// ________________________________________________________________________________________________

// GET route to render the page
app.get("/weather-based-prediction", async (req, res) => {
  res.render("cards/WeatherBasedPrediction");
});

// Optional POST route if you want to save predictions in database
app.post("/weather-based-prediction", async (req, res) => {
  const { temp, humidity, rain } = req.body;

  // Simple server-side rule-based logic (optional)
  let risk = "";
  if (humidity > 70 && rain > 20 && temp >= 20 && temp <= 30) risk = "High";
  else if (humidity > 60 && rain > 10) risk = "Moderate";
  else risk = "Low";

  // Optionally save to DB
  // await WeatherPrediction.create({ userId: req.user._id, temp, humidity, rain, risk });

  res.json({ risk }); // return result as JSON
});

app.post("/weather-based-prediction", async (req, res) => {

});

// ________________________________________________________________________________________________
app.use((err, req, res, next) => {
  console.log("MULTER/APP ERROR:", err);
  return res.status(500).send("Upload failed / Server error");
});

// ____________________________________________________________________________________________________________
app.listen("4000",async ()=>{
    console.log("app is listening on port 4000");
})
