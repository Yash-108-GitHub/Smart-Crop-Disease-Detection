// start command - npm start

require('dotenv').config();

const express = require("express");
const app = express();

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
    req.flash("success", "Welcome back!");
    res.redirect("/home");
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

app.get("/home", (req, res) => {
   res.render("home");
});

// ____________________________________________________________________________________________________________________
app.get("/detect-disease", (req, res) => {
    res.render("cards/detect-disease");
    // res.send("predict disease route");
});


// render python server || local server
// const ML_URL = "https://smart-crop-disease-detection-ml-server.onrender.com/predict" || "http://127.0.0.1:5000/predict";


// wake up ml flask server before calling it.
const ML_HEALTH_URL = `${ML_URL}/health`;
const ML_PREDICT_URL = `${ML_URL}/predict`;

async function wakeMlServer() {
    try {
      console.log("calling ml server",ML_HEALTH_URL);
      await axios.get(ML_HEALTH_URL, { timeout: 120000 });
      return true;
    } catch (e) {
      // await new Promise(r => setTimeout(r, 5000)); // wait 3s then call the server again.
      return false;
    }
  }


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

    // 👇 ADD THIS BEFORE CALLING ML
    const ok = await wakeMlServer();
    if (!ok) {
      return res.render("cards/detect-disease", {
        prediction: null,
        imageUrl: null,
        error: "ML server is waking up. Please try again in 25-30 seconds."
      });
    }

    const response = await axios.post(ML_PREDICT_URL, formData, {
      headers: formData.getHeaders(),
      timeout: 180000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const imageUrl = `/uploads/${req.file.filename}`;

    return res.render("cards/detect-disease", {
      prediction: response.data,
      imageUrl,
      error: null
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

console.log("HEALTH:", ML_HEALTH_URL);
console.log("PREDICT:", ML_PREDICT_URL);

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
// ________________________________________________________________________________________________
app.use((err, req, res, next) => {
  console.log("MULTER/APP ERROR:", err);
  return res.status(500).send("Upload failed / Server error");
});

// ____________________________________________________________________________________________________________
app.listen("4000",()=>{
    console.log("app is listening on port 4000");
})