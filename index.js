const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
var cors = require("cors");
require("dotenv").config();
let jwt = require("jsonwebtoken");
// var bodyParser = require('body-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_PUBLIC_KEY);
// 10
app.use(cors());
app.use(express.json());
// app.use(bodyParser.json())
app.use(express.static("public"));

// doctors_portal2 in database
//(server url) => https://doctors-portal-server-2nd-time.herokuapp.com/
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qnrxg.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
// client.connect(err => {
//   const collection = client.db("test").collection("devices");
//   // perform actions on the collection object
//   client.close();
// });

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(403).send({ message: "Forbidden" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_KEY_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden" });
    }
    if (decoded) {
      req.decoded = decoded;
      next();
    }
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db("doctors_portal").collection("services");
    const bookingCollection = client.db("doctors_portal").collection("booking");
    const userCollection = client.db("doctors_portal").collection("user");
    const doctorCollection = client.db("doctors_portal").collection("doctors");
    const paymentCollection = client.db("doctors_portal").collection("payment");

    async function verifyAdmin(req, res, next){
      const email = req.decoded.email
      const user = await userCollection.findOne({email})
      const admin = user?.role === 'admin'
      if(admin){
        next()
      }else{
        return res.status(403).send({message: 'Forbidden'})
      }
    }

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({name: 1});
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/available", async (req, res) => {
      const date = req.query.date || "Jul 12, 2022";
      const query = { date }; // {date: date}

      const services = await serviceCollection.find().toArray();

      const booked = await bookingCollection.find(query).toArray();

      services.forEach((service) => {
        const serviceBookings = booked.filter(
          (b) => b.treatment === service.name
        );

        const bookedSlots = serviceBookings.map((booked) => booked.slot);

        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });
      res.send(services);
    });
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;

      if (decodedEmail === patient) {
        const query = { patient: patient };
        const result = await bookingCollection.find(query).toArray();
        return res.send(result);
      } else {
        return res.status(403).send({ message: "Forbidden" });
      }
    });
    app.get("/bookingSelectDay", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const date = req.query.date;
      const decodedEmail = req.decoded.email;

      if (decodedEmail === patient) {
        const query = { patient: patient, date: date };
        const result = await bookingCollection.find(query).toArray();
        return res.send(result);
      } else {
        return res.status(403).send({ message: "Forbidden" });
      }
    });
    app.get("/bookingDate", async (req, res) => {
      const patient = req.query.patient;
      const date = req.query.date || "Jul 23, 2022";
      const query = { patient, date };
      const result = await bookingCollection.find(query).toArray();
      res.send(result);
    });
    app.get('/booking/:id', async (req, res) => {
      const id = req.params.id
      const result = await bookingCollection.findOne({_id: ObjectId(id)})
      res.send(result)
    })
    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email
      const user = await userCollection.findOne({email: email})
      // if(user.role === 'admin'){
      //   res.send({admin: true})
      // }else{
      //   res.send({admin: false})
      // }
      const isAdmin = user?.role === 'admin'
      res.send({admin: isAdmin})
    })
    app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {}
      const doctors = await doctorCollection.find(query).toArray()
      res.send(doctors)
    })

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exist = await bookingCollection.findOne(query);
      if (exist) {
        return res.send({ success: false, exist });
      } else {
        const result = await bookingCollection.insertOne(booking);
        return res.send({ success: true, result });
      }
    });
    app.post('/doctor', verifyJWT, async (req, res) =>{
      const doctor = req.body
      const result = await doctorCollection.insertOne(doctor)
      res.send(result)
    })
    app.post('/create-payment-intent', async (req, res) => {
      const price = req.body.price
      const amount = price * 100
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        automatic_payment_methods: {enabled: true,},
        // payment_method_types: ["card"],
      });
      res.send({clientSecret: paymentIntent.client_secret})
    })

    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const requester = req.decoded.email;
      const requesterAuth = await userCollection.findOne({ email: requester });
      if (requesterAuth.role === "admin") {
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result)
      }else{
        res.status(403).send({message: "Forbidden"})
      }
    });
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;

      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: req.body,
      };

      const result = await userCollection.updateOne(filter, updateDoc, options);

      const token = jwt.sign({ email: email }, process.env.ACCESS_KEY_TOKEN, {
        expiresIn: "1h"
      });

      res.send({ result, token: token });
    });
    app.patch('/booking/:id', async (req, res) => {
      const id = req.params.id;
      const patient = req.body
      const filter = {_id: ObjectId(id)}
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: patient.transactionId
        }
      }
      const result = await paymentCollection.insertOne(patient)
      const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
      res.send(updatedBooking)
    })

    app.delete('/doctor/:id', async (req, res) => {
      const id = req.params.id
      const query = {_id : ObjectId(id)}
      const result = await doctorCollection.deleteOne(query)
      res.send(result)
    })
  } finally {
    // await client.close()
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from doctors uncle !!!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
//