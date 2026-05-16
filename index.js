const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// ─── MIDDLEWARE ───────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

// ─── ROOT ROUTE ───────────────────────────────────
app.get('/', (req, res) => {
  res.send('LocalChefBazaar server is running!');
});

// ─── MONGODB ──────────────────────────────────────
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fy6bmg4.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// ─── JWT MIDDLEWARE ───────────────────────────────
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send({ message: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: 'Forbidden' });
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    await client.connect();
    console.log('Connected to MongoDB!');

    const db = client.db('localchefbazaar');
    const usersCollection = db.collection('users');
    const mealsCollection = db.collection('meals');
    const ordersCollection = db.collection('orders');
    const reviewsCollection = db.collection('reviews');
    const favoritesCollection = db.collection('favorites');
    const requestsCollection = db.collection('requests');
    const paymentsCollection = db.collection('payments');

    // ── ROLE MIDDLEWARE ──────────────────────────
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== 'admin') return res.status(403).send({ message: 'Forbidden' });
      next();
    };

    const verifyChef = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== 'chef') return res.status(403).send({ message: 'Forbidden' });
      next();
    };

    // ══════════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════════
    app.post('/jwt', (req, res) => {
      const token = jwt.sign(req.body, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.send({ token });
    });

    // ══════════════════════════════════════════════
    // USER ROUTES
    // ══════════════════════════════════════════════

    // PUBLIC — save new user on registration
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.send({ message: 'User already exists' });
      const result = await usersCollection.insertOne({
        ...user,
        role: 'user',
        status: 'active',
        createdAt: new Date()
      });
      res.send(result);
    });

    // PRIVATE — get single user by email
    app.get('/users/:email', verifyToken, async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      res.send(user);
    });

    // ADMIN — get all users
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      res.send(await usersCollection.find().toArray());
    });

    // ADMIN — mark user as fraud
    app.patch('/users/fraud/:id', verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: 'fraud' } }
      );
      res.send(result);
    });

    // ══════════════════════════════════════════════
    // MEALS ROUTES
    // Note: specific routes MUST come before /:id
    // ══════════════════════════════════════════════

    // PUBLIC — 6 meals for homepage
    app.get('/meals/home', async (req, res) => {
      const meals = await mealsCollection.find().limit(6).toArray();
      res.send(meals);
    });

    // PRIVATE — get meals by chef email
    app.get('/meals/chef/:email', verifyToken, async (req, res) => {
      const meals = await mealsCollection.find({ userEmail: req.params.email }).toArray();
      res.send(meals);
    });

    // PUBLIC — get all meals with sort and pagination
    app.get('/meals', async (req, res) => {
      const { sort, page = 1, limit = 10 } = req.query;
      const sortOption = sort === 'asc' ? 1 : sort === 'desc' ? -1 : null;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      let cursor = mealsCollection.find().skip(skip).limit(parseInt(limit));
      if (sortOption) cursor = cursor.sort({ price: sortOption });
      const meals = await cursor.toArray();
      const total = await mealsCollection.countDocuments();
      res.send({ meals, total });
    });

    // PUBLIC — get single meal by id
    app.get('/meals/:id', async (req, res) => {
      const meal = await mealsCollection.findOne({ _id: new ObjectId(req.params.id) });
      res.send(meal);
    });

    // CHEF — create meal
    app.post('/meals', verifyToken, verifyChef, async (req, res) => {
      const meal = { ...req.body, createdAt: new Date() };
      res.send(await mealsCollection.insertOne(meal));
    });

    // CHEF — update meal
    app.put('/meals/:id', verifyToken, verifyChef, async (req, res) => {
      const data = { ...req.body };
      delete data._id;
      res.send(await mealsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: data }
      ));
    });

    // CHEF — delete meal
    app.delete('/meals/:id', verifyToken, verifyChef, async (req, res) => {
      res.send(await mealsCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
    });

    // ══════════════════════════════════════════════
    // REVIEWS ROUTES
    // Note: specific routes MUST come before /:foodId
    // ══════════════════════════════════════════════

    // PUBLIC — 3 reviews for homepage
    app.get('/reviews/home', async (req, res) => {
      res.send(await reviewsCollection.find().limit(3).toArray());
    });

    // PRIVATE — get reviews by user email
    app.get('/reviews/user/:email', verifyToken, async (req, res) => {
      res.send(await reviewsCollection.find({ reviewerEmail: req.params.email }).toArray());
    });

    // PUBLIC — get reviews for a meal
    app.get('/reviews/:foodId', async (req, res) => {
      res.send(await reviewsCollection.find({ foodId: req.params.foodId }).toArray());
    });

    // PRIVATE — add review
    app.post('/reviews', verifyToken, async (req, res) => {
      res.send(await reviewsCollection.insertOne({ ...req.body, date: new Date() }));
    });

    // PRIVATE — update review
    app.put('/reviews/:id', verifyToken, async (req, res) => {
      const { rating, comment } = req.body;
      res.send(await reviewsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { rating, comment } }
      ));
    });

    // PRIVATE — delete review
    app.delete('/reviews/:id', verifyToken, async (req, res) => {
      res.send(await reviewsCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
    });

    // ══════════════════════════════════════════════
    // FAVORITES ROUTES
    // ══════════════════════════════════════════════

    // PRIVATE — get user favorites
    app.get('/favorites/:email', verifyToken, async (req, res) => {
      res.send(await favoritesCollection.find({ userEmail: req.params.email }).toArray());
    });

    // PRIVATE — add to favorites
    app.post('/favorites', verifyToken, async (req, res) => {
      const favorite = req.body;
      const existing = await favoritesCollection.findOne({
        userEmail: favorite.userEmail,
        mealId: favorite.mealId
      });
      if (existing) return res.send({ message: 'Already in favorites' });
      res.send(await favoritesCollection.insertOne({ ...favorite, addedTime: new Date() }));
    });

    // PRIVATE — remove from favorites
    app.delete('/favorites/:id', verifyToken, async (req, res) => {
      res.send(await favoritesCollection.deleteOne({ _id: new ObjectId(req.params.id) }));
    });

    // ══════════════════════════════════════════════
    // ORDERS ROUTES
    // ══════════════════════════════════════════════

    // PRIVATE — place order
    app.post('/orders', verifyToken, async (req, res) => {
      res.send(await ordersCollection.insertOne({
        ...req.body,
        orderStatus: 'pending',
        paymentStatus: 'Pending',
        orderTime: new Date()
      }));
    });

    // PRIVATE — get orders by user email
    app.get('/orders/user/:email', verifyToken, async (req, res) => {
      res.send(await ordersCollection.find({ userEmail: req.params.email }).toArray());
    });

    // PRIVATE — get orders by chef id
    app.get('/orders/chef/:chefId', verifyToken, async (req, res) => {
      res.send(await ordersCollection.find({ chefId: req.params.chefId }).toArray());
    });

    // PRIVATE — update order status (accept/cancel/deliver)
    app.patch('/orders/status/:id', verifyToken, async (req, res) => {
      res.send(await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { orderStatus: req.body.orderStatus } }
      ));
    });

    // PRIVATE — update payment status after stripe payment
    app.patch('/orders/payment/:id', verifyToken, async (req, res) => {
      res.send(await ordersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { paymentStatus: 'paid' } }
      ));
    });

    // ══════════════════════════════════════════════
    // REQUESTS ROUTES (be a chef / be an admin)
    // ══════════════════════════════════════════════

    // PRIVATE — submit role request
    app.post('/requests', verifyToken, async (req, res) => {
      res.send(await requestsCollection.insertOne({
        ...req.body,
        requestStatus: 'pending',
        requestTime: new Date()
      }));
    });

    // ADMIN — get all requests
    app.get('/requests', verifyToken, verifyAdmin, async (req, res) => {
      res.send(await requestsCollection.find().toArray());
    });

    // ADMIN — approve request
    app.patch('/requests/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
      const request = await requestsCollection.findOne({ _id: new ObjectId(req.params.id) });
      let userUpdate = {};
      if (request.requestType === 'chef') {
        const chefId = `chef-${Math.floor(1000 + Math.random() * 9000)}`;
        userUpdate = { role: 'chef', chefId };
      } else {
        userUpdate = { role: 'admin' };
      }
      await usersCollection.updateOne(
        { email: request.userEmail },
        { $set: userUpdate }
      );
      res.send(await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { requestStatus: 'approved' } }
      ));
    });

    // ADMIN — reject request
    app.patch('/requests/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
      res.send(await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { requestStatus: 'rejected' } }
      ));
    });

    // ══════════════════════════════════════════════
    // PAYMENT ROUTES
    // ══════════════════════════════════════════════

    // PRIVATE — create stripe payment intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const amount = Math.round(req.body.price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method_types: ['card']
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // PRIVATE — save payment history
    app.post('/payments', verifyToken, async (req, res) => {
      res.send(await paymentsCollection.insertOne({ ...req.body, paidAt: new Date() }));
    });

    // ══════════════════════════════════════════════
    // ADMIN STATS
    // ══════════════════════════════════════════════
    app.get('/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
      const totalUsers = await usersCollection.countDocuments();
      const ordersPending = await ordersCollection.countDocuments({ orderStatus: 'pending' });
      const ordersDelivered = await ordersCollection.countDocuments({ orderStatus: 'delivered' });
      const paymentData = await paymentsCollection.find().toArray();
      const totalPayment = paymentData.reduce((sum, p) => sum + (p.amount || 0), 0);
      res.send({ totalUsers, ordersPending, ordersDelivered, totalPayment });
    });

  } finally {}
}

run().catch(console.dir);

app.listen(port, () => console.log(`Server running on port ${port}`));

module.exports = app;