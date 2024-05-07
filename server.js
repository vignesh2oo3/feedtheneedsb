const dotenv = require("dotenv");
dotenv.config();
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { postImageToFacebook } = require('./facebook-service'); // Import the Facebook service module
const { sendImageToTelegram } = require('./telegram-service'); // Import the telegram service module
const { createMediaContainer, publishMediaContainer } = require('./instagram-service'); // Import Instagram functions
const moment = require('moment-timezone');

const multer = require("multer"); // Add this line
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const jwt = require ("jsonwebtoken");// Import JWT module
const bcrypt = require("bcrypt"); //for password hashing
const { log } = require("console");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
const randomImageName = (bytes = 32) => {
  const randomBytes = crypto.randomBytes(bytes);
  return randomBytes.toString("hex");
};

const bucketName = process.env.BUCKET_NAME;
const bucketRegion = process.env.BUCKET_REGION;
const accessKey = process.env.ACCESS_KEY;
const secretAccesskey = process.env.SECRET_ACCESS_KEY;
const jwtSecretKey = process.env.JWT_SECRET_KEY; // JWT secret key


const s3 = new S3Client({
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretAccesskey,
  },
  region: bucketRegion,
});

const pool = new Pool({
  user: "postgres",
  host: "localhost", // Change to your PostgreSQL host
  database: "postgres",
  password: "root",
  port: 5432, // PostgreSQL default port
});

app.use(express.json());

const port = 2003; // Make sure this matches the port you're trying to connect to
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Define a route to handle the SQL query
app.get('/users', async (req, res) => {
  const { user_name } = req.body;

  try {
    // Execute the SQL query, excluding the password column
    const { rows } = await pool.query(
      `SELECT userid, "name", email, user_name FROM public.users WHERE user_name = $1`,
      [user_name]
    );

    // If rows are returned, send them as a response
    if (rows.length > 0) {
      res.json(rows);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

//signup
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password ,user_name} = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql =
      "INSERT INTO users (name, email, password,user_name) VALUES ($1, $2, $3,$4)";
    const values = [name, email, hashedPassword,user_name];
    await pool.query(sql, values);
    return res.status(200).json("User created successfully");
  } catch (error) {
    console.log(error);
    return res.status(500).json("Error");
  }
});
//local storage
app.post('/Location', (req, res) => {
  const { latitude, longitude } = req.body;

  // Create a Google Maps link with the obtained latitude and longitude
  const locationLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

  res.json({ link: locationLink });
});


// JWT functions
function generateToken(payload) {
  return jwt.sign(payload, jwtSecretKey, { expiresIn: '24h' });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecretKey);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, jwtSecretKey, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}



// Route to create JWT token upon successful login
app.post("/login", async (req, res) => {
  try {
    const { email: userEmail, password } = req.body;

    const sql = "SELECT userid, name, email, password, user_name FROM public.users WHERE email = $1";
    const result = await pool.query(sql, [userEmail]);

    if (result.rows.length === 0) {
      return res.status(401).json("Invalid email or password");
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json("Invalid email or password");
    }
// Generate JWT token upon successful login
const token = generateToken({ userid: user.userid });
    // Extracting user information
    const { userid, name, email } = user;

    // Return user information upon successful login
    return res.status(200).json({ userid, name, email,token, message: "Login successful" });
  } catch (error) {
    console.error(error);
    return res.status(500).json("Error");
  }
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });



//scheduled_posts table
app.post('/api/scheduled_posts', authenticateToken,upload.single('image'), async (req, res) => {
  try {
    const { userid, caption, scheduledtime } = req.body;

    // Validate required fields
    if (!userid || !caption || !scheduledtime || !req.file) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Ensure scheduledtime is a valid timestamp
    const scheduledTime = moment(scheduledtime, 'YYYY-MM-DD HH:mm:ss');
    if (!scheduledTime.isValid()) {
      return res.status(400).json({ success: false, error: 'Invalid scheduled time format' });
    }

    // Upload image to AWS S3
    const imageName = randomImageName();
    const params = {
      Bucket: bucketName,
      Key: imageName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };
    await s3.send(new PutObjectCommand(params));

    // Generate image URL
    const imageUrl = `https://${bucketName}.s3.${bucketRegion}.amazonaws.com/${imageName}`;

    // Insert into scheduled_posts table
    const insertQuery = `
      INSERT INTO public.scheduled_posts (userid, imageurl, caption, scheduledtime, createdat)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING *;
    `;
    const values = [userid, imageUrl, caption, scheduledTime];

    const result = await pool.query(insertQuery, values);

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error inserting into scheduled_posts:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});






app.get("/Showposts", authenticateToken, async (req, res) => {
  try {
    const sql =
      'SELECT "PostID", image_url, caption, post_type, "current_time" FROM public.posts ORDER BY "current_time" DESC';
      
    const result = await pool.query(sql);

    const posts = result.rows;
    for (const post of posts) {
      if (post.current_time) {
        const timestamp = new Date(post.current_time);
        const ISTTime = timestamp.toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour12: true,
        });
        post.current_time = ISTTime;
      }
      
      // Extracting phone number from the caption
      const phoneNumberRegex = /\+\d{1,3}\s?\d{9,}/; // Updated regex to match phone number formats with or without country code
      const phoneNumberMatch = post.caption.match(phoneNumberRegex);
      if (phoneNumberMatch) {
        const phoneNumber = phoneNumberMatch[0].replace(/\s/g, ''); // Remove any spaces from the matched phone number
        // Constructing the WhatsApp chat URL
        const whatsappUrl = `https://wa.me/${phoneNumber}`;
        // Adding WhatsApp chat URL to the post object
        post['whatappchart_url'] = whatsappUrl;
      }
    }

    res.status(200).json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching posts" });
  }
});


// Function to post a scheduled post
async function postitschedulepost(postData) {
  try {
    const { userid, imageurl, caption } = postData;

    // Calculate the timestamp in the "YYYY-MM-DD HH:MM:SS.SSS" format
    const currentTime = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    // Insert data into the PostgreSQL table
    const insertQuery =
      'INSERT INTO posts (image_url, caption,post_type, "current_time") VALUES ($1, $2, $3,$4)';
    const values = [imageurl, caption, 'food',currentTime];
    console.log('Current Time:', currentTime);
    await pool.query(insertQuery, values);

    // Post the image to Facebook
    const facebookResponse = await postImageToFacebook(imageurl, caption);
    
    if (!facebookResponse.data.id) {
      throw new Error('Image upload to Facebook failed.');
    }

    // Post the image to Instagram
    const creationId = await createMediaContainer(caption, imageurl);
    const igResponse = await publishMediaContainer(creationId);
    console.log('Media uploaded and published:', igResponse);

    if (!igResponse || !igResponse.id) {
      throw new Error('Image upload to Instagram failed.');
    }

    // Post the image to Telegram
    const telegramResponse = await sendImageToTelegram(imageurl, caption);

    if (telegramResponse.ok) {
      return console.log('Image uploaded successfully to AWS S3, Facebook, Instagram, and Telegram.');
    } else {
      throw new Error('Image upload to Telegram failed.');
    }
  } catch (error) {
    console.error(error);
    throw new Error('Error uploading and posting');
  }
}

let isProcessingScheduledPosts = false;

// Function to check and post scheduled posts
async function checkAndPostScheduledPosts() {
  // Check if the function is already processing scheduled posts
  if (isProcessingScheduledPosts) {
    console.log('Previous execution of checkAndPostScheduledPosts is still in progress.');
    return;
  }

  // Set the flag to indicate that the function is now processing scheduled posts
  isProcessingScheduledPosts = true;

  try {
    // Get the current time in the format 'YYYY-MM-DD HH:mm:ss'
    const currentTime = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    // Query scheduled posts from the database
    const query = `
      SELECT scheduledpostid, userid, imageurl, caption, scheduledtime, createdat
      FROM public.scheduled_posts
      WHERE scheduledtime <= $1;`;
    const { rows } = await pool.query(query, [currentTime]);

    // Iterate over scheduled posts
    for (const post of rows) {
      // Call the postitschedulepost function with the scheduled post data
      await postitschedulepost(post);
      
      // Optionally, delete the processed scheduled post from the database
      const deleteQuery = `
        DELETE FROM public.scheduled_posts
        WHERE scheduledpostid = $1;`;
      await pool.query(deleteQuery, [post.scheduledpostid]);

      console.log('Scheduled post successfully processed and posted:', post);
    }
  } catch (error) {
    console.error('Error checking and posting scheduled posts:', error);
  } finally {
    // Reset the flag once the function execution is complete
    isProcessingScheduledPosts = false;
  }
}
// Set up setInterval to call checkAndPostScheduledPosts every 15 seconds (15000 milliseconds)
setInterval(checkAndPostScheduledPosts, 15000);



// Handle POST request to create a new food donation announcement
app.post('/donations', authenticateToken,async (req, res) => {
  try {
      const { organisationName, title, description, place, venueDateAndTime, userId } = req.body;
      
      // Convert venueDateAndTime to Asia/Kolkata timezone and format it
      const venueDateTimeFormatted = moment.tz(venueDateAndTime, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      const client = await pool.connect();
      const query = 'INSERT INTO public.donations (organisation_name, title, description, place, venue_date_time, created_at, user_id) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6) RETURNING *';
      const values = [organisationName, title, description, place, venueDateTimeFormatted, userId];
      const result = await client.query(query, values);
      client.release();
      res.status(201).json(result.rows[0]);
  } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
  }
});

app.get('/announcement',authenticateToken, async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM donations');
    client.release();

    const announcements = result.rows.map(announcement => {
      // Convert the venue_date_time to the desired format
      const formattedDateTime = moment(announcement.venue_date_time).format('Do dddd h:mma');
      return {
        ...announcement,
        venue_date_time: formattedDateTime
      };
    });

    res.json(announcements);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});





// async function deleteOldFoodPosts() {
//   try {
//       // Calculate the current time and three hours ago using PostgreSQL's interval
//       const currentTimeFormatted = new Date().toISOString();
//       const threeHoursAgoFormatted = new Date(currentTimeFormatted);
//       threeHoursAgoFormatted.setHours(threeHoursAgoFormatted.getHours() - 3);

//       // Query records where "current_time" is older than 3 hours and "post_type" is "food"
//       const selectQuery = 'SELECT "PostID" FROM public.posts WHERE "current_time" < $1 AND "post_type" = $2';
//       const selectValues = [threeHoursAgoFormatted, 'food'];
//       const result = await pool.query(selectQuery, selectValues);

//       const deletedRecords = result.rows;
//       console.log("Deleted successfully");
//       console.log(deletedRecords);

//       // Delete records from the database
//       for (const record of deletedRecords) {
//           const { PostID } = record;

//           // Delete the record from the database
//           const deleteQuery = 'DELETE FROM public.posts WHERE "PostID" = $1'; // Corrected column name to "PostID"
//           const deleteValues = [PostID];
//           await pool.query(deleteQuery, deleteValues);

//           console.log(`Deleted record with id ${PostID}`);
//       }

//       console.log(`Deleted ${deletedRecords.length} 'food' records older than 3 hours.`);
//   } catch (error) {
//       console.error('Error deleting records:', error);
//   }
// }

// // Schedule the script to run periodically (e.g., every hour)

// setInterval(deleteOldFoodPosts, 15000);


