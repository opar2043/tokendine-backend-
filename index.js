require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const PORT = process.env.PORT || 5000;
const REFERRAL_BONUS_TOKENS = parseInt(
  process.env.REFERRAL_BONUS_TOKENS || "5",
  10
);
const LOW_STOCK_THRESHOLD = parseInt(
  process.env.LOW_STOCK_THRESHOLD || "10",
  10
);

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  })
);

const uri =
  process.env.MONGODB_URI ||
  "mongodb+srv://tokendine:tokendine@cluster0.xfvkq.mongodb.net/?appName=Cluster0";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ---------- helpers ----------

// Safely convert a string into a MongoDB ObjectId; returns null if invalid.
const toOid = (id) => {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
};

// Adds a string `id` field (from `_id`) so the frontend can use it directly.
const withId = (doc) => {
  if (!doc) return doc;
  return { ...doc, id: doc._id?.toString() };
};

// Derives a product's stock status from its remaining stock count.
const deriveProductStatus = (stock) => {
  if (stock <= 0) return "out-of-stock";
  if (stock < LOW_STOCK_THRESHOLD) return "low-stock";
  return "in-stock";
};

// Builds a Mongo date filter ({$gte, $lte}) from a "today" | "week" | "month" keyword.
const parseDateRange = (range) => {
  const now = new Date();
  const start = new Date(now);
  if (range == "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range == "week") {
    start.setDate(now.getDate() - 7);
  } else if (range == "month") {
    start.setMonth(now.getMonth() - 1);
  } else {
    return null;
  }
  return { $gte: start, $lte: now };
};

async function run() {
  const db = client.db("tokenDine");

  const usersCol = db.collection("users");
  const clientsCol = db.collection("clients");
  const productsCol = db.collection("products");
  const salesCol = db.collection("tokenSales");
  const purchasesCol = db.collection("clientPurchases");
  const attendanceCol = db.collection("attendance");
  const complaintsCol = db.collection("complaints");
  const bonusesCol = db.collection("bonuses");
  const tablesCol = db.collection("tableAssignments");
  const progressCol = db.collection("dailyProgress");
  const auditCol = db.collection("auditLogs");

  // ========================================
  // AUTH
  // ========================================
  app.post("/auth/login/admin", async (req, res) => {
    const { email, password } = req.body;
    const user = await usersCol.findOne({ email, password, role: "admin" });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (user.status == "blocked")
      return res.status(403).json({ error: "Account blocked" });
    res.json({ user: withId(user) });
  });

  app.post("/auth/login/staff", async (req, res) => {
    const { mobile, password } = req.body;
    const user = await usersCol.findOne({
      mobile,
      password,
      role: { $in: ["manager", "worker"] },
    });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (user.status == "blocked")
      return res.status(403).json({ error: "Account blocked" });
    res.json({ user: withId(user) });
  });

  app.post("/auth/register", async (req, res) => {
    const { name, mobile, email, password, role } = req.body;
    const doc = {
      name,
      mobile,
      email,
      password,
      role,
      status: "active",
      joinedOn: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await usersCol.insertOne(doc);
    res.status(201).json({ user: withId({ ...doc, _id: result.insertedId }) });
  });

  app.post("/auth/logout", async (_req, res) => {
    res.json({ ok: true });
  });

  // ========================================
  // USERS
  // ========================================
  app.get("/users", async (req, res) => {
    const { role, q, page = 1, limit = 50 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (q)
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { mobile: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      usersCol
        .find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .toArray(),
      usersCol.countDocuments(query),
    ]);
    res.json({ items: items.map(withId), total });
  });

  app.post("/users", async (req, res) => {
    const { name, mobile, email, password, role, status } = req.body;
    const doc = {
      name,
      mobile,
      email,
      password,
      role,
      status: status || "active",
      joinedOn: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await usersCol.insertOne(doc);
    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  app.get("/users/:id", async (req, res) => {
    const user = await usersCol.findOne({ _id: toOid(req.params.id) });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(withId(user));
  });

  app.patch("/users/:id", async (req, res) => {
    const update = { ...req.body, updatedAt: new Date() };
    delete update._id;
    delete update.id;
    await usersCol.updateOne({ _id: toOid(req.params.id) }, { $set: update });
    const user = await usersCol.findOne({ _id: toOid(req.params.id) });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(withId(user));
  });

  app.patch("/users/:id/status", async (req, res) => {
    const { status } = req.body;
    await usersCol.updateOne(
      { _id: toOid(req.params.id) },
      { $set: { status, updatedAt: new Date() } }
    );
    const user = await usersCol.findOne({ _id: toOid(req.params.id) });
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(withId(user));
  });

  app.delete("/users/:id", async (req, res) => {
    const result = await usersCol.deleteOne({ _id: toOid(req.params.id) });
    if (!result.deletedCount)
      return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========================================
  // CLIENTS
  // ========================================
  app.get("/clients", async (req, res) => {
    const { q, page = 1, limit = 50 } = req.query;
    const query = {};
    if (q)
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { mobile: { $regex: q, $options: "i" } },
        { nid: { $regex: q, $options: "i" } },
      ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      clientsCol
        .find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .toArray(),
      clientsCol.countDocuments(query),
    ]);
    res.json({ items: items.map(withId), total });
  });

  app.post("/clients", async (req, res) => {
    const {
      name,
      mobile,
      nid,
      email,
      address,
      gender,
      referral,
      rating = 0,
      tokensBought = 0,
      tokensSpent = 0,
    } = req.body;

    const doc = {
      name,
      mobile,
      nid,
      email,
      address,
      gender,
      referral,
      rating,
      tokensBought,
      tokensSpent,
      balance: tokensBought - tokensSpent,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await clientsCol.insertOne(doc);

    // Referral bonus
    if (referral) {
      const referrer = await clientsCol.findOne({ mobile: referral });
      if (referrer) {
        await clientsCol.updateOne(
          { _id: referrer._id },
          {
            $inc: {
              tokensBought: REFERRAL_BONUS_TOKENS,
              balance: REFERRAL_BONUS_TOKENS,
            },
            $set: { updatedAt: new Date() },
          }
        );
        await auditCol.insertOne({
          action: "referral.bonus",
          targetId: referrer._id,
          payload: {
            tokens: REFERRAL_BONUS_TOKENS,
            newClient: result.insertedId,
          },
          date: new Date(),
        });
      }
    }

    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  app.get("/clients/:id", async (req, res) => {
    const c = await clientsCol.findOne({ _id: toOid(req.params.id) });
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(withId(c));
  });

  app.patch("/clients/:id", async (req, res) => {
    const update = { ...req.body, updatedAt: new Date() };
    delete update._id;
    delete update.id;
    await clientsCol.updateOne(
      { _id: toOid(req.params.id) },
      { $set: update }
    );
    const c = await clientsCol.findOne({ _id: toOid(req.params.id) });
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(withId(c));
  });

  app.delete("/clients/:id", async (req, res) => {
    const result = await clientsCol.deleteOne({ _id: toOid(req.params.id) });
    if (!result.deletedCount)
      return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  app.get("/clients/:id/purchases", async (req, res) => {
    const query = { clientId: toOid(req.params.id) };
    const range = parseDateRange(req.query.range);
    if (range) query.date = range;
    const items = await purchasesCol.find(query).sort({ date: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/clients/:id/purchases", async (req, res) => {
    const cid = toOid(req.params.id);
    const { productId, qty, tokensUsed } = req.body;
    const pid = toOid(productId);

    const product = await productsCol.findOne({ _id: pid });
    const amount = (product?.sellingPrice || 0) * qty;

    const newStock = (product?.stock || 0) - qty;
    await productsCol.updateOne(
      { _id: pid },
      {
        $set: {
          stock: newStock,
          status: deriveProductStatus(newStock),
          updatedOn: new Date(),
        },
      }
    );

    await clientsCol.updateOne(
      { _id: cid },
      {
        $inc: { tokensSpent: tokensUsed, balance: -tokensUsed },
        $set: { updatedAt: new Date() },
      }
    );

    const purchase = {
      clientId: cid,
      productId: pid,
      productName: product?.name,
      qty,
      tokensUsed,
      amount,
      date: new Date(),
    };
    const inserted = await purchasesCol.insertOne(purchase);
    res.status(201).json(withId({ ...purchase, _id: inserted.insertedId }));
  });

  // ========================================
  // PRODUCTS
  // ========================================
  app.get("/products", async (req, res) => {
    const { category, status } = req.query;
    const query = {};
    if (category) query.category = category;
    if (status) query.status = status;
    const items = await productsCol.find(query).sort({ addedOn: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/products", async (req, res) => {
    const { name, image, category, costPrice, sellingPrice, stock } = req.body;
    const doc = {
      name,
      image,
      category,
      costPrice,
      sellingPrice,
      stock: stock || 0,
      status: deriveProductStatus(stock || 0),
      addedOn: new Date(),
      updatedOn: new Date(),
    };
    const result = await productsCol.insertOne(doc);
    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  app.patch("/products/:id", async (req, res) => {
    const update = { ...req.body, updatedOn: new Date() };
    delete update._id;
    delete update.id;
    if (update.stock != null) update.status = deriveProductStatus(update.stock);
    await productsCol.updateOne(
      { _id: toOid(req.params.id) },
      { $set: update }
    );
    const p = await productsCol.findOne({ _id: toOid(req.params.id) });
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(withId(p));
  });

  app.delete("/products/:id", async (req, res) => {
    const result = await productsCol.deleteOne({ _id: toOid(req.params.id) });
    if (!result.deletedCount)
      return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========================================
  // TOKEN SALES
  // ========================================
  app.get("/sales", async (req, res) => {
    const { workerId, clientId, from, to } = req.query;
    const query = {};
    if (workerId) query.workerId = toOid(workerId);
    if (clientId) query.clientId = toOid(clientId);
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) query.date.$lte = new Date(to);
    }
    const items = await salesCol.find(query).sort({ date: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/sales", async (req, res) => {
    const { clientId, workerId, tokens, amount } = req.body;
    const cid = toOid(clientId);
    const wid = toOid(workerId);

    const doc = {
      clientId: cid,
      workerId: wid,
      tokens,
      amount,
      date: new Date(),
    };
    const result = await salesCol.insertOne(doc);

    await clientsCol.updateOne(
      { _id: cid },
      {
        $inc: { tokensBought: tokens, balance: tokens },
        $set: { updatedAt: new Date() },
      }
    );

    if (wid) {
      await usersCol.updateOne(
        { _id: wid },
        { $inc: { tokensSold: tokens }, $set: { updatedAt: new Date() } }
      );
    }

    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  // ========================================
  // ATTENDANCE
  // ========================================
  app.get("/attendance", async (req, res) => {
    const { workerId, date } = req.query;
    const query = {};
    if (workerId) query.workerId = toOid(workerId);
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query.date = { $gte: start, $lt: end };
    }
    const items = await attendanceCol.find(query).sort({ date: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/attendance/checkin", async (req, res) => {
    const { workerId } = req.body;
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const now = new Date();
    const status = now.getHours() >= 10 ? "late" : "present";
    const doc = {
      workerId: toOid(workerId),
      date,
      status,
      createdAt: now,
    };
    const result = await attendanceCol.insertOne(doc);
    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  app.patch("/attendance/:id/status", async (req, res) => {
    const { status } = req.body;
    await attendanceCol.updateOne(
      { _id: toOid(req.params.id) },
      { $set: { status } }
    );
    const a = await attendanceCol.findOne({ _id: toOid(req.params.id) });
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(withId(a));
  });

  // ========================================
  // COMPLAINTS
  // ========================================
  app.get("/complaints", async (req, res) => {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;
    const items = await complaintsCol.find(query).sort({ date: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/complaints", async (req, res) => {
    const { byId, subject } = req.body;
    const doc = {
      byId: toOid(byId),
      subject,
      date: new Date(),
      status: "open",
    };
    const result = await complaintsCol.insertOne(doc);
    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  app.patch("/complaints/:id/status", async (req, res) => {
    const { status } = req.body;
    await complaintsCol.updateOne(
      { _id: toOid(req.params.id) },
      { $set: { status } }
    );
    const c = await complaintsCol.findOne({ _id: toOid(req.params.id) });
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(withId(c));
  });

  // ========================================
  // BONUSES
  // ========================================
  app.get("/bonuses", async (req, res) => {
    const { workerId } = req.query;
    const query = {};
    if (workerId) query.workerId = toOid(workerId);
    const items = await bonusesCol.find(query).sort({ date: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/bonuses", async (req, res) => {
    const { workerId, amount, reason } = req.body;
    const wid = toOid(workerId);
    const doc = { workerId: wid, amount, reason, date: new Date() };
    const result = await bonusesCol.insertOne(doc);
    await usersCol.updateOne(
      { _id: wid },
      { $inc: { bonus: amount }, $set: { updatedAt: new Date() } }
    );
    await auditCol.insertOne({
      action: "bonus.add",
      targetId: wid,
      payload: { amount, reason },
      date: new Date(),
    });
    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  // ========================================
  // TABLES
  // ========================================
  app.get("/tables", async (_req, res) => {
    const items = await tablesCol.find().sort({ table: 1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/tables/assign", async (req, res) => {
    const { table, workerId } = req.body;
    const wid = toOid(workerId);
    const update = {
      table,
      workerId: wid,
      assignedOn: new Date(),
      status: "active",
    };
    await tablesCol.updateOne({ table }, { $set: update }, { upsert: true });
    await usersCol.updateOne({ _id: wid }, { $set: { table } });
    const t = await tablesCol.findOne({ table });
    res.json(withId(t));
  });

  app.post("/tables/release", async (req, res) => {
    const { table } = req.body;
    await tablesCol.updateOne(
      { table },
      {
        $set: { status: "free" },
        $unset: { workerId: "", assignedOn: "" },
      }
    );
    const t = await tablesCol.findOne({ table });
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(withId(t));
  });

  // ========================================
  // DAILY PROGRESS
  // ========================================
  app.get("/progress", async (req, res) => {
    const { workerId, date } = req.query;
    const query = {};
    if (workerId) query.workerId = toOid(workerId);
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query.date = { $gte: start, $lt: end };
    }
    const items = await progressCol.find(query).sort({ date: -1 }).toArray();
    res.json({ items: items.map(withId) });
  });

  app.post("/progress", async (req, res) => {
    const { workerId, table, tokenGiven, tokenSold, notes } = req.body;
    const doc = {
      workerId: toOid(workerId),
      table,
      tokenGiven,
      tokenSold,
      balance: tokenGiven - tokenSold,
      date: new Date(),
      notes,
    };
    const result = await progressCol.insertOne(doc);
    res.status(201).json(withId({ ...doc, _id: result.insertedId }));
  });

  // ========================================
  // ANALYTICS
  // ========================================
  app.get("/analytics/overview", async (_req, res) => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now);
    startOfMonth.setMonth(now.getMonth() - 1);

    const agg = async (matchDate) => {
      const m = matchDate ? { date: { $gte: matchDate } } : {};
      const r = await salesCol
        .aggregate([
          { $match: m },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$amount" },
              tokens: { $sum: "$tokens" },
            },
          },
        ])
        .toArray();
      return r[0] || { revenue: 0, tokens: 0 };
    };

    const [total, day, week, month, activeClients, stockAlerts, referrals] =
      await Promise.all([
        agg(),
        agg(startOfDay),
        agg(startOfWeek),
        agg(startOfMonth),
        clientsCol.countDocuments({ balance: { $gt: 0 } }),
        productsCol.countDocuments({
          status: { $in: ["low-stock", "out-of-stock"] },
        }),
        clientsCol.countDocuments({ referral: { $exists: true, $ne: null } }),
      ]);

    const profitAgg = await purchasesCol
      .aggregate([
        {
          $lookup: {
            from: "products",
            localField: "productId",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: "$product" },
        {
          $group: {
            _id: null,
            profit: {
              $sum: {
                $multiply: [
                  {
                    $subtract: ["$product.sellingPrice", "$product.costPrice"],
                  },
                  "$qty",
                ],
              },
            },
          },
        },
      ])
      .toArray();

    res.json({
      revenue: {
        total: total.revenue,
        day: day.revenue,
        week: week.revenue,
        month: month.revenue,
      },
      tokensSold: total.tokens,
      activeClients,
      stockAlerts,
      referralCount: referrals,
      profitEstimate: profitAgg[0]?.profit || 0,
    });
  });

  app.get("/analytics/worker/:id", async (req, res) => {
    const oid = toOid(req.params.id);

    const [salesAgg, attendanceDocs, user] = await Promise.all([
      salesCol
        .aggregate([
          { $match: { workerId: oid } },
          {
            $group: {
              _id: null,
              tokensSold: { $sum: "$tokens" },
              revenue: { $sum: "$amount" },
            },
          },
        ])
        .toArray(),
      attendanceCol.find({ workerId: oid }).toArray(),
      usersCol.findOne({ _id: oid }),
    ]);

    const total = attendanceDocs.length;
    const present = attendanceDocs.filter(
      (a) => a.status == "present" || a.status == "late"
    ).length;
    const attendanceRate = total ? Math.round((present / total) * 100) : 0;

    res.json({
      tokensSold: salesAgg[0]?.tokensSold || 0,
      revenue: salesAgg[0]?.revenue || 0,
      attendanceRate,
      rating: user?.rating || 0,
    });
  });

  // ========================================
  // SEED (dev helper)
  // ========================================
  app.post("/seed", async (_req, res) => {
    await Promise.all([
      usersCol.deleteMany({}),
      clientsCol.deleteMany({}),
      productsCol.deleteMany({}),
    ]);

    const password = "12345";
    const now = new Date();

    await usersCol.insertMany([
      {
        name: "Restaurent Admin",
        email: "admin@restaurant.com",
        password,
        role: "admin",
        status: "active",
        joinedOn: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Karim Manager",
        mobile: "01710000001",
        password,
        role: "manager",
        status: "active",
        joinedOn: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Salma Manager",
        mobile: "01710000002",
        password,
        role: "manager",
        status: "active",
        joinedOn: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Hasan Worker",
        mobile: "01810000001",
        password,
        role: "worker",
        status: "active",
        joinedOn: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Mim Worker",
        mobile: "01810000002",
        password,
        role: "worker",
        status: "active",
        joinedOn: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Tanvir Worker",
        mobile: "01810000003",
        password,
        role: "worker",
        status: "blocked",
        joinedOn: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const mkProduct = (p) => ({
      ...p,
      status: deriveProductStatus(p.stock),
      addedOn: now,
      updatedOn: now,
    });

    await productsCol.insertMany([
      mkProduct({
        name: "Chicken Biriyani",
        image: "🍛",
        category: "Main Course",
        costPrice: 180,
        sellingPrice: 280,
        stock: 42,
      }),
      mkProduct({
        name: "Beef Kacchi",
        image: "🥘",
        category: "Main Course",
        costPrice: 310,
        sellingPrice: 420,
        stock: 8,
      }),
      mkProduct({
        name: "Borhani",
        image: "🥤",
        category: "Beverage",
        costPrice: 30,
        sellingPrice: 60,
        stock: 75,
      }),
      mkProduct({
        name: "Shik Kabab",
        image: "🍢",
        category: "Appetizer",
        costPrice: 120,
        sellingPrice: 180,
        stock: 0,
      }),
      mkProduct({
        name: "Falooda",
        image: "🍨",
        category: "Dessert",
        costPrice: 80,
        sellingPrice: 150,
        stock: 22,
      }),
    ]);

    res.json({ ok: true, message: "Seeded users + products" });
  });

  console.log("Token Dine. Connected to MongoDB.");
}
run().catch(console.dir);

// ========================================
// Root & health
// ========================================
app.get("/", (_req, res) => res.send("Token Dine API running..."));
app.get("/health", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
