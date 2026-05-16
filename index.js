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
  origin: ['http://localhost:5173', 'http://localhost:5174', 'https://yourlocalchefbazaar.netlify.app'],
  credentials: true
}));
app.use(express.json());

// ─── MONGODB CONNECTION ───────────────────────────
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fy6bmg4.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// ─── COLLECTIONS (defined outside run so routes can use them) ───
const db = client.db('localchefbazaar');
const usersCollection = db.collection('users');
const mealsCollection = db.collection('meals');
const ordersCollection = db.collection('orders');
const reviewsCollection = db.collection('reviews');
const favoritesCollection = db.collection('favorites');
const requestsCollection = db.collection('requests');
const paymentsCollection = db.collection('payments');

// ─── CONNECT TO MONGODB ONCE ─────────────────────
client.connect()
  .then(() => console.log('Connected to MongoDB!'))
  .catch(err => console.error('MongoDB connection error:', err));

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
// ROOT ROUTE
// ══════════════════════════════════════════════
app.get('/', (req, res) => {
  res.send('LocalChefBazaar server is running!');
});

// ══════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════
app.post('/jwt', (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.send({ token });
});

// ══════════════════════════════════════════════
// USER ROUTES
// ══════════════════════════════════════════════
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

app.get('/users/:email', verifyToken, async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email });
  res.send(user);
});

app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});

app.patch('/users/fraud/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: 'fraud' } }
  );
  res.send(result);
});

// ══════════════════════════════════════════════
// MEALS ROUTES
// ══════════════════════════════════════════════
app.get('/meals/home', async (req, res) => {
  const meals = await mealsCollection.find().limit(6).toArray();
  res.send(meals);
});

app.get('/meals/chef/:email', verifyToken, verifyChef, async (req, res) => {
  const email = req.params.email;
  const meals = await mealsCollection.find({ userEmail: email }).toArray();
  res.send(meals);
});

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

app.get('/meals/:id', async (req, res) => {
  const id = req.params.id;
  const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });
  res.send(meal);
});

app.post('/meals', verifyToken, verifyChef, async (req, res) => {
  const meal = req.body;
  meal.createdAt = new Date();
  const result = await mealsCollection.insertOne(meal);
  res.send(result);
});

app.put('/meals/:id', verifyToken, verifyChef, async (req, res) => {
  const id = req.params.id;
  const updatedMeal = req.body;
  delete updatedMeal._id;
  const result = await mealsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedMeal }
  );
  res.send(result);
});

app.delete('/meals/:id', verifyToken, verifyChef, async (req, res) => {
  const id = req.params.id;
  const result = await mealsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// ══════════════════════════════════════════════
// REVIEWS ROUTES
// ══════════════════════════════════════════════
app.get('/reviews/home', async (req, res) => {
  const reviews = await reviewsCollection.find().limit(3).toArray();
  res.send(reviews);
});

app.get('/reviews/user/:email', verifyToken, async (req, res) => {
  const email = req.params.email;
  const reviews = await reviewsCollection.find({ reviewerEmail: email }).toArray();
  res.send(reviews);
});

app.get('/reviews/:foodId', async (req, res) => {
  const foodId = req.params.foodId;
  const reviews = await reviewsCollection.find({ foodId }).toArray();
  res.send(reviews);
});

app.post('/reviews', verifyToken, async (req, res) => {
  const review = req.body;
  review.date = new Date();
  const result = await reviewsCollection.insertOne(review);
  res.send(result);
});

app.put('/reviews/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const { rating, comment } = req.body;
  const result = await reviewsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { rating, comment } }
  );
  res.send(result);
});

app.delete('/reviews/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// ══════════════════════════════════════════════
// FAVORITES ROUTES
// ══════════════════════════════════════════════
app.get('/favorites/:email', verifyToken, async (req, res) => {
  const email = req.params.email;
  const favorites = await favoritesCollection.find({ userEmail: email }).toArray();
  res.send(favorites);
});

app.post('/favorites', verifyToken, async (req, res) => {
  const favorite = req.body;
  const existing = await favoritesCollection.findOne({
    userEmail: favorite.userEmail,
    mealId: favorite.mealId
  });
  if (existing) return res.send({ message: 'Already in favorites' });
  favorite.addedTime = new Date();
  const result = await favoritesCollection.insertOne(favorite);
  res.send(result);
});

app.delete('/favorites/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const result = await favoritesCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// ══════════════════════════════════════════════
// ORDERS ROUTES
// ══════════════════════════════════════════════
app.post('/orders', verifyToken, async (req, res) => {
  const order = req.body;
  order.orderStatus = 'pending';
  order.paymentStatus = 'Pending';
  order.orderTime = new Date();
  const result = await ordersCollection.insertOne(order);
  res.send(result);
});

app.get('/orders/user/:email', verifyToken, async (req, res) => {
  const email = req.params.email;
  const orders = await ordersCollection.find({ userEmail: email }).toArray();
  res.send(orders);
});

app.get('/orders/chef/:chefId', verifyToken, verifyChef, async (req, res) => {
  const chefId = req.params.chefId;
  const orders = await ordersCollection.find({ chefId }).toArray();
  res.send(orders);
});

app.patch('/orders/status/:id', verifyToken, verifyChef, async (req, res) => {
  const id = req.params.id;
  const { orderStatus } = req.body;
  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { orderStatus } }
  );
  res.send(result);
});

app.patch('/orders/payment/:id', verifyToken, async (req, res) => {
  const id = req.params.id;
  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { paymentStatus: 'paid' } }
  );
  res.send(result);
});

// ══════════════════════════════════════════════
// REQUESTS ROUTES
// ══════════════════════════════════════════════
app.post('/requests', verifyToken, async (req, res) => {
  const request = req.body;
  request.requestStatus = 'pending';
  request.requestTime = new Date();
  const result = await requestsCollection.insertOne(request);
  res.send(result);
});

app.get('/requests', verifyToken, verifyAdmin, async (req, res) => {
  const requests = await requestsCollection.find().toArray();
  res.send(requests);
});

app.patch('/requests/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const request = await requestsCollection.findOne({ _id: new ObjectId(id) });

  let userUpdate = {};
  if (request.requestType === 'chef') {
    const chefId = `chef-${Math.floor(1000 + Math.random() * 9000)}`;
    userUpdate = { role: 'chef', chefId };
  } else if (request.requestType === 'admin') {
    userUpdate = { role: 'admin' };
  }

  await usersCollection.updateOne(
    { email: request.userEmail },
    { $set: userUpdate }
  );

  const result = await requestsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { requestStatus: 'approved' } }
  );
  res.send(result);
});

app.patch('/requests/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await requestsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { requestStatus: 'rejected' } }
  );
  res.send(result);
});

// ══════════════════════════════════════════════
// PAYMENT ROUTES
// ══════════════════════════════════════════════
app.post('/create-payment-intent', verifyToken, async (req, res) => {
  const { price } = req.body;
  const amount = Math.round(price * 100);
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    payment_method_types: ['card']
  });
  res.send({ clientSecret: paymentIntent.client_secret });
});

app.post('/payments', verifyToken, async (req, res) => {
  const payment = req.body;
  payment.paidAt = new Date();
  const result = await paymentsCollection.insertOne(payment);
  res.send(result);
});

// ══════════════════════════════════════════════
// ADMIN STATISTICS
// ══════════════════════════════════════════════
app.get('/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  const totalUsers = await usersCollection.countDocuments();
  const ordersPending = await ordersCollection.countDocuments({ orderStatus: 'pending' });
  const ordersDelivered = await ordersCollection.countDocuments({ orderStatus: 'delivered' });
  const paymentData = await paymentsCollection.find().toArray();
  const totalPayment = paymentData.reduce((sum, p) => sum + (p.amount || 0), 0);
  res.send({ totalUsers, ordersPending, ordersDelivered, totalPayment });
});

// ══════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;